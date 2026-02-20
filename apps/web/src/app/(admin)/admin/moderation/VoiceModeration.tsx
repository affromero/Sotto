'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './VoiceModeration.module.css';

interface VoiceCloneAdmin {
  id: string;
  name: string;
  provider: string;
  verificationStatus: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string; image: string | null };
  fingerprint: { id: string; modelVersion: string } | null;
  verificationChallenges: Array<{
    id: string;
    phrase: string;
    attemptNumber: number;
    similarity: number | null;
    passed: boolean | null;
    createdAt: string;
  }>;
  blockedMatchesAs: Array<{
    id: string;
    similarity: number;
    resolution: string | null;
    matchedVoice: { id: string; name: string };
  }>;
}

const STATUS_ORDER = ['BLOCKED', 'ADMIN_BLOCKED', 'PENDING_VERIFICATION', 'AWAITING_CHALLENGE', 'CHALLENGE_SUBMITTED', 'REJECTED', 'VERIFIED', 'ADMIN_VERIFIED', 'PROTECTED'];

export function VoiceModeration() {
  const [voices, setVoices] = useState<VoiceCloneAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchVoices = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/admin/voices?${params.toString()}`);
      const data = await res.json();
      const sorted = [...(data.voices || [])].sort(
        (a: VoiceCloneAdmin, b: VoiceCloneAdmin) =>
          STATUS_ORDER.indexOf(a.verificationStatus) - STATUS_ORDER.indexOf(b.verificationStatus)
      );
      setVoices(sorted);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchVoices();
  }, [fetchVoices]);

  async function handleAction(voiceCloneId: string, action: string) {
    setActing(voiceCloneId);
    try {
      await fetch('/api/admin/voices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId, action }),
      });
      await fetchVoices();
    } finally {
      setActing(null);
    }
  }

  function statusBadgeClass(status: string) {
    switch (status) {
      case 'VERIFIED':
      case 'ADMIN_VERIFIED':
        return styles.statusVerified;
      case 'PROTECTED':
        return styles.statusProtected;
      case 'BLOCKED':
      case 'ADMIN_BLOCKED':
      case 'REJECTED':
        return styles.statusBlocked;
      case 'AWAITING_CHALLENGE':
      case 'CHALLENGE_SUBMITTED':
        return styles.statusPending;
      default:
        return styles.statusDefault;
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading voices...</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.filters}>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {voices.length === 0 ? (
        <div className={styles.empty}>No voice clones found</div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Voice</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Match</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {voices.map((voice) => {
                const match = voice.blockedMatchesAs[0];
                return (
                  <tr key={voice.id} className={expandedId === voice.id ? styles.rowExpanded : ''}>
                    <td>
                      <button
                        type="button"
                        className={styles.voiceNameBtn}
                        onClick={() => setExpandedId(expandedId === voice.id ? null : voice.id)}
                      >
                        {voice.name}
                        {voice.fingerprint && <span className={styles.fpBadge} title="Has voiceprint">FP</span>}
                      </button>
                      {expandedId === voice.id && voice.verificationChallenges.length > 0 && (
                        <div className={styles.challengeHistory}>
                          <div className={styles.challengeTitle}>Challenge History</div>
                          {voice.verificationChallenges.map((c) => (
                            <div key={c.id} className={styles.challengeRow}>
                              <span>#{c.attemptNumber}</span>
                              <span className={styles.challengePhrase}>&ldquo;{c.phrase.slice(0, 40)}...&rdquo;</span>
                              {c.similarity !== null && (
                                <span className={styles.similarity}>{(c.similarity * 100).toFixed(1)}%</span>
                              )}
                              <span className={c.passed ? styles.passed : c.passed === false ? styles.failed : styles.pending}>
                                {c.passed ? 'Passed' : c.passed === false ? 'Failed' : 'Pending'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={styles.ownerCell}>
                      {voice.user.name || voice.user.email}
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${statusBadgeClass(voice.verificationStatus)}`}>
                        {voice.verificationStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      {match && (
                        <span className={styles.matchInfo}>
                          {(match.similarity * 100).toFixed(1)}% vs {match.matchedVoice.name}
                        </span>
                      )}
                    </td>
                    <td className={styles.dateCell}>
                      {new Date(voice.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className={styles.actionCell}>
                      {voice.verificationStatus !== 'ADMIN_VERIFIED' && voice.verificationStatus !== 'VERIFIED' && (
                        <button
                          type="button"
                          className={styles.actionVerify}
                          onClick={() => handleAction(voice.id, 'verify')}
                          disabled={acting === voice.id}
                        >
                          Verify
                        </button>
                      )}
                      {voice.verificationStatus !== 'ADMIN_BLOCKED' && voice.verificationStatus !== 'BLOCKED' && (
                        <button
                          type="button"
                          className={styles.actionBlock}
                          onClick={() => handleAction(voice.id, 'block')}
                          disabled={acting === voice.id}
                        >
                          Block
                        </button>
                      )}
                      {voice.verificationStatus !== 'PROTECTED' && (
                        <button
                          type="button"
                          className={styles.actionProtect}
                          onClick={() => handleAction(voice.id, 'protect')}
                          disabled={acting === voice.id}
                        >
                          Protect
                        </button>
                      )}
                      {(voice.verificationStatus === 'BLOCKED' || voice.verificationStatus === 'ADMIN_BLOCKED') && (
                        <button
                          type="button"
                          className={styles.actionUnblock}
                          onClick={() => handleAction(voice.id, 'unblock')}
                          disabled={acting === voice.id}
                        >
                          Unblock
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
