import { describe, it, expect } from 'vitest';
import { validateDisplayName } from '@/lib/name-validation';

describe('validateDisplayName', () => {
  it('rejects empty string', () => {
    expect(validateDisplayName('')).toEqual({ valid: false, reason: 'Name must be at least 2 characters' });
  });

  it('rejects single character', () => {
    expect(validateDisplayName('A')).toEqual({ valid: false, reason: 'Name must be at least 2 characters' });
  });

  it('rejects whitespace-only input', () => {
    expect(validateDisplayName('   ')).toEqual({ valid: false, reason: 'Name must be at least 2 characters' });
  });

  it('rejects name over 100 characters', () => {
    const long = 'A'.repeat(101);
    expect(validateDisplayName(long)).toEqual({ valid: false, reason: 'Name must be 100 characters or fewer' });
  });

  it('rejects all same character repeated', () => {
    expect(validateDisplayName('aaaa')).toEqual({ valid: false, reason: 'Please enter a real name' });
    expect(validateDisplayName('ZZZZ')).toEqual({ valid: false, reason: 'Please enter a real name' });
  });

  it('rejects numbers only', () => {
    expect(validateDisplayName('12345')).toEqual({ valid: false, reason: 'Name must contain at least one letter' });
  });

  it('rejects symbols only', () => {
    expect(validateDisplayName('!@#$%')).toEqual({ valid: false, reason: 'Name must contain at least one letter' });
  });

  it('rejects keyboard smash patterns', () => {
    expect(validateDisplayName('qwerty')).toEqual({ valid: false, reason: 'Please enter a real name' });
    expect(validateDisplayName('Asdf Jones')).toEqual({ valid: false, reason: 'Please enter a real name' });
  });

  it('accepts valid simple names', () => {
    expect(validateDisplayName('Alice')).toEqual({ valid: true });
    expect(validateDisplayName('Bob')).toEqual({ valid: true });
    expect(validateDisplayName('Jo')).toEqual({ valid: true });
  });

  it('accepts names with numbers mixed in', () => {
    expect(validateDisplayName('J4mes')).toEqual({ valid: true });
  });

  it('accepts names with spaces', () => {
    expect(validateDisplayName('John Doe')).toEqual({ valid: true });
  });

  it('accepts unicode names', () => {
    expect(validateDisplayName('André')).toEqual({ valid: true });
    expect(validateDisplayName('太郎')).toEqual({ valid: true });
    expect(validateDisplayName('Ng')).toEqual({ valid: true });
  });

  it('accepts exactly 100 characters', () => {
    const name = 'A'.repeat(99) + 'b';
    expect(validateDisplayName(name)).toEqual({ valid: true });
  });

  it('trims whitespace before checking length', () => {
    expect(validateDisplayName('  Al  ')).toEqual({ valid: true });
  });
});
