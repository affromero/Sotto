'use client';

import { useEffect, useState, useRef } from 'react';
import styles from './VoiceManager.module.css';

interface VoiceClone {
  id: string;
  name: string;
  description: string | null;
  externalVoiceId: string;
  sourceType: 'UPLOAD' | 'RECORD';
  requestable: boolean;
  priceInCents: number | null;
  salesCount: number;
  totalEarningsCents: number;
  createdAt: string;
}

interface VoiceRequest {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  voiceClone: { id: string; name: string };
  requester?: { id: string; name: string | null; image: string | null };
  voiceOwner?: { id: string; name: string | null; image: string | null };
}

interface AllowlistEntry {
  id: string;
  createdAt: string;
  allowedUser: { id: string; handle: string | null; name: string | null; image: string | null };
}

interface UserSearchResult {
  id: string;
  handle: string | null;
  name: string | null;
  image: string | null;
}

export function VoiceManager() {
  const [userClones, setUserClones] = useState<VoiceClone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [togglingRequestable, setTogglingRequestable] = useState<string | null>(null);
  const [voiceRequests, setVoiceRequests] = useState<{
    sent: VoiceRequest[];
    received: VoiceRequest[];
  }>({ sent: [], received: [] });
  const [updatingRequest, setUpdatingRequest] = useState<string | null>(null);
  const [allowlistEntries, setAllowlistEntries] = useState<Record<string, AllowlistEntry[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [addingToAllowlist, setAddingToAllowlist] = useState(false);
  const [removingEntry, setRemovingEntry] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [stripeOnboarded, setStripeOnboarded] = useState(false);
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchVoices();
    fetchRequests();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  async function fetchVoices() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/voices');
      if (!response.ok) throw new Error('Failed to fetch voices');
      const voiceData = await response.json();
      setUserClones(voiceData.userClones ?? []);
      setStripeOnboarded(voiceData.stripeOnboarded ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }

  async function fetchRequests() {
    try {
      const response = await fetch('/api/voices/request');
      if (response.ok) {
        const data = await response.json();
        setVoiceRequests(data);
      }
    } catch {
      // Non-critical
    }
  }

  async function fetchAllowlist(voiceCloneId: string) {
    try {
      const response = await fetch(`/api/voices/allowlist?voiceCloneId=${voiceCloneId}`);
      if (response.ok) {
        const entries = await response.json();
        setAllowlistEntries((prev) => ({ ...prev, [voiceCloneId]: entries }));
      }
    } catch {
      // Non-critical
    }
  }

  async function handleSearchUsers(query: string) {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/users/search?handle=${encodeURIComponent(query)}`);
        if (response.ok) {
          const users = await response.json();
          setSearchResults(users);
        }
      } catch {
        // Non-critical
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function handleAddToAllowlist(voiceCloneId: string, handle: string) {
    setAddingToAllowlist(true);
    try {
      const response = await fetch('/api/voices/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId, handle }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add to allowlist');
      }
      setSearchQuery('');
      setSearchResults([]);
      await fetchAllowlist(voiceCloneId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to allowlist');
    } finally {
      setAddingToAllowlist(false);
    }
  }

  async function handleRemoveFromAllowlist(entryId: string, voiceCloneId: string) {
    setRemovingEntry(entryId);
    try {
      const response = await fetch(`/api/voices/allowlist/${entryId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to remove from allowlist');
      await fetchAllowlist(voiceCloneId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from allowlist');
    } finally {
      setRemovingEntry(null);
    }
  }

  function handleToggleAllowlistPanel(voiceCloneId: string) {
    if (activeVoiceId === voiceCloneId) {
      setActiveVoiceId(null);
    } else {
      setActiveVoiceId(voiceCloneId);
      if (!allowlistEntries[voiceCloneId]) {
        fetchAllowlist(voiceCloneId);
      }
    }
    setSearchQuery('');
    setSearchResults([]);
  }

  async function handleToggleRequestable(voiceCloneId: string, currentValue: boolean) {
    setTogglingRequestable(voiceCloneId);
    try {
      const response = await fetch('/api/voices/clone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId, requestable: !currentValue }),
      });
      if (response.ok) {
        await fetchVoices();
      }
    } catch {
      setError('Failed to update voice sharing setting');
    } finally {
      setTogglingRequestable(null);
    }
  }

  function handleStartEditDescription(voice: VoiceClone) {
    setEditingDescription(voice.id);
    setDescriptionDraft(voice.description ?? '');
  }

  async function handleSaveDescription(voiceCloneId: string) {
    setSavingDescription(true);
    try {
      const response = await fetch('/api/voices/clone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId, description: descriptionDraft.trim() }),
      });
      if (response.ok) {
        await fetchVoices();
      }
    } catch {
      setError('Failed to update description');
    } finally {
      setSavingDescription(false);
      setEditingDescription(null);
    }
  }

  async function handleConnectStripe() {
    setConnectingStripe(true);
    try {
      const response = await fetch('/api/stripe/connect', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to start Stripe onboarding');
      const { url } = await response.json();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Stripe');
      setConnectingStripe(false);
    }
  }

  function handleStartEditPrice(voice: VoiceClone) {
    setEditingPrice(voice.id);
    setPriceDraft(voice.priceInCents ? (voice.priceInCents / 100).toFixed(2) : '');
  }

  async function handleSavePrice(voiceCloneId: string) {
    setSavingPrice(true);
    try {
      const priceValue = priceDraft.trim();
      const priceInCents = priceValue === '' ? null : Math.round(parseFloat(priceValue) * 100);

      if (priceInCents !== null && (isNaN(priceInCents) || priceInCents < 0 || priceInCents > 10000)) {
        throw new Error('Price must be between $0.00 and $100.00');
      }

      const response = await fetch('/api/voices/clone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId, priceInCents }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update price');
      }
      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update price');
    } finally {
      setSavingPrice(false);
      setEditingPrice(null);
    }
  }

  async function handleUpdateRequest(requestId: string, status: 'APPROVED' | 'DENIED' | 'REVOKED') {
    setUpdatingRequest(requestId);
    try {
      const response = await fetch(`/api/voices/request/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update request');
      }
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update request');
    } finally {
      setUpdatingRequest(null);
    }
  }

  async function handleClone(e: React.FormEvent) {
    e.preventDefault();
    if (!cloneFile || !cloneName.trim()) return;

    try {
      setCloning(true);
      setError(null);

      const formData = new FormData();
      formData.append('audio', cloneFile);
      formData.append('name', cloneName.trim());
      formData.append('sourceType', 'UPLOAD');

      const response = await fetch('/api/voices/clone', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clone voice');
      }

      setCloneName('');
      setCloneFile(null);
      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone voice');
    } finally {
      setCloning(false);
    }
  }

  async function handleDelete(voiceCloneId: string) {
    try {
      setDeleting(voiceCloneId);
      setError(null);

      const response = await fetch('/api/voices/clone', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete voice');
      }

      await fetchVoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete voice');
    } finally {
      setDeleting(null);
    }
  }

  async function handlePlayPreview(externalVoiceId: string) {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setPlaying(externalVoiceId);
      setError(null);

      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: externalVoiceId,
          text: 'Hello, this is a preview of my cloned voice on Sotto.',
        }),
      });

      if (!response.ok) throw new Error('Failed to generate preview');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setPlaying(null);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        setPlaying(null);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (err) {
      setPlaying(null);
      setError(err instanceof Error ? err.message : 'Failed to play preview');
    }
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}>
          <span className={styles.spinner} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Voice Management</h2>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Stripe Payouts</h3>
        {stripeOnboarded ? (
          <div className={styles.stripeConnected}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="3 8 7 12 13 4" />
            </svg>
            <span>Stripe Connected</span>
            <a href="/api/stripe/connect" className={styles.stripeDashboardLink}>Dashboard</a>
          </div>
        ) : (
          <div className={styles.stripePrompt}>
            <p className={styles.stripePromptText}>
              Connect your Stripe account to set prices on your voices and receive payouts (90% of each sale).
            </p>
            <button
              type="button"
              className={styles.cloneButton}
              onClick={handleConnectStripe}
              disabled={connectingStripe}
            >
              {connectingStripe ? 'Connecting...' : 'Connect Stripe'}
            </button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Cloned Voices</h3>

        {userClones.length === 0 ? (
          <p className={styles.empty}>
            No cloned voices yet. Upload an audio sample to create your first custom voice.
          </p>
        ) : (
          <div className={styles.voiceList}>
            {userClones.map((voice) => (
              <div key={voice.id} className={styles.voiceItemWrap}>
                <div className={styles.voiceItem}>
                  <div>
                    <div className={styles.voiceName}>{voice.name}</div>
                    {voice.requestable && (
                      editingDescription === voice.id ? (
                        <div className={styles.descriptionEdit}>
                          <textarea
                            className={styles.descriptionTextarea}
                            value={descriptionDraft}
                            onChange={(e) => setDescriptionDraft(e.target.value)}
                            onBlur={() => handleSaveDescription(voice.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveDescription(voice.id);
                              }
                              if (e.key === 'Escape') {
                                setEditingDescription(null);
                              }
                            }}
                            placeholder="Add a description for the marketplace..."
                            maxLength={200}
                            rows={2}
                            autoFocus
                            disabled={savingDescription}
                          />
                          <span className={styles.descriptionCount}>
                            {descriptionDraft.length}/200
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.descriptionBtn}
                          onClick={() => handleStartEditDescription(voice)}
                        >
                          {voice.description || 'Add a description for the marketplace...'}
                        </button>
                      )
                    )}
                    <div className={styles.priceRow}>
                      {editingPrice === voice.id ? (
                        <div className={styles.priceEdit}>
                          <span className={styles.priceCurrency}>$</span>
                          <input
                            type="number"
                            className={styles.priceInput}
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            onBlur={() => handleSavePrice(voice.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSavePrice(voice.id);
                              }
                              if (e.key === 'Escape') setEditingPrice(null);
                            }}
                            placeholder="0.00"
                            min="0"
                            max="100"
                            step="0.01"
                            autoFocus
                            disabled={savingPrice}
                          />
                          <span className={styles.priceUnit}>/ podcast</span>
                          <span className={styles.priceFee}>10% platform fee</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.priceBtn}
                          onClick={() => handleStartEditPrice(voice)}
                          disabled={!stripeOnboarded && !voice.priceInCents}
                          title={stripeOnboarded ? 'Set price' : 'Connect Stripe to set prices'}
                        >
                          {voice.priceInCents && voice.priceInCents > 0
                            ? `$${(voice.priceInCents / 100).toFixed(2)} / podcast`
                            : 'Free — set a price'}
                        </button>
                      )}
                      {voice.salesCount > 0 && (
                        <span className={styles.earnings}>
                          {voice.salesCount} {voice.salesCount === 1 ? 'sale' : 'sales'} — ${(voice.totalEarningsCents / 100).toFixed(2)} earned
                        </span>
                      )}
                    </div>
                    <div className={styles.voiceMeta}>
                      <span
                        className={`${styles.voiceBadge} ${voice.sourceType === 'RECORD' ? styles.badgeRecord : styles.badgeUpload}`}
                      >
                        {voice.sourceType}
                      </span>
                      <span className={styles.voiceDate}>{formatDate(voice.createdAt)}</span>
                    </div>
                  </div>
                  <div className={styles.voiceActions}>
                    <label
                      className={styles.requestableToggle}
                      title={
                        voice.requestable ? 'Shared: others can request' : 'Private: not shared'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={voice.requestable}
                        onChange={() => handleToggleRequestable(voice.id, voice.requestable)}
                        disabled={togglingRequestable === voice.id}
                        aria-label={`Toggle sharing for ${voice.name}`}
                      />
                      <span className={styles.requestableLabel}>
                        {voice.requestable ? 'Shared' : 'Private'}
                      </span>
                    </label>
                    <button
                      type="button"
                      className={`${styles.playButton} ${activeVoiceId === voice.id ? styles.allowlistActive : ''}`}
                      onClick={() => handleToggleAllowlistPanel(voice.id)}
                      aria-label={`Manage instant access for ${voice.name}`}
                      title="Manage Instant Access"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M8 1.5a3 3 0 0 1 3 3v2H5v-2a3 3 0 0 1 3-3z" />
                        <rect x="3" y="6.5" width="10" height="7" rx="1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.playButton}
                      onClick={() => handlePlayPreview(voice.externalVoiceId)}
                      disabled={playing === voice.externalVoiceId}
                      aria-label={`Preview ${voice.name}`}
                    >
                      {playing === voice.externalVoiceId ? (
                        <span className={styles.spinnerSmall} />
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M4 2.5v11l9-5.5L4 2.5z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => handleDelete(voice.id)}
                      disabled={deleting === voice.id}
                      aria-label={`Delete ${voice.name}`}
                    >
                      {deleting === voice.id ? (
                        <span className={styles.spinnerSmall} />
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M2 4h12M5.5 4V2.5h5V4M6.5 7v4M9.5 7v4M3.5 4l.5 9.5h8l.5-9.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {activeVoiceId === voice.id && (
                  <div className={styles.allowlistPanel}>
                    <div className={styles.allowlistHeader}>
                      Instant Access ({allowlistEntries[voice.id]?.length ?? 0})
                    </div>
                    <div className={styles.allowlistSearch}>
                      <input
                        type="text"
                        className={styles.nameInput}
                        value={searchQuery}
                        onChange={(e) => handleSearchUsers(e.target.value)}
                        placeholder="Search by @handle..."
                        disabled={addingToAllowlist}
                      />
                      {searching && <span className={styles.spinnerSmall} />}
                    </div>
                    {searchResults.length > 0 && (
                      <div className={styles.searchDropdown}>
                        {searchResults.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            className={styles.searchResult}
                            onClick={() =>
                              user.handle && handleAddToAllowlist(voice.id, user.handle)
                            }
                            disabled={addingToAllowlist || !user.handle}
                          >
                            <span className={styles.searchHandle}>@{user.handle}</span>
                            {user.name && <span className={styles.searchName}>{user.name}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {(allowlistEntries[voice.id] ?? []).length > 0 && (
                      <div className={styles.allowlistList}>
                        {(allowlistEntries[voice.id] ?? []).map((entry) => (
                          <div key={entry.id} className={styles.allowlistEntry}>
                            <span className={styles.allowlistUser}>
                              @{entry.allowedUser.handle}
                              {entry.allowedUser.name && (
                                <span className={styles.searchName}>
                                  {' '}
                                  ({entry.allowedUser.name})
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className={styles.deleteButton}
                              onClick={() => handleRemoveFromAllowlist(entry.id, voice.id)}
                              disabled={removingEntry === entry.id}
                              aria-label={`Remove @${entry.allowedUser.handle}`}
                            >
                              {removingEntry === entry.id ? (
                                <span className={styles.spinnerSmall} />
                              ) : (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  aria-hidden="true"
                                >
                                  <line x1="4" y1="4" x2="12" y2="12" />
                                  <line x1="12" y1="4" x2="4" y2="12" />
                                </svg>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {voiceRequests.received.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Incoming Voice Requests</h3>
          <div className={styles.voiceList}>
            {voiceRequests.received.map((req) => (
              <div key={req.id} className={styles.voiceItem}>
                <div>
                  <div className={styles.voiceName}>
                    {req.requester?.name || 'Unknown'} wants to use &ldquo;{req.voiceClone.name}
                    &rdquo;
                  </div>
                  <div className={styles.voiceMeta}>
                    <span
                      className={`${styles.voiceBadge} ${req.status === 'APPROVED' ? styles.badgeUpload : req.status === 'DENIED' ? styles.badgeRecord : ''}`}
                    >
                      {req.status}
                    </span>
                    {req.message && <span className={styles.voiceDate}>{req.message}</span>}
                  </div>
                </div>
                <div className={styles.voiceActions}>
                  {req.status === 'PENDING' && (
                    <>
                      <button
                        type="button"
                        className={styles.playButton}
                        onClick={() => handleUpdateRequest(req.id, 'APPROVED')}
                        disabled={updatingRequest === req.id}
                        aria-label="Approve request"
                        title="Approve"
                      >
                        {updatingRequest === req.id ? (
                          <span className={styles.spinnerSmall} />
                        ) : (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            <polyline points="3 8 7 12 13 4" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={() => handleUpdateRequest(req.id, 'DENIED')}
                        disabled={updatingRequest === req.id}
                        aria-label="Deny request"
                        title="Deny"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <line x1="4" y1="4" x2="12" y2="12" />
                          <line x1="12" y1="4" x2="4" y2="12" />
                        </svg>
                      </button>
                    </>
                  )}
                  {req.status === 'APPROVED' && (
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => handleUpdateRequest(req.id, 'REVOKED')}
                      disabled={updatingRequest === req.id}
                      aria-label="Revoke access"
                      title="Revoke"
                    >
                      {updatingRequest === req.id ? (
                        <span className={styles.spinnerSmall} />
                      ) : (
                        'Revoke'
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Add New Voice</h3>
        <form onSubmit={handleClone} className={styles.uploadForm}>
          <div className={styles.formGroup}>
            <label htmlFor="voice-name" className={styles.label}>
              Voice Name
            </label>
            <input
              id="voice-name"
              type="text"
              className={styles.nameInput}
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="My Voice"
              required
              disabled={cloning}
              maxLength={100}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="voice-file" className={styles.label}>
              Audio Sample
            </label>
            <input
              id="voice-file"
              type="file"
              className={styles.fileInput}
              accept="audio/*"
              onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
              required
              disabled={cloning}
            />
            <p className={styles.hint}>
              Upload a clear recording (MP3, WAV, M4A). At least 30 seconds for best results.
            </p>
          </div>
          <button
            type="submit"
            className={styles.cloneButton}
            disabled={cloning || !cloneName.trim() || !cloneFile}
          >
            {cloning ? (
              <>
                <span className={styles.spinnerSmall} />
                Cloning...
              </>
            ) : (
              'Clone Voice'
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
