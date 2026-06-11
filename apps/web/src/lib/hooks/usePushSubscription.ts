'use client';

import { useState, useCallback, useSyncExternalStore } from 'react';

export type PushState = 'unsupported' | 'prompt' | 'granted' | 'denied' | 'loading';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getBrowserPushState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  const permission = Notification.permission;
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'prompt';
}

const noopSubscribe = () => () => {};

export function usePushSubscription() {
  const browserState = useSyncExternalStore(
    noopSubscribe,
    getBrowserPushState,
    () => 'loading' as PushState,
  );

  // Override allows subscribe/unsubscribe to update state immediately
  // without waiting for a browser permission change event (which doesn't exist)
  const [stateOverride, setStateOverride] = useState<PushState | null>(null);
  const pushState = stateOverride ?? browserState;

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return false;

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys) return false;

      await fetch('/api/v1/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          },
        }),
      });

      setStateOverride('granted');
      return true;
    } catch {
      if (Notification.permission === 'denied') {
        setStateOverride('denied');
      }
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    await fetch('/api/v1/notifications/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });

    setStateOverride('prompt');
  }, []);

  return { pushState, subscribe, unsubscribe };
}
