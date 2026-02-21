export function profileUrl(user: { id: string; handle?: string | null }): string {
  return user.handle ? `/@${user.handle}` : `/profile/${user.id}`;
}

export function absoluteProfileUrl(user: { id: string; handle?: string | null }, appUrl: string): string {
  return `${appUrl}${profileUrl(user)}`;
}
