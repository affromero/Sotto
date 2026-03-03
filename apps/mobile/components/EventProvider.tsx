import { createContext, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { EventPayload } from '@sotto/shared';
import { EventBuffer } from '../lib/event-buffer';
import { api } from '../lib/api';

interface EventContextType {
  track: (payload: EventPayload) => void;
}

const EventCtx = createContext<EventContextType | null>(null);

export function EventProvider({ children }: { children: ReactNode }) {
  const bufferRef = useRef<EventBuffer | null>(null);
  const pathname = usePathname();

  const { data: user } = useQuery<{ id: string }>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get('/users/me');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!bufferRef.current) {
      bufferRef.current = new EventBuffer();
    }
    return () => {
      bufferRef.current?.destroy();
      bufferRef.current = null;
    };
  }, []);

  useEffect(() => {
    bufferRef.current?.setUserId(user?.id);
  }, [user?.id]);

  useEffect(() => {
    bufferRef.current?.setPathname(pathname);
  }, [pathname]);

  const track = useCallback((payload: EventPayload) => {
    bufferRef.current?.track(payload);
  }, []);

  const value = useMemo(() => ({ track }), [track]);

  return <EventCtx.Provider value={value}>{children}</EventCtx.Provider>;
}

export function useTrack(): (payload: EventPayload) => void {
  const context = useContext(EventCtx);
  if (!context) return () => {};
  return context.track;
}
