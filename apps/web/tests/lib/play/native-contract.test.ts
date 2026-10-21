import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativePlayFixtures } from '../../../../../scripts/play/export-fixtures';

describe('shared native game fixtures', () => {
  it('matches actual personalized engine output and authorized notebook selections', () => {
    const bytes = readFileSync(
      resolve(process.cwd(), '../../packages/shared/fixtures/play/contract.json'),
      'utf8'
    );
    expect(JSON.parse(bytes)).toEqual(nativePlayFixtures());
  });
});
