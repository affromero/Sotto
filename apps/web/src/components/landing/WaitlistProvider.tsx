'use client';

import { createContext, useContext, useState, useCallback, type ReactNode, type FormEvent } from 'react';

interface WaitlistState {
  email: string;
  setEmail: (v: string) => void;
  twitter: string;
  setTwitter: (v: string) => void;
  feedback: string;
  setFeedback: (v: string) => void;
  submitted: boolean;
  loading: boolean;
  error: string;
  handleSubmit: (e: FormEvent, source: string) => void;
}

const WaitlistContext = createContext<WaitlistState | null>(null);

export function useWaitlist() {
  const ctx = useContext(WaitlistContext);
  if (!ctx) throw new Error('useWaitlist must be used within WaitlistProvider');
  return ctx;
}

export function WaitlistProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState('');
  const [twitter, setTwitter] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: FormEvent, source: string) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          twitterHandle: twitter || undefined,
          feedback: feedback || undefined,
          source,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [email, twitter, feedback]);

  return (
    <WaitlistContext.Provider
      value={{ email, setEmail, twitter, setTwitter, feedback, setFeedback, submitted, loading, error, handleSubmit }}
    >
      {children}
    </WaitlistContext.Provider>
  );
}
