'use client';

import 'thesidedoor/styles.css';
import { ConnectPanel } from 'thesidedoor/react';
import type { ShareChannel } from 'thesidedoor/react';

const SHARE_CHANNELS: ShareChannel[] = ['whatsapp', 'telegram', 'email', 'copy'];

/**
 * The QR and share sheet for handing this server's URL to a phone or tablet.
 * `guideWhenInsecure` stays off: the reach guide only helps when Sotto runs on
 * a laptop, and that case is covered by the Tailscale step instead.
 */
export function DeviceShare({ url }: { url: string }) {
  return (
    <ConnectPanel
      appName="Sotto"
      url={url}
      shareChannels={SHARE_CHANNELS}
      guideWhenInsecure={false}
    />
  );
}
