// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateLevelReadiness,
  learningDescendants,
  objectiveProgress,
  type CefrLevel,
  type LearningMapResponse,
} from '@sotto/shared';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { SourceFocusLibrary } from '@/components/learn/learning-map/SourceFocusLibrary';
import { ObjectiveHistory } from '@/components/learn/learning-map/ObjectiveHistory';
import { privateSpeakingFixture } from '../../../lib/learning-map/private-speaking/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function map(level: CefrLevel = 'A2'): LearningMapResponse {
  const catalog = getLanguageCatalog('de');
  const nodes = catalog.nodes.filter((node) => node.kind === 'GROUP' || node.level === level);
  return {
    courseId: 'course-1',
    targetLang: 'de',
    currentLevel: 'A2',
    viewedLevel: level,
    catalogVersion: catalog.version,
    catalogHash: 'a'.repeat(64),
    requirementId: null,
    coverage: null,
    readiness: {
      ...evaluateLevelReadiness(catalog, level, [], [], new Date()),
      exemptSkills: [],
    },
    blockers: [],
    completedAt: null,
    references: catalog.references,
    nodes: nodes.map((node) => {
      const count =
        node.kind === 'OBJECTIVE'
          ? 1
          : learningDescendants(catalog, node.id).filter((objective) => objective.level === level)
              .length;
      return {
        node,
        progress: node.kind === 'OBJECTIVE' ? objectiveProgress(node, [], [], new Date()) : null,
        summary: {
          total: Math.max(1, count),
          confident: 0,
          notAssessed: count,
          reviewDue: 0,
        },
      };
    }),
  };
}
describe('source class library and assessment history', () => {
  it.each(['A2', 'B1'] as const)(
    'keeps source-only practice separate from catalog credit and future bands preview-only (%s)',
    async (level) => {
      const current = map(level);
      const { selection } = privateSpeakingFixture();
      const focus = selection.sourceFocus!;
      const details = JSON.parse(Buffer.from(focus.detailsBase64, 'base64').toString('utf8'));
      const base = {
        analysisId: focus.analysisId,
        analysisRevision: focus.analysisRevision,
        status: 'COMPLETE',
        identityDigest: 'f'.repeat(64),
        resultDigest: focus.resultDigest,
        statusUrl: `/api/v1/material-analyses/${focus.analysisId}`,
      };
      const summary = {
        id: focus.id,
        order: 0,
        title: details.title,
        kind: 'GRAMMAR',
        level: 'A2',
        objectiveIds: [],
        focusDigest: focus.focusDigest,
        detailUrl: `/api/v1/material-analyses/${focus.analysisId}/focuses/${focus.id}`,
      };
      const previews: unknown[] = [];
      const practice = vi.fn(async () => {});
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          previews.push(JSON.parse(String(init.body)));
          return Response.json({
            selection: {
              ...selection,
              catalogVersion: current.catalogVersion,
              catalogHash: current.catalogHash,
            },
            requirementId: null,
            availableKinds: ['FULL', 'GRAMMAR', 'SPEAKING'],
          });
        }
        if (url.includes('/focuses/'))
          return Response.json({
            analysisId: focus.analysisId,
            analysisRevision: focus.analysisRevision,
            resultDigest: focus.resultDigest,
            focusDigest: focus.focusDigest,
            focus: details,
            coverage: focus.coverage,
          });
        if (url.includes('/courses/'))
          return Response.json({
            courseId: current.courseId,
            items: [
              {
                ...base,
                createdAt: '2026-10-20T12:00:00.000Z',
                completedAt: '2026-10-20T12:00:00.000Z',
                retryOfAnalysisId: null,
                sourceNames: ['Saved private grammar source'],
                focusCount: 1,
              },
            ],
            nextCursor: null,
          });
        return Response.json({
          ...base,
          coverage: focus.coverage,
          summary: { focusCount: 1, inference: null },
          stale: false,
          focuses: [summary],
          nextCursor: null,
        });
      });
      render(<SourceFocusLibrary map={current} onPractice={practice} />);
      fireEvent.click(
        await screen.findByRole('button', {
          name: /Saved private grammar source/,
        })
      );
      fireEvent.click(await screen.findByRole('button', { name: /Private werden function/ }));
      expect(await screen.findByRole('heading', { name: 'Private werden function' })).toBeTruthy();
      fireEvent.click(screen.getByText('Source evidence (1 excerpts)'));
      expect(screen.getByText(details.citations[0].quote)).toBeTruthy();
      const preview = screen.getByRole('button', {
        name: `Preview practice at ${level}`,
      });
      if (level === 'B1') {
        expect(preview).toBeDisabled();
        expect(previews).toEqual([]);
        expect(practice).not.toHaveBeenCalled();
        return;
      }
      fireEvent.click(preview);
      await screen.findByText('Private source practice. Catalog objectives stay unassessed.');
      fireEvent.change(screen.getByRole('combobox', { name: 'Practice format' }), {
        target: { value: 'SPEAKING' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Generate another practice class' }));
      await waitFor(() =>
        expect(practice).toHaveBeenCalledWith(
          {
            catalogVersion: current.catalogVersion,
            level: 'A2',
            nodeIds: [],
            materialFocusId: focus.id,
          },
          'SPEAKING'
        )
      );
      expect(previews).toEqual([
        {
          catalogVersion: current.catalogVersion,
          level: 'A2',
          nodeIds: [],
          materialFocusId: focus.id,
        },
      ]);
    }
  );
  it('appends the exact cursor page of qualified assessment history and rejects a foreign objective receipt', async () => {
    const urls: string[] = [];
    let wrong = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return Response.json({
        courseId: wrong ? 'foreign' : 'course-1',
        objectiveId: 'de.criterion',
        criterionVersion: 1,
        policyVersion: 1,
        items: [
          {
            id: urls.length === 1 ? 'one' : 'two',
            skill: 'GRAMMAR',
            quality: 1,
            sourceType: 'PRACTICE_QUESTION',
            sessionId: 'saved-session',
            taskId: 'exact-task',
            observedAt: '2026-10-20T12:00:00.000Z',
            rationale:
              urls.length === 1 ? 'First independent answer.' : 'Second independent answer.',
            assessment: 'Use the finite verb in second position.',
          },
        ],
        nextCursor: urls.length === 1 ? 'saved-cursor' : null,
      });
    });
    const first = render(
      <ObjectiveHistory courseId="course-1" objectiveId="de.criterion" level="A1" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show assessment history' }));
    await screen.findByText('First independent answer.');
    fireEvent.click(screen.getByRole('button', { name: 'More assessment history' }));
    await screen.findByText('Second independent answer.');
    expect(screen.getByText('First independent answer.')).toBeTruthy();
    expect(urls[1]).toContain('after=saved-cursor');
    first.unmount();
    wrong = true;
    render(<ObjectiveHistory courseId="course-1" objectiveId="de.criterion" level="A1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show assessment history' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Second independent answer.')).toBeNull();
  });
});
