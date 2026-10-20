import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningMapPanel } from '@/components/learn/learning-map/LearningMapPanel';
import { LearningMap } from '@/components/learn/learning-map/LearningMap';
import { privateSpeakingFixture } from '../../../lib/learning-map/private-speaking/fixtures';
import { makeMap } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('owned source practice when a language catalog is unavailable', () => {
  it('opens the saved focus, clamps a future URL band, then freezes a lower-level private practice selection', async () => {
    const { selection } = privateSpeakingFixture();
    const focus = selection.sourceFocus!;
    const details = JSON.parse(Buffer.from(focus.detailsBase64, 'base64').toString('utf8'));
    const previews: unknown[] = [];
    const admissions: Array<{ requestId: string; learningSelection: unknown }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/learning-map'))
        return Response.json(
          { error: 'No published catalog', status: 'UNAVAILABLE', targetLang: 'nl' },
          { status: 422 }
        );
      if (url.pathname.endsWith('/selection')) {
        const request = JSON.parse(String(init?.body));
        previews.push(request);
        return Response.json({
          selection: { ...selection, targetLang: 'nl', level: request.level },
          availableKinds: ['FULL', 'GRAMMAR'],
          requirementId: null,
        });
      }
      if (url.pathname.endsWith('/practice')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          admissions.push(body);
          return Response.json(
            {
              status: 'preparing',
              sessionId: body.requestId,
              preparationStatus: 'QUEUED',
              canRecover: false,
              message: 'Saved private practice.',
            },
            { status: 202 }
          );
        }
        return Response.json({ due: { vocab: 0, grammar: 0 }, totalVocab: 0, recent: [] });
      }
      const identity = {
        analysisId: focus.analysisId,
        analysisRevision: focus.analysisRevision,
        resultDigest: focus.resultDigest,
        identityDigest: 'f'.repeat(64),
        status: 'COMPLETE',
        statusUrl: `/api/v1/material-analyses/${focus.analysisId}`,
      };
      if (url.pathname.includes('/focuses/'))
        return Response.json({
          analysisId: focus.analysisId,
          analysisRevision: focus.analysisRevision,
          resultDigest: focus.resultDigest,
          focusDigest: focus.focusDigest,
          focus: details,
          coverage: focus.coverage,
        });
      if (url.pathname.includes('/courses/'))
        return Response.json({
          courseId: 'course-1',
          items: [
            {
              ...identity,
              createdAt: '2026-10-20T12:00:00.000Z',
              completedAt: '2026-10-20T12:00:00.000Z',
              retryOfAnalysisId: null,
              sourceNames: ['Owned notes'],
              focusCount: 1,
            },
          ],
          nextCursor: null,
        });
      return Response.json({
        ...identity,
        native: 'en',
        target: 'nl',
        courseId: 'course-1',
        coverage: focus.coverage,
        summary: { focusCount: 1, inference: null },
        stale: false,
        focuses: [
          {
            id: focus.id,
            order: 0,
            title: details.title,
            kind: 'GRAMMAR',
            level: 'A2',
            objectiveIds: [],
            focusDigest: focus.focusDigest,
            detailUrl: `/api/v1/material-analyses/${focus.analysisId}/focuses/${focus.id}`,
          },
        ],
        nextCursor: null,
      });
    });
    window.history.replaceState(null, '', '/learn/map?course=course-1&level=B1');
    render(
      <LearningMapPanel
        courseId="course-1"
        sourceCourse={{ targetLang: 'nl', currentLevel: 'A2' }}
      />
    );
    await screen.findByRole('region', { name: 'Private source practice' });
    expect(screen.getByText('Current level: A2')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Practice level' })).toHaveValue('A2');
    expect(screen.queryByRole('option', { name: 'B1' })).toBeNull();
    expect(new URL(window.location.href).searchParams.get('level')).toBe('A2');
    fireEvent.change(screen.getByRole('combobox', { name: 'Practice level' }), {
      target: { value: 'A1' },
    });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Practice level' })).toHaveValue('A1')
    );
    fireEvent.click(await screen.findByRole('button', { name: /Owned notes/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Private werden function/ }));
    await screen.findByRole('heading', { name: 'Private werden function' });
    expect(screen.getByText(/No catalog is published for this language/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview practice at A1' }));
    await screen.findByText('Private source practice. Catalog objectives stay unassessed.');
    fireEvent.click(screen.getByRole('button', { name: 'Generate another practice class' }));
    await waitFor(() => expect(admissions).toHaveLength(1));
    expect(admissions[0]!.learningSelection).toEqual({
      catalogVersion: null,
      level: 'A1',
      nodeIds: [],
      materialFocusId: focus.id,
    });
    expect(previews).toEqual(
      Array.from({ length: 2 }, () => ({
        catalogVersion: null,
        level: 'A1',
        nodeIds: [],
        materialFocusId: focus.id,
      }))
    );
    expect(screen.getByRole('region', { name: 'Focused practice' })).toBeVisible();
    expect(screen.queryByText(/required objectives confident/)).toBeNull();
  });
  it.each([
    { status: 403, targetLang: 'nl' },
    { status: 503, targetLang: 'nl' },
    { status: 422, targetLang: 'ja' },
  ])(
    'keeps HTTP/status or target mismatch as an error instead of inventing a private catalog context: %j',
    async ({ status, targetLang }) => {
      vi.stubGlobal('fetch', async () =>
        Response.json(
          { error: 'Owned map unavailable', status: 'UNAVAILABLE', targetLang },
          { status }
        )
      );
      render(
        <LearningMapPanel
          courseId="course-1"
          sourceCourse={{ targetLang: 'nl', currentLevel: 'A2' }}
        />
      );
      await screen.findByRole('alert');
      expect(screen.queryByRole('region', { name: 'Private source practice' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Preview practice/ })).toBeNull();
    }
  );
  it('shows the exact criterion for each applicable skill rather than only the generic objective goal', () => {
    const map = makeMap();
    render(
      <LearningMap
        map={map}
        onViewLevel={vi.fn()}
        onPractice={vi.fn(async () => {})}
        onAdvance={vi.fn(async () => {})}
        busy={false}
        error={null}
      />
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'als' } });
    const objective = map.nodes.find(
      ({ node }) => node.kind === 'OBJECTIVE' && node.branch === 'GRAMMAR'
    )!.node;
    if (objective.kind !== 'OBJECTIVE') throw new Error('Missing grammar fixture');
    for (const criterion of Object.values(objective.skillCriteria))
      expect(screen.getByText(criterion)).toBeVisible();
  });
});
