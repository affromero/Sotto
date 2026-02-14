'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTrack } from '@/components/providers/EventProvider';

export function PageViewTracker() {
  const pathname = usePathname();
  const track = useTrack();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (pathname === previousPathname.current) return;
    previousPathname.current = pathname;

    track({
      eventType: 'page.view',
      path: pathname,
      title: typeof document !== 'undefined' ? document.title : undefined,
    });
  }, [pathname, track]);

  return null;
}
