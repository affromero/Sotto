'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { Glyph } from '../Glyph';
import { OnboardingThemeSwitch } from '../OnboardingThemeSwitch';
import styles from './StepIntro.module.css';

interface Props {
  demoMode: boolean;
  onNext: () => void;
}

interface Greeting {
  word: string;
  language: string;
  upright?: boolean;
  rtl?: boolean;
}

const GREETINGS: readonly Greeting[] = [
  { word: 'hello', language: 'English' },
  { word: 'ciao', language: 'Italiano' },
  { word: 'bonjour', language: 'Français' },
  { word: 'こんにちは', language: '日本語', upright: true },
  { word: 'hola', language: 'Español' },
  { word: '안녕하세요', language: '한국어', upright: true },
  { word: 'hallo', language: 'Deutsch' },
  { word: 'مرحبا', language: 'العربية', upright: true, rtl: true },
  { word: 'olá', language: 'Português' },
  { word: '你好', language: '中文', upright: true },
  { word: 'привет', language: 'Русский', upright: true },
  { word: 'merhaba', language: 'Türkçe' },
  { word: 'नमस्ते', language: 'हिन्दी', upright: true },
  { word: 'γεια σου', language: 'Ελληνικά', upright: true },
  { word: 'cześć', language: 'Polski' },
  { word: 'שלום', language: 'עברית', upright: true, rtl: true },
  { word: 'xin chào', language: 'Tiếng Việt' },
  { word: 'สวัสดี', language: 'ไทย', upright: true },
  { word: 'hej', language: 'Svenska' },
  { word: 'salut', language: 'Română' },
  { word: 'halo', language: 'Indonesia' },
  { word: 'aloha', language: 'ʻŌlelo Hawaiʻi' },
  { word: 'terve', language: 'Suomi' },
  { word: 'hello', language: 'English' },
];

const LAST_GREETING_INDEX = GREETINGS.length - 1;
const DEFAULT_GREETING: Greeting = { word: 'hello', language: 'English' };
const FIRST_GREETING_DELAY_MS = 850;
const GREETING_CADENCE_MS = 900;

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function StepIntro({ demoMode, onNext }: Props) {
  const [index, setIndex] = useState(0);
  const [settled, setSettled] = useState(false);
  const greeting =
    (settled ? GREETINGS[LAST_GREETING_INDEX] : GREETINGS[index]) ?? DEFAULT_GREETING;

  const settle = useCallback(() => {
    setIndex(LAST_GREETING_INDEX);
    setSettled(true);
  }, []);

  const replay = useCallback(() => {
    setIndex(0);
    setSettled(false);
  }, []);

  const advance = useCallback(() => {
    if (settled) onNext();
    else settle();
  }, [onNext, settle, settled]);

  useEffect(() => {
    if (settled) return;

    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const timer = window.setTimeout(settle, 0);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(
      () => {
        if (index >= LAST_GREETING_INDEX - 1) {
          settle();
          return;
        }
        setIndex((current) => current + 1);
      },
      index === 0 ? FIRST_GREETING_DELAY_MS : GREETING_CADENCE_MS
    );

    return () => window.clearTimeout(timer);
  }, [index, settle, settled]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        advance();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        settle();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advance, settle]);

  return (
    <div
      className={cx(styles.welcome, settled && styles.settled)}
      onClick={advance}
      aria-label="First launch welcome"
    >
      <header className={styles.top}>
        <div className={styles.mark}>
          <Image
            src="/brand/sotto-mark.svg"
            alt=""
            width={17}
            height={17}
            className={styles.markImage}
            priority
            unoptimized
          />
          sotto
        </div>
        <div className={styles.sub}>
          {demoMode ? 'Hosted preview' : 'First launch · self hosted'}
        </div>
      </header>

      <OnboardingThemeSwitch className={styles.themeSwitch} />

      <main className={styles.stage}>
        <div className={styles.greets}>
          <div
            key={`${index}-${settled ? 'settled' : 'cycle'}`}
            className={cx(
              styles.greet,
              settled ? styles.appear : styles.enter,
              settled && styles.greetSettled,
              greeting.upright && styles.upright,
              greeting.rtl && styles.rtl
            )}
            dir={greeting.rtl ? 'rtl' : undefined}
          >
            <div className={styles.word}>{greeting.word}</div>
            <div className={styles.lang}>{greeting.language}</div>
          </div>
        </div>
      </main>

      <footer className={styles.foot}>
        <div className={styles.swipe}>
          <svg
            className={styles.chev}
            width="26"
            height="14"
            viewBox="0 0 26 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 11l10-8 10 8" />
          </svg>
          <span>Swipe up to begin</span>
        </div>
        <button
          className={styles.cta}
          type="button"
          disabled={!settled}
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
        >
          Get started
          <Glyph name="arrow" size={18} />
        </button>
      </footer>

      <div className={styles.boot} aria-hidden="true" />

      {!settled ? (
        <button
          className={styles.skip}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            settle();
          }}
        >
          Skip
        </button>
      ) : null}

      <button
        className={styles.replay}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          replay();
        }}
      >
        <Glyph name="retry" size={13} />
        Replay
      </button>
    </div>
  );
}
