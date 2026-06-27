'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { CheckCircle2, PenLine } from 'lucide-react';
import styles from './WorkbookLink.module.css';

interface WorkbookLinkProps {
  className: string;
  classTitle: string;
  href: string;
}

type WorkbookDevice = 'default' | 'touch' | 'ipad' | 'pen';

let penSeen = false;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber());
}

function detectWorkbookDevice(): WorkbookDevice {
  if (typeof window === 'undefined') return 'default';

  const nav = window.navigator;
  const userAgent = `${nav.userAgent} ${nav.platform}`.toLowerCase();
  const touchPoints = nav.maxTouchPoints ?? 0;
  const looksLikeIPad =
    userAgent.includes('ipad') || (userAgent.includes('mac') && touchPoints > 1);

  if (looksLikeIPad) return 'ipad';
  if (window.matchMedia?.('(pointer: coarse)').matches || touchPoints > 0) return 'touch';
  return 'default';
}

function getWorkbookDeviceSnapshot(): WorkbookDevice {
  if (penSeen) return 'pen';
  return detectWorkbookDevice();
}

function getWorkbookDeviceServerSnapshot(): WorkbookDevice {
  return 'default';
}

function subscribeWorkbookDevice(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  subscribers.add(onStoreChange);

  function onPointer(event: PointerEvent) {
    if (event.pointerType !== 'pen' || penSeen) return;
    penSeen = true;
    notifySubscribers();
  }

  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerover', onPointer, { passive: true });
  return () => {
    subscribers.delete(onStoreChange);
    window.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('pointerover', onPointer);
  };
}

function deviceLabel(device: WorkbookDevice): string {
  if (device === 'pen') return 'Pencil ready';
  if (device === 'ipad') return 'iPad workbook';
  if (device === 'touch') return 'Touch workbook';
  return 'Workbook';
}

export function WorkbookLink({ className, classTitle, href }: WorkbookLinkProps) {
  const device = useSyncExternalStore(
    subscribeWorkbookDevice,
    getWorkbookDeviceSnapshot,
    getWorkbookDeviceServerSnapshot
  );

  return (
    <Link
      className={`${className} ${device === 'pen' ? styles.pencilReady : ''}`}
      href={href}
      aria-label={
        device === 'pen'
          ? `Open ${classTitle} workbook. Apple Pencil detected and ready.`
          : `Open ${classTitle} workbook for iPad or PDF annotation`
      }
    >
      <PenLine size={16} aria-hidden="true" />
      <span>{deviceLabel(device)}</span>
      {device === 'pen' && (
        <span className={styles.readyBadge}>
          <CheckCircle2 size={12} aria-hidden="true" />
          Ready
        </span>
      )}
    </Link>
  );
}
