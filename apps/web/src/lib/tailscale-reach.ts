import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const TAILSCALE_STATUS_TIMEOUT_MS = 1000;
const TAILSCALE_SETUP_TIMEOUT_MS = 45000;

type UnknownRecord = Record<string, unknown>;

export interface TailscaleReachStatus {
  installed: boolean;
  running: boolean;
  hostname: string | null;
  dnsName: string | null;
  tailnetName: string | null;
  serveUrl: string | null;
  serveConfigured: boolean;
  error: string | null;
}

export type TailscaleSetupResult =
  | {
      ok: true;
      status: TailscaleReachStatus;
      message: string;
    }
  | {
      ok: false;
      status: TailscaleReachStatus;
      reason: 'not_installed' | 'not_running' | 'needs_enable' | 'permission_denied' | 'failed';
      message: string;
      enableUrl?: string;
    };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === 'string' ? error.code : null;
}

function errorText(error: unknown): string {
  if (!isRecord(error)) return error instanceof Error ? error.message : String(error);

  const parts = [error.message, error.stderr, error.stdout].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0
  );
  return parts.join('\n').trim() || String(error);
}

function normalizeDnsName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().replace(/\.$/, '');
}

function proxyMatchesPort(proxy: unknown, port: number): boolean {
  if (typeof proxy !== 'string') return false;

  try {
    const parsed = new URL(proxy);
    return parsed.port === String(port);
  } catch {
    return proxy.endsWith(`:${port}`);
  }
}

function hostToHttpsOrigin(hostPort: string): string | null {
  if (!hostPort) return null;
  const host = hostPort.endsWith(':443') ? hostPort.slice(0, -4) : hostPort;
  return host ? `https://${host}` : null;
}

function findServeUrl(node: unknown, port: number): string | null {
  if (!isRecord(node)) return null;

  const web = node.Web;
  if (isRecord(web)) {
    for (const [hostPort, config] of Object.entries(web)) {
      if (!isRecord(config) || !isRecord(config.Handlers)) continue;
      for (const handler of Object.values(config.Handlers)) {
        if (isRecord(handler) && proxyMatchesPort(handler.Proxy, port)) {
          return hostToHttpsOrigin(hostPort);
        }
      }
    }
  }

  for (const value of Object.values(node)) {
    const found = findServeUrl(value, port);
    if (found) return found;
  }

  return null;
}

export function parseTailscaleServeUrl(rawStatus: string, port = 3000): string | null {
  try {
    return findServeUrl(JSON.parse(rawStatus), port);
  } catch {
    return null;
  }
}

export function parseTailscaleDeviceStatus(
  rawStatus: string
): Omit<TailscaleReachStatus, 'installed' | 'serveUrl' | 'serveConfigured' | 'error'> {
  const parsed: unknown = JSON.parse(rawStatus);
  if (!isRecord(parsed)) {
    throw new Error('Tailscale status output is not an object.');
  }

  const self = isRecord(parsed.Self) ? parsed.Self : {};
  const currentTailnet = isRecord(parsed.CurrentTailnet) ? parsed.CurrentTailnet : {};

  return {
    running: parsed.BackendState === 'Running',
    hostname: typeof self.HostName === 'string' && self.HostName ? self.HostName : null,
    dnsName: normalizeDnsName(self.DNSName),
    tailnetName:
      typeof currentTailnet.Name === 'string' && currentTailnet.Name ? currentTailnet.Name : null,
  };
}

export async function detectTailscaleServeUrl(port = 3000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json'], {
      timeout: TAILSCALE_STATUS_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
    });
    return parseTailscaleServeUrl(stdout, port);
  } catch {
    return null;
  }
}

export async function getTailscaleReachStatus(port = 3000): Promise<TailscaleReachStatus> {
  try {
    const [{ stdout }, serveUrl] = await Promise.all([
      execFileAsync('tailscale', ['status', '--json'], {
        timeout: TAILSCALE_STATUS_TIMEOUT_MS,
        maxBuffer: 512 * 1024,
      }),
      detectTailscaleServeUrl(port),
    ]);
    const parsed = parseTailscaleDeviceStatus(stdout);

    return {
      installed: true,
      ...parsed,
      serveUrl,
      serveConfigured: Boolean(serveUrl),
      error: null,
    };
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return {
        installed: false,
        running: false,
        hostname: null,
        dnsName: null,
        tailnetName: null,
        serveUrl: null,
        serveConfigured: false,
        error: 'Tailscale is not installed on this computer.',
      };
    }

    return {
      installed: true,
      running: false,
      hostname: null,
      dnsName: null,
      tailnetName: null,
      serveUrl: null,
      serveConfigured: false,
      error: errorText(error) || 'Tailscale is not running or is not signed in.',
    };
  }
}

function extractEnableUrl(output: string): string | undefined {
  return output.match(/https:\/\/login\.tailscale\.com\/f\/serve\?[^\s]+/)?.[0];
}

function looksPermissionRelated(output: string): boolean {
  return /admin|administrator|not permitted|permission|root|sudo|unauthorized/i.test(output);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

async function resolveTailscalePath(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', ['tailscale'], {
      timeout: TAILSCALE_STATUS_TIMEOUT_MS,
    });
    return stdout.trim() || 'tailscale';
  } catch {
    return 'tailscale';
  }
}

async function runServeCommand(commandPath: string, port: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(commandPath, ['serve', '--bg', String(port)], {
    timeout: TAILSCALE_SETUP_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return `${stdout}\n${stderr}`.trim();
}

async function runServeCommandWithMacAdmin(commandPath: string, port: number): Promise<string> {
  const command = `${shellQuote(commandPath)} serve --bg ${port}`;
  const { stdout, stderr } = await execFileAsync(
    '/usr/bin/osascript',
    ['-e', `do shell script ${appleScriptString(command)} with administrator privileges`],
    {
      timeout: TAILSCALE_SETUP_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }
  );
  return `${stdout}\n${stderr}`.trim();
}

export async function setupTailscaleServe(port = 3000): Promise<TailscaleSetupResult> {
  const before = await getTailscaleReachStatus(port);
  if (!before.installed) {
    return {
      ok: false,
      status: before,
      reason: 'not_installed',
      message: 'Install Tailscale on this computer before setting up the private URL.',
    };
  }

  if (!before.running) {
    return {
      ok: false,
      status: before,
      reason: 'not_running',
      message: 'Open Tailscale and sign in before setting up the private URL.',
    };
  }

  if (before.serveConfigured) {
    return {
      ok: true,
      status: before,
      message: 'Tailscale Serve is already set up.',
    };
  }

  const commandPath = await resolveTailscalePath();
  let directOutput = '';

  try {
    directOutput = await runServeCommand(commandPath, port);
  } catch (error: unknown) {
    directOutput = errorText(error);
    const enableUrl = extractEnableUrl(directOutput);
    if (enableUrl) {
      return {
        ok: false,
        status: await getTailscaleReachStatus(port),
        reason: 'needs_enable',
        message:
          'Tailscale Serve must be enabled for this tailnet before Sotto can create the private URL.',
        enableUrl,
      };
    }

    if (process.platform !== 'darwin' || !looksPermissionRelated(directOutput)) {
      return {
        ok: false,
        status: await getTailscaleReachStatus(port),
        reason: looksPermissionRelated(directOutput) ? 'permission_denied' : 'failed',
        message: directOutput || 'Could not set up Tailscale Serve.',
      };
    }

    try {
      directOutput = await runServeCommandWithMacAdmin(commandPath, port);
    } catch (adminError: unknown) {
      const adminOutput = errorText(adminError);
      return {
        ok: false,
        status: await getTailscaleReachStatus(port),
        reason: looksPermissionRelated(adminOutput) ? 'permission_denied' : 'failed',
        message: adminOutput || 'The macOS administrator prompt was cancelled or failed.',
      };
    }
  }

  const after = await getTailscaleReachStatus(port);
  if (after.serveConfigured) {
    return {
      ok: true,
      status: after,
      message: 'Tailscale Serve is ready.',
    };
  }

  const enableUrl = extractEnableUrl(directOutput);
  if (enableUrl) {
    return {
      ok: false,
      status: after,
      reason: 'needs_enable',
      message:
        'Tailscale Serve must be enabled for this tailnet before Sotto can create the private URL.',
      enableUrl,
    };
  }

  return {
    ok: false,
    status: after,
    reason: 'failed',
    message: directOutput || 'Tailscale Serve did not report a private URL for this server.',
  };
}
