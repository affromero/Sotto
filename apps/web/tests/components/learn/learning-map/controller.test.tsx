import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningMapPanel } from '@/components/learn/learning-map/LearningMapPanel';
import { makeMap, grammarExamples } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const overview = { due: { vocab: 0, grammar: 0 }, totalVocab: 0, recent: [] };
function grammarPreview() {
  const map = makeMap();
  const objective = map.nodes.find(
    (item) => item.node.kind === 'OBJECTIVE' && item.node.branch === 'GRAMMAR'
  )!.node;
  if (objective.kind !== 'OBJECTIVE') throw new Error('Fixture requires an objective');
  const {
    id,
    title,
    criterionVersion,
    policyVersion,
    branch,
    level,
    assessment,
    examples,
    skills,
    skillCriteria,
    grammarKeys,
    vocabulary,
  } = objective;
  return {
    selection: {
      schemaVersion: 1,
      catalogVersion: 1,
      catalogHash: map.catalogHash,
      targetLang: 'de',
      level: 'A2',
      nodeIds: [id],
      objectives: [
        {
          id,
          title,
          criterionVersion,
          policyVersion,
          branch,
          level,
          assessment,
          examples,
          skills,
          skillCriteria,
          grammarKeys,
          vocabulary,
        },
      ],
      materialFocusId: null,
    },
    requirementId: null,
    availableKinds: ['FULL', 'GRAMMAR'],
  };
}
describe('learning map controller', () => {
  it('discards a superseded preview even when its response ignores navigation cancellation', async () => {
    const pending = Promise.withResolvers<Response>();
    const admissions: unknown[] = [];
    let previewRequested = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/selection')) {
        previewRequested = true;
        return pending.promise;
      }
      if (url.pathname.endsWith('/practice') && init?.method === 'POST') {
        admissions.push(init.body);
        return Response.json(overview);
      }
      if (url.pathname.endsWith('/practice')) return Response.json(overview);
      if (url.pathname.includes('/material-analyses'))
        return Response.json({ courseId: 'course-1', items: [], nextCursor: null });
      return Response.json(
        makeMap({ viewedLevel: url.searchParams.get('level') === 'A1' ? 'A1' : 'A2' })
      );
    });
    render(<LearningMapPanel courseId="course-1" />);
    await screen.findByRole('heading', { name: 'Learning map' });
    fireEvent.click(screen.getByText('Connecting sentences'));
    fireEvent.click(screen.getByText(grammarExamples.A2.title, { selector: 'summary > span' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Select ${grammarExamples.A2.title} for practice` })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate A2 practice' }));
    await waitFor(() => expect(previewRequested).toBe(true));
    window.history.pushState(null, '', '/?course=course-1&level=A1');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Viewing level' })).toHaveValue('A1')
    );
    await act(async () => {
      pending.resolve(Response.json(grammarPreview()));
    });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Viewing level' })).toBeEnabled()
    );
    expect(admissions).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Focused practice' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('This old preview must never replace the selected band.')
    ).not.toBeInTheDocument();
  });
  it('replays the exact failed advancement and displays the authoritative next band', async () => {
    const requests: unknown[] = [];
    let advanced = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/advance')) {
        requests.push(JSON.parse(String(init?.body)));
        if (requests.length === 1) throw new Error('Confirmation response lost');
        advanced = true;
        return Response.json({
          completed: true,
          courseId: 'course-1',
          level: 'A2',
          currentLevel: 'B1',
          nextLevel: 'B1',
          requirementId: 'a2-requirements',
          completedAt: '2026-10-20T12:00:00.000Z',
          exemptSkills: [],
        });
      }
      if (url.includes('/material-analyses'))
        return Response.json({ courseId: 'course-1', items: [], nextCursor: null });
      return Response.json(
        makeMap({
          confident: !advanced,
          currentLevel: advanced ? 'B1' : 'A2',
          viewedLevel: advanced ? 'B1' : 'A2',
        })
      );
    });
    render(
      <StrictMode>
        <LearningMapPanel courseId="course-1" syncLevelInUrl={false} />
      </StrictMode>
    );
    await screen.findByRole('button', { name: 'Advance to B1' });
    expect(requests).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Advance to B1' }));
    await screen.findByText('Confirmation response lost');
    fireEvent.click(screen.getByRole('button', { name: 'Advance to B1' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Viewing level' })).toHaveValue('B1')
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]).toMatchObject({ expectedLevel: 'A2', catalogHash: 'a'.repeat(64) });
  });
  it('freezes the server’s resolved objective and generates distinct repeat practice after returning to the map', async () => {
    const map = makeMap();
    const objective = map.nodes.find(
      (item) => item.node.kind === 'OBJECTIVE' && item.node.branch === 'GRAMMAR'
    )!.node;
    if (objective.kind !== 'OBJECTIVE') throw new Error('Fixture requires an objective');
    const {
      id,
      title,
      criterionVersion,
      policyVersion,
      branch,
      level,
      assessment,
      examples,
      skills,
      skillCriteria,
      grammarKeys,
      vocabulary,
    } = objective;
    const admissions: Array<{ requestId: string; learningSelection: unknown }> = [];
    const selections: unknown[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/selection')) {
        selections.push(JSON.parse(String(init?.body)));
        return Response.json({
          selection: {
            schemaVersion: 1,
            catalogVersion: 1,
            catalogHash: map.catalogHash,
            targetLang: 'de',
            level: 'A2',
            nodeIds: [id],
            objectives: [
              {
                id,
                title,
                criterionVersion,
                policyVersion,
                branch,
                level,
                assessment,
                examples,
                skills,
                skillCriteria,
                grammarKeys,
                vocabulary,
              },
            ],
            materialFocusId: null,
          },
          requirementId: null,
          availableKinds: ['FULL', 'GRAMMAR'],
        });
      }
      if (url.endsWith('/practice') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        admissions.push(body);
        return Response.json({
          status: 'ready',
          sessionId: body.requestId,
          kind: 'GRAMMAR',
          practiceLevel: 'A2',
          items: [
            {
              id: 'task',
              prompt: 'Choose the correct connector.',
              options: ['als', 'wenn', 'wo', 'wie'],
            },
          ],
        });
      }
      if (url.endsWith('/practice')) return Response.json(overview);
      if (url.includes('/material-analyses'))
        return Response.json({ courseId: 'course-1', items: [], nextCursor: null });
      return Response.json(map);
    });
    render(
      <StrictMode>
        <LearningMapPanel courseId="course-1" syncLevelInUrl={false} />
      </StrictMode>
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await screen.findByRole('heading', { name: 'Learning map' });
      fireEvent.click(screen.getByText('Connecting sentences'));
      fireEvent.click(screen.getByText(grammarExamples.A2.title, { selector: 'summary > span' }));
      fireEvent.click(
        screen.getByRole('checkbox', { name: `Select ${grammarExamples.A2.title} for practice` })
      );
      fireEvent.change(screen.getByRole('combobox', { name: 'Practice format' }), {
        target: { value: 'GRAMMAR' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Generate A2 practice' }));
      await screen.findByText('Choose the correct connector.');
      expect(admissions[attempt]?.learningSelection).toEqual({
        catalogVersion: 1,
        level: 'A2',
        nodeIds: [id],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Back to learning map' }));
    }
    expect(selections).toHaveLength(2);
    expect(admissions).toHaveLength(2);
    expect(admissions[0]!.requestId).not.toBe(admissions[1]!.requestId);
  });
});
