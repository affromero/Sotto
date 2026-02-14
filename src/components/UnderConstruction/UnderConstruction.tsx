'use client';

import { useEffect, useCallback, useRef, useState, FormEvent } from 'react';
import styles from './UnderConstruction.module.css';

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, form, [role="button"]';
const MAX_RIPPLES = 3;

type WaitlistStatus = 'idle' | 'submitting' | 'success' | 'error';

export function UnderConstruction() {
  const pageRef = useRef<HTMLDivElement>(null);
  const activeRipples = useRef(0);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<WaitlistStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handlePageClick = useCallback((e: MouseEvent) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    if (activeRipples.current >= MAX_RIPPLES) return;

    const container = pageRef.current;
    if (!container) return;

    const ripple = document.createElement('div');
    ripple.className = styles.ripple;
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty('--ripple-x', `${e.clientX}px`);
    ripple.style.setProperty('--ripple-y', `${e.clientY}px`);

    activeRipples.current += 1;
    container.appendChild(ripple);

    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      ripple.remove();
      activeRipples.current -= 1;
    };

    ripple.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 2500);
  }, []);

  useEffect(() => {
    const pageEl = pageRef.current;
    if (pageEl) {
      pageEl.addEventListener('click', handlePageClick);
    }
    return () => {
      if (pageEl) {
        pageEl.removeEventListener('click', handlePageClick);
      }
    };
  }, [handlePageClick]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'coming-soon' }),
      });

      if (!res.ok) {
        const data = await res.json();
        const msg = data?.error?.fieldErrors?.email?.[0] || 'Please enter a valid email.';
        setErrorMsg(msg);
        setStatus('error');
        return;
      }

      setStatus('success');
      setEmail('');
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div ref={pageRef} className={styles.page}>
      <main className={styles.center}>
        <h1 className={styles.title}>Sotto</h1>
        <p className={styles.tagline}>The open podcast network.</p>
        <p className={styles.subtitle}>Something is tuning up. Stay tuned.</p>

        {status === 'success' ? (
          <div className={styles.success}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.15" />
              <path
                d="M6 10.5l2.5 2.5 5.5-5.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            You&apos;re on the list.
          </div>
        ) : (
          <form className={styles.waitlist} onSubmit={handleSubmit}>
            <input
              type="email"
              className={styles.input}
              placeholder="you@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === 'error') setStatus('idle');
              }}
              required
              aria-label="Email address"
            />
            <button type="submit" className={styles.button} disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Joining...' : 'Notify Me'}
            </button>
            {status === 'error' && <p className={styles.error}>{errorMsg}</p>}
          </form>
        )}
      </main>
    </div>
  );
}
