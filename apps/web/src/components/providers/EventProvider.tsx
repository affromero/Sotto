'use client';

import { createContext, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { EventBuffer } from '@/lib/event-buffer';
import type { EventPayload } from '@/types/events';

interface EventContextType {
  track: (payload: EventPayload) => void;
}

const EventContext = createContext<EventContextType | null>(null);

interface EventProviderProps {
  userId?: string;
  children: React.ReactNode;
}

export function EventProvider({ userId, children }: EventProviderProps) {
  const { isAuthenticated } = useAuth();
  const bufferRef = useRef<EventBuffer | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!bufferRef.current) {
      bufferRef.current = new EventBuffer();
    }
    return () => {
      bufferRef.current?.destroy();
      bufferRef.current = null;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    bufferRef.current?.setUserId(userId);
  }, [userId]);

  const track = useCallback((payload: EventPayload) => {
    bufferRef.current?.track(payload);
  }, []);

  const value = useMemo(() => ({ track }), [track]);

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

/**
 * Hook to access the event tracking function.
 * Returns a no-op if used outside EventProvider (server components).
 */
export function useTrack(): (payload: EventPayload) => void {
  const context = useContext(EventContext);
  if (!context) {
    return () => {};
  }
  return context.track;
}
