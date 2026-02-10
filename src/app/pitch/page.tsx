'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import styles from './page.module.css';
import type { PitchManifest, PitchDocument } from '@/types/pitch';

export default function PitchPage() {
  const [state, setState] = useState<'loading' | 'locked' | 'unlocked' | 'empty'>('loading');
  const [manifest, setManifest] = useState<PitchManifest | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [docIndex, setDocIndex] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);

  // Password gate state
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentVersion = manifest?.versions.find((v) => v.date === selectedVersion);
  const documents = currentVersion?.documents ?? [];
  const selectedDoc: PitchDocument | undefined = documents[docIndex];
  const hasPrev = docIndex > 0;
  const hasNext = docIndex < documents.length - 1;

  const goNext = useCallback(() => {
    if (docIndex < documents.length - 1) {
      setDocIndex((i) => i + 1);
      setTocOpen(false);
    }
  }, [docIndex, documents.length]);

  const goPrev = useCallback(() => {
    if (docIndex > 0) {
      setDocIndex((i) => i - 1);
      setTocOpen(false);
    }
  }, [docIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (state !== 'unlocked') return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Escape') {
        setTocOpen(false);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state, goNext, goPrev]);

  useEffect(() => {
    fetchManifest();
  }, []);

  async function fetchManifest() {
    try {
      const res = await fetch('/api/pitch/manifest');
      if (res.status === 401) {
        setState('locked');
        return;
      }
      if (res.status === 404) {
        setState('empty');
        return;
      }
      if (!res.ok) {
        setState('locked');
        return;
      }
      const data: PitchManifest = await res.json();
      setManifest(data);
      if (data.latest) {
        setSelectedVersion(data.latest);
        setDocIndex(0);
      }
      setState('unlocked');
    } catch {
      setState('locked');
    }
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/pitch/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setPassword('');
        await fetchManifest();
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleVersionChange(date: string) {
    setSelectedVersion(date);
    setDocIndex(0);
    setTocOpen(false);
  }

  function jumpToDoc(index: number) {
    setDocIndex(index);
    setTocOpen(false);
  }

  if (state === 'loading') {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <main className={styles.main}>
        <div className={styles.gateContainer}>
          <h1 className={styles.logo}>Sotto</h1>
          <p className={styles.subtitle}>Investor Materials</p>
          <form className={styles.form} onSubmit={handleAuth}>
            <input
              className={styles.input}
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
            <button className={styles.button} type="submit" disabled={submitting}>
              {submitting ? 'Checking...' : 'Enter'}
            </button>
            {error && <p className={styles.error}>{error}</p>}
          </form>
        </div>
      </main>
    );
  }

  if (state === 'empty') {
    return (
      <main className={styles.main}>
        <div className={styles.gateContainer}>
          <h1 className={styles.logo}>Sotto</h1>
          <p className={styles.subtitle}>Investor Materials</p>
          <p className={styles.subtitle}>
            No pitch builds yet. Run the rebuild pipeline to generate.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className={styles.viewer}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.topBarLogo}>Sotto</span>
          <span className={styles.topBarDivider} />
          {selectedDoc && <span className={styles.topBarTitle}>{selectedDoc.displayName}</span>}
        </div>
        <div className={styles.topBarRight}>
          <button
            className={styles.tocToggle}
            onClick={() => setTocOpen(!tocOpen)}
            aria-label="Table of contents"
          >
            <span className={styles.tocCounter}>
              {documents.length > 0 ? `${docIndex + 1} of ${documents.length}` : ''}
            </span>
            <svg
              className={`${styles.tocChevron} ${tocOpen ? styles.tocChevronOpen : ''}`}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {manifest && manifest.versions.length > 1 && (
            <select
              className={styles.versionSelect}
              value={selectedVersion}
              onChange={(e) => handleVersionChange(e.target.value)}
            >
              {manifest.versions.map((v) => (
                <option key={v.date} value={v.date}>
                  {v.date}
                  {v.date === manifest.latest ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {/* Table of contents dropdown */}
      {tocOpen && (
        <>
          <div className={styles.tocBackdrop} onClick={() => setTocOpen(false)} />
          <nav className={styles.tocDropdown}>
            {documents.map((doc, i) => (
              <button
                key={doc.filename}
                className={`${styles.tocItem} ${i === docIndex ? styles.tocItemActive : ''}`}
                onClick={() => jumpToDoc(i)}
              >
                <span className={styles.tocItemNumber}>{i + 1}</span>
                <span className={styles.tocItemName}>{doc.displayName}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {/* Document content */}
      <main className={styles.content}>
        {selectedDoc ? (
          <iframe
            key={`${selectedVersion}-${selectedDoc.filename}`}
            className={styles.iframe}
            src={`/api/pitch/${selectedVersion}/${selectedDoc.filename}`}
            title={selectedDoc.displayName}
          />
        ) : (
          <div className={styles.emptyState}>
            No documents in this build. Run /update-pitch to generate.
          </div>
        )}
      </main>

      {/* Bottom navigation */}
      {documents.length > 0 && (
        <footer className={styles.bottomBar}>
          <button
            className={`${styles.navButton} ${!hasPrev ? styles.navButtonDisabled : ''}`}
            onClick={goPrev}
            disabled={!hasPrev}
            aria-label="Previous document"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8l4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.navLabel}>
              {hasPrev ? documents[docIndex - 1].displayName : 'Previous'}
            </span>
          </button>
          <div className={styles.progressDots}>
            {documents.map((_, i) => (
              <button
                key={i}
                className={`${styles.dot} ${i === docIndex ? styles.dotActive : ''}`}
                onClick={() => jumpToDoc(i)}
                aria-label={`Go to document ${i + 1}`}
              />
            ))}
          </div>
          <button
            className={`${styles.navButton} ${styles.navButtonNext} ${!hasNext ? styles.navButtonDisabled : ''}`}
            onClick={goNext}
            disabled={!hasNext}
            aria-label="Next document"
          >
            <span className={styles.navLabel}>
              {hasNext ? documents[docIndex + 1].displayName : 'Next'}
            </span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </footer>
      )}
    </div>
  );
}
