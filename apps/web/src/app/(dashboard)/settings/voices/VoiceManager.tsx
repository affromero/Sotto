'use client';

import { useEffect, useState, useRef } from 'react';
import styles from './VoiceManager.module.css';

interface VoiceClone {
  id: string;
  name: string;
  elevenLabsVoiceId: string;
  sourceType: 'UPLOAD' | 'RECORD';
  requestable: boolean;
  createdAt: string;
}

interface VoiceCredits {
  used: number;
  total: number;
  remaining: number;
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

interface VoiceData {
  userClones: VoiceClone[];
  credits: VoiceCredits;
}

export function VoiceManager() {
  const [data, setData] = useState<VoiceData | null>(null);
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
  const [addonActive, setAddonActive] = useState(false);
  const [addonLoading, setAddonLoading] = useState(false);
  const [allowlistEntries, setAllowlistEntries] = useState<Record<string, AllowlistEntry[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [addingToAllowlist, setAddingToAllowlist] = useState(false);
  const [removingEntry, setRemovingEntry] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchVoices();
    fetchRequests();
    fetchAddonStatus();
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
      setData(voiceData);
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

  async function fetchAddonStatus() {
    try {
      const response = await fetch('/api/billing/subscription');
      if (response.ok) {
        const sub = await response.json();
        setAddonActive(sub.voiceCreatorAddonActive ?? false);
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

  async function handleSubscribeAddon() {
    setAddonLoading(true);
    try {
      const response = await fetch('/api/billing/voice-creator-addon', { method: 'POST' });
      if (response.ok) {
        const { url } = await response.json();
        if (url) window.location.href = url;
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to start addon checkout');
      }
    } catch {
      setError('Failed to start addon checkout');
    } finally {
      setAddonLoading(false);
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

  async function handlePlayPreview(elevenLabsVoiceId: string) {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setPlaying(elevenLabsVoiceId);
      setError(null);

      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: elevenLabsVoiceId,
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

  if (!data) {
    return (
      <div className={styles.container}>
        <p className={styles.error}>Failed to load voice data</p>
      </div>
    );
  }

  const creditPct =
    data.credits.total > 0 ? Math.min((data.credits.used / data.credits.total) * 100, 100) : 0;
  const isFree = data.credits.total === 0;

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Voice Management</h2>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Premium Voice Credits</h3>
        <div className={styles.creditLabel}>
          {data.credits.used} / {data.credits.total} used this month
        </div>
        <div
          className={styles.creditBar}
          role="progressbar"
          aria-valuenow={data.credits.used}
          aria-valuemax={data.credits.total}
        >
          <div className={styles.creditBarFill} style={{ width: `${creditPct}%` }} />
        </div>
        {data.credits.remaining === 0 && data.credits.total > 0 && (
          <p className={styles.hint}>
            All credits used this month. Credits reset at the start of your next billing period.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Cloned Voices</h3>

        {data.userClones.length === 0 ? (
          <p className={styles.empty}>
            {isFree
              ? 'Voice cloning is available on Pro and Creator plans.'
              : 'No cloned voices yet. Upload an audio sample to create your first custom voice.'}
          </p>
        ) : (
          <div className={styles.voiceList}>
            {data.userClones.map((voice) => (
              <div key={voice.id} className={styles.voiceItemWrap}>
                <div className={styles.voiceItem}>
                  <div>
                    <div className={styles.voiceName}>{voice.name}</div>
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
                    {addonActive && (
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
                    )}
                    <button
                      type="button"
                      className={styles.playButton}
                      onClick={() => handlePlayPreview(voice.elevenLabsVoiceId)}
                      disabled={playing === voice.elevenLabsVoiceId}
                      aria-label={`Preview ${voice.name}`}
                    >
                      {playing === voice.elevenLabsVoiceId ? (
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
                {addonActive && activeVoiceId === voice.id && (
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

      {!addonActive && data.userClones.length > 0 && !isFree && (
        <section className={styles.section}>
          <div className={styles.upgradeBanner}>
            <p>
              Unlock <strong>Voice Creator</strong> ($15/mo) to pre-approve users for instant voice
              access, bypassing the request workflow.
            </p>
            <button
              type="button"
              className={styles.upgradeButton}
              onClick={handleSubscribeAddon}
              disabled={addonLoading}
            >
              {addonLoading ? (
                <>
                  <span className={styles.spinnerSmall} />
                  Loading...
                </>
              ) : (
                'Subscribe to Voice Creator'
              )}
            </button>
          </div>
        </section>
      )}

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
        {isFree ? (
          <div className={styles.upgradeBanner}>
            <p>
              Voice cloning requires a paid subscription. Upgrade to clone your own voice for
              podcasts.
            </p>
            <a href="/pricing" className={styles.upgradeButton}>
              View Plans
            </a>
          </div>
        ) : (
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
        )}
      </section>
    </div>
  );
}
