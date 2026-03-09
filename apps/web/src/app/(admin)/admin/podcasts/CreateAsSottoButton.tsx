'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MARKETING_TEMPLATES } from '@/lib/marketing-templates';
import type { MarketingTemplate } from '@/lib/marketing-templates';
import styles from './page.module.css';

export function CreateAsSottoButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleTemplate = useCallback(async (template: MarketingTemplate) => {
    setLoading(template.id);
    try {
      const res = await fetch('/api/admin/podcasts/create-as-sotto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: template.metadata.topic,
          topic: template.metadata.topic,
          metadata: template.metadata,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create podcast');
      }
      const data = await res.json();
      router.push(`/podcast/${data.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(null);
    }
  }, [router]);

  return (
    <div className={styles.sottoDropdownWrapper} ref={menuRef}>
      <button
        type="button"
        className={styles.searchButton}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Create as @sotto {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className={styles.sottoDropdownMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.sottoDropdownItem}
            onClick={() => {
              setOpen(false);
              router.push('/create?as=sotto');
            }}
          >
            <span className={styles.sottoDropdownItemName}>Custom (chat flow)</span>
            <span className={styles.sottoDropdownItemDesc}>Full discovery chat</span>
          </button>
          <div className={styles.sottoDropdownDivider} />
          {MARKETING_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              className={styles.sottoDropdownItem}
              onClick={() => handleTemplate(t)}
              disabled={loading !== null}
            >
              <span className={styles.sottoDropdownItemName}>
                {t.name}
                {loading === t.id && ' …'}
              </span>
              <span className={styles.sottoDropdownItemDesc}>{t.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
