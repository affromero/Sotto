const KEYBOARD_PATTERNS = [
  'qwerty',
  'asdf',
  'zxcv',
  'qwertz',
  'azerty',
  'hjkl',
  'uiop',
  'bnm',
  'wasd',
];

/**
 * Validate a display name for gibberish / low-quality input.
 * Pure function — no async, safe for client-side mirroring.
 */
export function validateDisplayName(name: string): { valid: boolean; reason?: string } {
  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return { valid: false, reason: 'Name must be at least 2 characters' };
  }
  if (trimmed.length > 100) {
    return { valid: false, reason: 'Name must be 100 characters or fewer' };
  }

  // All same character repeated
  if (/^(.)\1+$/.test(trimmed)) {
    return { valid: false, reason: 'Please enter a real name' };
  }

  // Only numbers or symbols (no letters at all)
  if (!/\p{Letter}/u.test(trimmed)) {
    return { valid: false, reason: 'Name must contain at least one letter' };
  }

  // Keyboard smash detection
  const lower = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  for (const pattern of KEYBOARD_PATTERNS) {
    if (lower.includes(pattern)) {
      return { valid: false, reason: 'Please enter a real name' };
    }
  }

  return { valid: true };
}
