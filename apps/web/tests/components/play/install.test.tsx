import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayInstallOptions } from '@/components/pwa/PlayInstallOptions';
import { PlayInvitationReturn } from '@/components/pwa/PlayInvitationReturn';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { PlayJoin } from '@/components/play/PlayJoin';
import { DownloadOptions } from '@/app/download/DownloadOptions';
import { MobileNav } from '@/components/layout/MobileNav';
import { rememberPlayInvitation } from '@/components/play/client/intent';

const navigation = vi.hoisted(() => ({ pathname: '/', destinations: [] as string[] }));
vi.mock('next/navigation', () => {
  const router = { replace: (path: string) => navigation.destinations.push(path) };
  return { usePathname: () => navigation.pathname, useRouter: () => router };
});
const unavailable = { ios: null, androidStore: null, androidApk: null };
const browserProperties = ['serviceWorker', 'maxTouchPoints'].map((name) => ({
  name,
  descriptor: Object.getOwnPropertyDescriptor(navigator, name),
}));

beforeEach(() => {
  navigation.pathname = '/';
  navigation.destinations.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const { name, descriptor } of browserProperties) {
    if (descriptor) Object.defineProperty(navigator, name, descriptor);
    else Reflect.deleteProperty(navigator, name);
  }
});

describe('installation and invitation return', () => {
  it('shows real iOS and Android destinations and clearly states unavailable downloads', () => {
    const options = render(<PlayInstallOptions distribution={unavailable} error={null} />);
    expect(screen.getByText(/App Store download is not configured/)).toBeInTheDocument();
    expect(screen.getByText(/Android download is not configured/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Install from/ })).not.toBeInTheDocument();
    options.rerender(
      <PlayInstallOptions
        distribution={{
          ios: 'https://apps.apple.com/app/id123',
          androidStore: 'https://play.google.com/store/apps/details?id=fm.sotto',
          androidApk: null,
        }}
        error={null}
      />
    );
    expect(screen.getByRole('link', { name: 'Install from the App Store' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id123'
    );
    expect(screen.getByRole('link', { name: 'Install from Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=fm.sotto'
    );
  });

  it('prepares home-screen installation without requesting notification permission', async () => {
    const registration: string[] = [];
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', {
      requestPermission: () => {
        throw new Error('Not required for installation');
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: async (path: string) => {
          registration.push(path);
          return {};
        },
      },
    });
    render(<PlayInstallOptions distribution={unavailable} error={null} />);
    await waitFor(() => expect(registration).toEqual(['/sw.js']));
    const prompted: string[] = [];
    const offered = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        prompted.push('install');
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    act(() => {
      window.dispatchEvent(offered);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install web app' }));
    await waitFor(() => expect(prompted).toEqual(['install']));
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/installed web app/);
    expect(screen.getByText(/Playing together needs a connection/)).toBeInTheDocument();
  });

  it('gives iPad home-screen instructions and surfaces service-worker preparation failures', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: async () => {
          throw new TypeError('Offline');
        },
      },
    });
    render(<PlayInstallOptions distribution={unavailable} error={null} />);
    expect(await screen.findByText(/In Safari, open Share/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be prepared/);
  });

  it('returns an installed web app to its own saved invitation without claiming admission', async () => {
    rememberPlayInvitation({ version: 1, serverUrl: location.origin, code: 'ABCDEFGH2345' });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('fetch', () => {
      throw new Error('Return must not claim or fetch credentials');
    });
    render(<PlayInvitationReturn />);
    await waitFor(() =>
      expect(navigation.destinations).toEqual(['/play/join?v=1&code=ABCDEFGH2345'])
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss saved game invitation' }));
    expect(screen.queryByRole('link', { name: /Return to your game/ })).not.toBeInTheDocument();
  });

  it('requires an explicit hop to a foreign server and does not install the bridge as the game app', async () => {
    vi.stubGlobal(
      'location',
      new URL(
        'https://sotto.fm/play/join?v=1&server=https%3A%2F%2Fpartner.example&code=ABCDEFGH2345'
      )
    );
    vi.stubGlobal('fetch', () => {
      throw new Error('Bridge must not fetch another server with credentials');
    });
    render(<PlayJoin distribution={unavailable} installationError={null} />);
    expect(
      await screen.findByRole('link', { name: 'Continue to the game server' })
    ).toHaveAttribute('href', 'https://partner.example/play/join?v=1&code=ABCDEFGH2345');
    expect(screen.queryByText('Home-screen web app')).not.toBeInTheDocument();
    expect(screen.getByText(/before installing its home-screen/)).toBeInTheDocument();
    expect(navigation.destinations).toEqual([]);
  });

  it('keeps an unrelated installed profile on its current page until the saved invitation is chosen', async () => {
    navigation.pathname = '/learn';
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    rememberPlayInvitation({
      version: 1,
      serverUrl: 'https://partner.example',
      code: 'ABCDEFGH2345',
    });
    render(<PlayInvitationReturn />);
    expect(await screen.findByRole('link', { name: /Return to your game/ })).toHaveAttribute(
      'href',
      'https://partner.example/play/join?v=1&code=ABCDEFGH2345'
    );
    expect(navigation.destinations).toEqual([]);
  });

  it('does not promise offline games in the existing install banner', async () => {
    render(<InstallPrompt />);
    const offered = Object.assign(new Event('beforeinstallprompt'), {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    act(() => {
      window.dispatchEvent(offered);
    });
    expect(screen.getByRole('dialog')).toHaveTextContent(/Playing together needs a connection/);
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/offline/i);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5],
    ['Mozilla/5.0 (Linux; Android 16)', 'Linux armv8l', 5],
  ])('avoids recommending a desktop installer to %s', async (agent, platform, touches) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => touches });
    render(<DownloadOptions />);
    expect(screen.queryByText('Detected')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /macOS/ })).toHaveAttribute(
      'href',
      'https://sotto.fm/download/mac'
    );
  });

  it('keeps Play selected in mobile room navigation', () => {
    render(<MobileNav currentPath="/play/rooms/game" hasActivePlayer />);
    expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Learn' })).not.toHaveAttribute('aria-current');
  });
});
