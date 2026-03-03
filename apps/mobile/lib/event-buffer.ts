import { AppState, type AppStateStatus } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getToken } from './auth';
import type { EventPayload, EventContext, BehavioralEventInput } from '@sotto/shared';

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER_SIZE = 50;
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://sotto.fm/api';

export class EventBuffer {
  private buffer: BehavioralEventInput[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private sessionId: string;
  private userId: string | undefined;
  private pathname = '';

  constructor() {
    this.sessionId = Crypto.randomUUID();

    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    this.appStateSubscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'background' || state === 'inactive') {
          this.flush();
        }
      },
    );
  }

  setUserId(userId: string | undefined): void {
    this.userId = userId;
  }

  setPathname(pathname: string): void {
    this.pathname = pathname;
  }

  track(payload: EventPayload): void {
    const context: EventContext = {
      sessionId: this.sessionId,
      userId: this.userId,
      pageUrl: this.pathname,
      deviceType: 'mobile',
      clientTs: Date.now(),
    };
    this.buffer.push({ context, payload });
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(`${API_URL}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events }),
      });
    } catch {
      // Silent failure — telemetry must never disrupt the app
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.flush();
  }
}
