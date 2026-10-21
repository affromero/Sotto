import { z } from 'zod';

/** Public operator contact is optional; a configured invalid address is an error. */
export function privacyContactUrl(input: string | undefined): string | null {
  if (input === undefined || input.trim() === '') return null;
  const email = z.email().parse(input.trim());
  return `mailto:${encodeURIComponent(email)}?subject=Sotto%20profile%20deletion`;
}
