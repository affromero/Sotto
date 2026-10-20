import { createHash } from 'node:crypto';
export function learningProviderInputHash(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (
      typeof item !== 'object' ||
      item === null ||
      (!Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null)
    )
      throw new Error('Provider identities require finite JSON values.');
    if (ancestors.has(item)) throw new Error('Provider identities cannot contain cycles.');
    ancestors.add(item);
    const encoded = Array.isArray(item)
      ? `[${item.map(encode).join(',')}]`
      : `{${Object.keys(item)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${encode(Reflect.get(item, key))}`)
          .join(',')}}`;
    ancestors.delete(item);
    return encoded;
  };
  return createHash('sha256').update(encode(value)).digest('hex');
}
