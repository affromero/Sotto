import {
  accessErrorStatus,
  createAccessHandler,
  type AccessHttpOptions,
} from 'thesidedoor-core/access/http';
import { isAccessError } from 'thesidedoor-core/access';
import { errorResponse } from '@/lib/api-response';
import { getAppBaseUrl } from '@/lib/urls';
import {
  sharedAccess,
  sharedDevices,
  sharedProfiles,
  SHARED_SESSION_COOKIE,
} from '@/lib/sidedoor/access/core/service';

/** Apply shared browser policy and sanitized access errors to app-specific operations. */
export async function accessOperation(
  request: Request,
  browser: boolean,
  operation: () => Promise<Response>
): Promise<Response> {
  let response: Response;
  try {
    if (browser) {
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      headers.set('content-type', 'application/json');
      const checked = await accessHandler()(
        new Request(request.url, { method: 'POST', headers, body: '{}' }),
        'check-origin'
      );
      if (!checked.ok) return checked;
    }
    response = await operation();
  } catch (error) {
    response = isAccessError(error)
      ? errorResponse(error.code, accessErrorStatus(error))
      : error instanceof SyntaxError
        ? errorResponse('Invalid JSON request', 400)
        : errorResponse(
            'Access is unavailable. Check the instance configuration and access setup.',
            503
          );
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function accessHandler(
  services: Pick<AccessHttpOptions, 'access' | 'devices' | 'profiles'> = {
    access: sharedAccess,
    devices: sharedDevices,
    profiles: sharedProfiles,
  }
) {
  // Validate the complete application URL before deriving the WebAuthn origin.
  const appUrl = new URL(getAppBaseUrl());
  const aliases: unknown = process.env.SIDEDOOR_PASSWORD_ORIGINS
    ? JSON.parse(process.env.SIDEDOOR_PASSWORD_ORIGINS)
    : [];
  if (!Array.isArray(aliases) || !aliases.every((value) => typeof value === 'string'))
    throw new Error('SIDEDOOR_PASSWORD_ORIGINS must be a JSON array of explicit origins');
  return createAccessHandler({
    ...services,
    origin: appUrl.origin,
    passwordOrigins: aliases,
    trustedProxy: process.env.SIDEDOOR_TRUSTED_PROXY === 'true',
    useHostHeader: true,
    name: 'Sotto',
    cookieName: SHARED_SESSION_COOKIE,
  });
}
