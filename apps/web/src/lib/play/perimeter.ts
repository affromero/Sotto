/** Only capability intake and the invitation landing page bypass app admission. */
export function isPublicPlayRequest(pathname: string, method: string): boolean {
  if (pathname === '/play/join') return method === 'GET' || method === 'HEAD';
  if (pathname === '/api/v1/play/policy') return method === 'GET' || method === 'HEAD';
  if (pathname === '/api/v1/play/invitations') return method === 'GET' || method === 'POST';
  if (/^\/api\/v1\/play\/join-requests\/[A-Za-z0-9_-]{1,100}$/.test(pathname))
    return method === 'GET';
  return (
    method === 'POST' &&
    /^\/api\/v1\/play\/join-requests\/[A-Za-z0-9_-]{1,100}\/(claim|ack|conduct)$/.test(pathname)
  );
}
