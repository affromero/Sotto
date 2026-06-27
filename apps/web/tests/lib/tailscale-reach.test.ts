import { describe, expect, it } from 'vitest';
import { parseTailscaleDeviceStatus, parseTailscaleServeUrl } from '@/lib/tailscale-reach';

describe('parseTailscaleServeUrl', () => {
  it('returns the HTTPS tailnet origin proxying the requested port', () => {
    const status = JSON.stringify({
      Foreground: {
        id: {
          Web: {
            'andres-macbook-pro.tail297718.ts.net:443': {
              Handlers: {
                '/': { Proxy: 'http://127.0.0.1:3000' },
              },
            },
          },
        },
      },
    });

    expect(parseTailscaleServeUrl(status, 3000)).toBe(
      'https://andres-macbook-pro.tail297718.ts.net'
    );
  });

  it('ignores serve entries for a different local port', () => {
    const status = JSON.stringify({
      Foreground: {
        id: {
          Web: {
            'andres-macbook-pro.tail297718.ts.net:443': {
              Handlers: {
                '/': { Proxy: 'http://127.0.0.1:3001' },
              },
            },
          },
        },
      },
    });

    expect(parseTailscaleServeUrl(status, 3000)).toBeNull();
  });

  it('returns null for malformed status output', () => {
    expect(parseTailscaleServeUrl('not json', 3000)).toBeNull();
  });
});

describe('parseTailscaleDeviceStatus', () => {
  it('returns running device metadata from tailscale status output', () => {
    const status = JSON.stringify({
      BackendState: 'Running',
      Self: {
        HostName: 'andres-macbook-pro',
        DNSName: 'andres-macbook-pro.tail297718.ts.net.',
      },
      CurrentTailnet: {
        Name: 'andres2912@gmail.com',
      },
    });

    expect(parseTailscaleDeviceStatus(status)).toEqual({
      running: true,
      hostname: 'andres-macbook-pro',
      dnsName: 'andres-macbook-pro.tail297718.ts.net',
      tailnetName: 'andres2912@gmail.com',
    });
  });
});
