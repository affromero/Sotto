'use client';

import type { EventPayload, EventContext, BehavioralEventInput } from '@/types/events';

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER_SIZE = 50;
const SESSION_KEY = 'sotto_session_id';

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getSessionId(): string {
  if (typeof sessionStorage === 'undefined') return generateSessionId();
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = generateSessionId();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua) && !/iPad|Tablet/i.test(ua)) return 'mobile';
  if (/iPad|Tablet|PlayBook/i.test(ua)) return 'tablet';
  return 'desktop';
}

/**
 * Client-side event buffer singleton.
 * Collects events in memory, flushes every 5s or at 50 events.
 * Uses navigator.sendBeacon on beforeunload, fetch with keepalive otherwise.
 * Silent failure — telemetry never breaks the app.
 */
export class EventBuffer {
  private buffer: BehavioralEventInput[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private deviceType: 'mobile' | 'tablet' | 'desktop';
  private userId: string | undefined;

  constructor() {
    this.sessionId = getSessionId();
    this.deviceType = detectDeviceType();

    if (typeof window !== 'undefined') {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
      window.addEventListener('beforeunload', () => this.flushSync());
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushSync();
        }
      });
    }
  }

  setUserId(userId: string | undefined): void {
    this.userId = userId;
  }

  track(payload: EventPayload): void {
    const context: EventContext = {
      sessionId: this.sessionId,
      userId: this.userId,
      pageUrl: typeof window !== 'undefined' ? window.location.href : '',
      deviceType: this.deviceType,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 512) : undefined,
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      clientTs: Date.now(),
    };

    this.buffer.push({ context, payload });

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);

    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
    } catch {
      // Silent failure — telemetry never breaks the app
    }
  }

  private flushSync(): void {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);
    const body = JSON.stringify({ events });

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    } else {
      try {
        fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      } catch {
        // Silent failure
      }
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushSync();
  }
}
