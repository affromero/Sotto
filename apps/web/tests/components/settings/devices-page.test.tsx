import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// jsdom in this suite ships a partial Storage; DeviceReach needs the full shape.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const headerStore = { host: 'localhost:3000' };
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: headerStore.host }),
}));

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { id: 'local-user', role: 'ADMIN' } }),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { apiKey: { findMany: async () => [] } } }));

const getTailscaleReachStatus = vi.fn();
vi.mock('@/lib/tailscale-reach', () => ({
  getTailscaleReachStatus: (...args: unknown[]) => getTailscaleReachStatus(...args),
}));

vi.mock('thesidedoor/react', () => ({
  ConnectPanel: ({ url }: { url: string }) =>
    React.createElement('div', { 'data-testid': 'connect-panel' }, url),
}));

import DevicesPage from '@/app/(dashboard)/settings/devices/page';

async function renderPage() {
  render(await DevicesPage());
}

describe('Connect a device page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    getTailscaleReachStatus.mockResolvedValue({
      installed: false,
      running: false,
      hostname: null,
      dnsName: null,
      tailnetName: null,
      serveUrl: null,
      serveConfigured: false,
      error: null,
    });
  });

  it('hands out the current URL directly when the server has a real hostname', async () => {
    headerStore.host = 'sotto.afromero.co';
    await renderPage();

    expect(screen.getByTestId('connect-panel')).toHaveTextContent('https://sotto.afromero.co');
    expect(screen.queryByText(/Tailscale/i)).not.toBeInTheDocument();
    expect(getTailscaleReachStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /pairing code/i })).toBeInTheDocument();
  });

  it('offers the Tailscale reach step when the server is only on localhost', async () => {
    headerStore.host = 'localhost:3000';
    await renderPage();

    expect(screen.getByText(/Tailscale browser URL/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Open this server in a browser/i })
    ).toBeInTheDocument();
    expect(getTailscaleReachStatus).toHaveBeenCalled();
  });
});
