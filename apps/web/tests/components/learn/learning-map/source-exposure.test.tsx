import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningMap } from '@/components/learn/learning-map/LearningMap';
import { LearningMapPanel } from '@/components/learn/learning-map/LearningMapPanel';
import type { SourceExposureScope } from '@/components/learn/learning-map/discovery/SourceExposure';
import { privateSpeakingFixture } from '../../../lib/learning-map/private-speaking/fixtures';
import { makeMap } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const callbacks = {
  onViewLevel: vi.fn(),
  onPractice: vi.fn(async () => {}),
  onAdvance: vi.fn(async () => {}),
  busy: false,
  error: null,
};
type CitationType = {
  sourceKind: 'MATERIAL' | 'PASTE' | 'COURSE_NOTE';
  origin: 'EMBEDDED_TEXT' | 'VISUAL_RECOGNITION' | 'SOURCE_TEXT';
};
function sourceFixture(mapped = true, criterionVersion = 1, citationType?: CitationType) {
  const { selection } = privateSpeakingFixture();
  const source = selection.sourceFocus!;
  const details = JSON.parse(Buffer.from(source.detailsBase64, 'base64').toString('utf8'));
  if (citationType) {
    const materialId =
      citationType.sourceKind === 'MATERIAL' ? '5e94f383-5c77-4d97-92e3-1f0d8c024fd0' : null;
    for (const citation of [
      ...details.citations,
      ...details.fragments.flatMap(
        (fragment: { candidate: { citations: object[] } }) => fragment.candidate.citations
      ),
    ]) {
      Object.assign(citation, citationType, { materialId, pageNumber: 3 });
    }
  }
  details.objectiveCandidates = mapped
    ? [
        {
          objectiveId: 'de.g.a2',
          criterionVersion,
          level: 'A2',
          relation: 'SOURCE_EXPOSURE_CANDIDATE',
          bases: ['c'.repeat(64)],
        },
      ]
    : [];
  const scope: SourceExposureScope = {
    courseId: 'course-1',
    level: 'A2',
    analysisId: source.analysisId,
    analysisRevision: source.analysisRevision,
    resultDigest: source.resultDigest,
    focusId: source.id,
    focusDigest: createHash('sha256').update(JSON.stringify(details)).digest('hex'),
    title: details.title,
    objectiveIds: details.objectiveCandidates.map(
      (candidate: { objectiveId: string }) => candidate.objectiveId
    ),
  };
  const base = {
    analysisId: source.analysisId,
    analysisRevision: source.analysisRevision,
    status: 'COMPLETE',
    identityDigest: 'f'.repeat(64),
    resultDigest: source.resultDigest,
    statusUrl: `/api/v1/material-analyses/${source.analysisId}`,
  };
  const summary = {
    id: source.id,
    order: 0,
    title: details.title,
    kind: 'GRAMMAR',
    level: 'A2',
    objectiveIds: scope.objectiveIds,
    focusDigest: scope.focusDigest,
    detailUrl: `/api/v1/material-analyses/${source.analysisId}/focuses/${source.id}`,
  };
  return {
    scope,
    detail: {
      analysisId: source.analysisId,
      analysisRevision: source.analysisRevision,
      resultDigest: source.resultDigest,
      focusDigest: scope.focusDigest,
      focus: details,
      coverage: source.coverage,
    },
    projection: {
      ...base,
      coverage: source.coverage,
      summary: { focusCount: 1, inference: null },
      stale: false,
      focuses: [summary],
      nextCursor: null,
    },
    list: {
      courseId: 'course-1',
      items: [
        {
          ...base,
          createdAt: '2026-10-20T12:00:00.000Z',
          completedAt: '2026-10-20T12:00:00.000Z',
          retryOfAnalysisId: null,
          sourceNames: ['Selected source PDF'],
          focusCount: 1,
        },
      ],
      nextCursor: null,
    },
  };
}
function mockSources(
  detailResponse?: Promise<Response>,
  mapped = true,
  criterionVersion = 1,
  mapResponse?: (url: URL) => Promise<Response> | undefined,
  citationType?: CitationType
) {
  const fixture = sourceFixture(mapped, criterionVersion, citationType);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.includes('/focuses/')) return detailResponse ?? Response.json(fixture.detail);
    if (url.pathname.includes('/courses/') && url.pathname.endsWith('/material-analyses'))
      return Response.json({ ...fixture.list, courseId: url.pathname.split('/')[4] });
    if (url.pathname.includes('/material-analyses/')) return Response.json(fixture.projection);
    const override = mapResponse?.(url);
    if (override) return override;
    const map = makeMap({ viewedLevel: url.searchParams.get('level') === 'A1' ? 'A1' : 'A2' });
    map.courseId = url.pathname.includes('/course-2/') ? 'course-2' : 'course-1';
    return Response.json(map);
  });
  return fixture;
}
async function inspectSource() {
  fireEvent.click(await screen.findByRole('button', { name: /Selected source PDF/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Private werden function/ }));
}

describe('selected source exposure stays separate from mastery', () => {
  it.each([
    { sourceKind: 'MATERIAL', origin: 'EMBEDDED_TEXT' },
    { sourceKind: 'MATERIAL', origin: 'VISUAL_RECOGNITION' },
    { sourceKind: 'MATERIAL', origin: 'SOURCE_TEXT' },
    { sourceKind: 'PASTE', origin: 'SOURCE_TEXT' },
    { sourceKind: 'COURSE_NOTE', origin: 'SOURCE_TEXT' },
  ] as const)(
    'links original PDF pages and keeps text-only citations honest ($sourceKind/$origin)',
    async (citationType) => {
      mockSources(undefined, true, 1, undefined, citationType);
      render(<LearningMapPanel courseId="course-1" />);
      await inspectSource();
      await screen.findByRole('heading', { name: 'Private werden function' });
      fireEvent.click(screen.getByText('Source evidence (1 excerpts)'));
      if (citationType.sourceKind !== 'MATERIAL') {
        expect(screen.queryByRole('link', { name: /original/ })).toBeNull();
        expect(
          screen.getByText(citationType.sourceKind === 'PASTE' ? 'Pasted text' : 'Course note')
        ).toBeVisible();
        return;
      }
      const pdf = citationType.origin !== 'SOURCE_TEXT';
      const link = screen.getByRole('link', {
        name: pdf ? 'Open original at page 3' : 'Download original',
      });
      expect(link).toHaveAttribute(
        'href',
        `/api/v1/materials/5e94f383-5c77-4d97-92e3-1f0d8c024fd0/file?variant=original${pdf ? '&disposition=inline#page=3' : ''}`
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  );
  it('marks only exact objective leaves, retains ancestors when filtering, and keeps authoritative readiness', () => {
    const scope = sourceFixture().scope;
    scope.objectiveIds.push('de.grammar', 'de.g.a1', 'unknown');
    render(<LearningMap map={makeMap()} {...callbacks} sourceExposure={scope} />);
    expect(screen.getByRole('region', { name: 'Selected source exposure' })).toHaveTextContent(
      '1 exact objective mapping in A2.'
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Only objectives seen in this source class' })
    );
    expect(screen.getAllByText('Seen in selected source class')).toHaveLength(1);
    expect(screen.getByText('Connecting sentences')).toBeVisible();
    expect(screen.queryByText('Arrange a meeting', { selector: 'summary > span' })).toBeNull();
    expect(screen.getByText(/Showing 1 of 2 objectives/)).toBeVisible();
    expect(screen.getByText(/required objectives confident/)).toHaveTextContent(
      '0 of 2 required objectives confident'
    );
    for (const label of screen.getAllByText('Not assessed', { selector: 'span' }))
      expect(label).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Advance to B1' })).toBeNull();
  });
  it('labels private or other-band focuses honestly without synthesizing objective mappings', () => {
    render(
      <LearningMap map={makeMap()} {...callbacks} sourceExposure={sourceFixture(false).scope} />
    );
    expect(screen.getByRole('region', { name: 'Selected source exposure' })).toHaveTextContent(
      'No exact objective mappings in A2. This source class remains available for private practice.'
    );
    expect(screen.queryByText('Seen in selected source class')).toBeNull();
    expect(
      screen.queryByRole('checkbox', { name: 'Only objectives seen in this source class' })
    ).toBeNull();
    expect(screen.getByText(/Showing 2 of 2 objectives/)).toBeVisible();
  });
  it('keeps explicit selections visible in the practice preview when the source filter hides their leaves', async () => {
    const practice = vi.fn(async () => {});
    render(
      <LearningMap
        map={makeMap()}
        {...callbacks}
        onPractice={practice}
        sourceExposure={sourceFixture().scope}
      />
    );
    fireEvent.click(screen.getByText('Arrange a meeting', { selector: 'summary > span' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Arrange a meeting for practice' })
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Only objectives seen in this source class' })
    );
    expect(screen.getByText(/1 selected objective is hidden by filters/)).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Selected objectives' })).getByText(
        'Arrange a meeting'
      )
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Generate A2 practice' }));
    await act(async () => {});
    expect(practice).toHaveBeenCalledWith(
      { catalogVersion: 1, level: 'A2', nodeIds: ['de.s.a2'] },
      'FULL'
    );
  });
  it('publishes exposure only after verified detail, and clearing it preserves private source practice', async () => {
    const pending = Promise.withResolvers<Response>();
    const fixture = mockSources(pending.promise);
    render(<LearningMapPanel courseId="course-1" />);
    await screen.findByRole('heading', { name: 'A2 requirements' });
    await inspectSource();
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
    await act(async () => pending.resolve(Response.json(fixture.detail)));
    await screen.findByRole('region', { name: 'Selected source exposure' });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Only objectives seen in this source class' })
    );
    expect(screen.getByText('Seen in selected source class')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear source overlay' }));
    expect(screen.queryByText('Seen in selected source class')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview practice at A2' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Private werden function' })).toBeVisible();
    expect(screen.getByText(/Showing 2 of 2 objectives/)).toBeVisible();
  });
  it('refuses changed receipt digests and never marks a stale detail as exposure', async () => {
    const fixture = sourceFixture();
    mockSources(Promise.resolve(Response.json({ ...fixture.detail, focusDigest: '0'.repeat(64) })));
    render(<LearningMapPanel courseId="course-1" />);
    await inspectSource();
    expect(await screen.findByRole('alert')).toHaveTextContent('This source class changed.');
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
  });
  it('keeps a verified private source class unmapped without assigning an unrelated objective', async () => {
    mockSources(undefined, false);
    render(<LearningMapPanel courseId="course-1" />);
    await inspectSource();
    expect(
      await screen.findByRole('region', { name: 'Selected source exposure' })
    ).toHaveTextContent('No exact objective mappings in A2.');
    expect(screen.queryByText('Seen in selected source class')).toBeNull();
    expect(screen.getByText(/required objectives confident/)).toHaveTextContent(
      '0 of 2 required objectives confident'
    );
  });
  it('does not label a revised objective criterion as seen from an older source mapping', async () => {
    mockSources(undefined, true, 2);
    render(<LearningMapPanel courseId="course-1" />);
    await inspectSource();
    expect(
      await screen.findByRole('region', { name: 'Selected source exposure' })
    ).toHaveTextContent('No exact objective mappings in A2.');
    expect(screen.queryByText('Seen in selected source class')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mapped objectives in this level' })).toBeNull();
  });
  it('clears selected exposure on level navigation and source library refresh', async () => {
    mockSources();
    render(<LearningMapPanel courseId="course-1" />);
    await inspectSource();
    await screen.findByRole('region', { name: 'Selected source exposure' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh source library' }));
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Private werden function/ }));
    await screen.findByRole('region', { name: 'Selected source exposure' });
    fireEvent.change(screen.getByRole('combobox', { name: /^Viewing level/ }), {
      target: { value: 'A1' },
    });
    await screen.findByRole('heading', { name: 'A1 requirements' });
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
  });
  it('ignores an aborted old-course detail even when its fetch still resolves', async () => {
    const pending = Promise.withResolvers<Response>();
    const fixture = mockSources(pending.promise);
    const view = render(<LearningMapPanel courseId="course-1" />);
    await inspectSource();
    view.rerender(<LearningMapPanel courseId="course-2" />);
    await screen.findByRole('heading', { name: 'A2 requirements' });
    await act(async () => pending.resolve(Response.json(fixture.detail)));
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
    expect(
      within(screen.getByRole('list', { name: 'Learning objectives' })).queryByText(
        'Seen in selected source class'
      )
    ).toBeNull();
  });
  it('cannot republish an old detail during a failed authoritative map refresh', async () => {
    const pending = Promise.withResolvers<Response>();
    const refresh = Promise.withResolvers<Response>();
    const fixture = mockSources(pending.promise, true, 1, (url) =>
      url.searchParams.get('level') === 'A1' ? refresh.promise : undefined
    );
    render(<LearningMapPanel courseId="course-1" />);
    await inspectSource();
    fireEvent.change(screen.getByRole('combobox', { name: /^Viewing level/ }), {
      target: { value: 'A1' },
    });
    expect(screen.queryByRole('region', { name: 'Classes from your materials' })).toBeNull();
    await act(async () => pending.resolve(Response.json(fixture.detail)));
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
    await act(async () =>
      refresh.resolve(Response.json({ error: 'Authoritative map read failed.' }, { status: 503 }))
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Authoritative map read failed.');
    expect(screen.queryByRole('region', { name: 'Selected source exposure' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Classes from your materials' })).toBeNull();
  });
});
