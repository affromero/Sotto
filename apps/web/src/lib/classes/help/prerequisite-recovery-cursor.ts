/** Find a valid UUIDv4 lower bound immediately before a canonical UUIDv4. */
export function previousPrerequisiteUuid(id: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    return null;
  const digits = id.replaceAll('-', '').split('');
  for (let index = digits.length - 1; index >= 0; index--) {
    if (index === 12) continue;
    const minimum = index === 16 ? 8 : 0;
    const value = Number.parseInt(digits[index]!, 16);
    if (value === minimum) continue;
    digits[index] = (value - 1).toString(16);
    for (let next = index + 1; next < digits.length; next++) {
      if (next !== 12) digits[next] = next === 16 ? 'b' : 'f';
    }
    const hex = digits.join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return null;
}
