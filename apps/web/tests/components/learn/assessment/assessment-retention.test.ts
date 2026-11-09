import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConfirmedAssessmentWork } from '@/components/learn/assessment/assessment-retention';

const receipt = {
  source: 'ASSESSMENT',
  passed: true,
  overallScore: 1,
  passedSections: 1,
  totalSections: 1,
  sections: [{ id: 'section', skill: 'GRAMMAR', score: 1, passed: true }],
};
const key = (owner: string, assessment: string) =>
  `assessment:${JSON.stringify([owner, 'class', 1, assessment, 'a'.repeat(64)])}`;
const work = JSON.stringify({
  choices: { q: 0 },
  drafts: { w: 'Private' },
  pending: [{ itemId: 'q', selectedIndex: 0 }],
});

describe('confirmed assessment work cleanup', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('clears only the owner work whose exact submission matches the receipt', async () => {
    sessionStorage.setItem(key('owner', 'done'), work);
    sessionStorage.setItem(key('owner', 'other'), work);
    sessionStorage.setItem(key('other', 'done'), work);
    sessionStorage.setItem('assessment:broken', '{unreadable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/done/writing/w'))
          return Response.json({ status: 'COMPLETED', text: 'Private' });
        if (url.endsWith('/assessment/done')) {
          expect(JSON.parse(String(init?.body))).toEqual({
            choices: [{ itemId: 'q', selectedIndex: 0 }],
          });
          return Response.json(receipt);
        }
        if (url.endsWith('/assessment/other')) return new Response(null, { status: 409 });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    await clearConfirmedAssessmentWork({
      classId: 'class',
      attempt: 1,
      receipt,
      signal: new AbortController().signal,
    });
    expect(sessionStorage.getItem(key('owner', 'done'))).toBeNull();
    expect(sessionStorage.getItem(key('owner', 'other'))).toBe(work);
    expect(sessionStorage.getItem(key('other', 'done'))).toBe(work);
    expect(sessionStorage.getItem('assessment:broken')).toBe('{unreadable');
  });

  it('retains work if the profile changes or the saved work changes while checking', async () => {
    sessionStorage.setItem(key('owner', 'done'), work);
    let ownerReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/v1/users/me')
          return Response.json({ id: ownerReads++ ? 'other' : 'owner' });
        if (String(input).endsWith('/writing/w'))
          return Response.json({ status: 'COMPLETED', text: 'Private' });
        return Response.json(receipt);
      })
    );
    await clearConfirmedAssessmentWork({
      classId: 'class',
      attempt: 1,
      receipt,
      signal: new AbortController().signal,
    });
    expect(sessionStorage.getItem(key('owner', 'done'))).toBe(work);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (String(input).endsWith('/writing/w'))
          return Response.json({ status: 'COMPLETED', text: 'Private' });
        sessionStorage.setItem(key('owner', 'done'), 'new work');
        return Response.json(receipt);
      })
    );
    await clearConfirmedAssessmentWork({
      classId: 'class',
      attempt: 1,
      receipt,
      signal: new AbortController().signal,
    });
    expect(sessionStorage.getItem(key('owner', 'done'))).toBe('new work');
  });

  it('retains choices or writing that differ from confirmed submitted work', async () => {
    const changedChoices = JSON.stringify({
      choices: { q: 1 },
      drafts: { w: 'Private' },
      pending: [{ itemId: 'q', selectedIndex: 0 }],
    });
    sessionStorage.setItem(key('owner', 'done'), changedChoices);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (String(input).endsWith('/writing/w'))
          return Response.json({ status: 'COMPLETED', text: 'Saved elsewhere' });
        return Response.json(receipt);
      })
    );
    await clearConfirmedAssessmentWork({
      classId: 'class',
      attempt: 1,
      receipt,
      signal: new AbortController().signal,
    });
    expect(sessionStorage.getItem(key('owner', 'done'))).toBe(changedChoices);
    sessionStorage.setItem(key('owner', 'done'), work);
    await clearConfirmedAssessmentWork({
      classId: 'class',
      attempt: 1,
      receipt,
      signal: new AbortController().signal,
    });
    expect(sessionStorage.getItem(key('owner', 'done'))).toBe(work);
  });
});
