'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function AccessPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/romero');
        router.refresh();
      } else {
        setError('Wrong password. Ask the team for access.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.logo}>Sotto</h1>
        <p className={styles.subtitle}>Early access</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Checking...' : 'Enter'}
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      </div>
    </main>
  );
}
