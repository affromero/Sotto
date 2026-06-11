'use client';

import 'thesidedoor/styles.css';
import { ConnectPanel } from 'thesidedoor/react';

/**
 * Reachability helper for getting a phone or tablet onto this self-hosted Sotto
 * server. Powered by sidedoor (thesidedoor): a same-network QR and share sheet,
 * with the internet-exposing tunnel options fenced behind a clear warning. The
 * QR URL defaults to this browser's current origin.
 */
export function DeviceReach() {
  return <ConnectPanel appName="Sotto" />;
}
