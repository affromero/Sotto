import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements, objectiveProgress, type LearningObjective } from '@sotto/shared';
import { LearningMapPanel } from '@/components/learn/learning-map/LearningMapPanel';
import { LearningMap } from '@/components/learn/learning-map/LearningMap';
import { makeMap } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
function exemptMap() {
  const map = makeMap();
  map.coverage = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'en',
    targetLang: 'de',
    level: 'A2',
    ttsProvider: null,
    sttProvider: null,
  });
  map.readiness.exemptSkills = ['LISTENING', 'SPEAKING'];
  for (const row of map.nodes)
    for (const skill of row.progress?.skills ?? [])
      skill.exempt = skill.skill === 'LISTENING' || skill.skill === 'SPEAKING';
  return map;
}
function preview() {
  const map = exemptMap();
  const objective = map.nodes.find(
    (row) => row.node.kind === 'OBJECTIVE' && row.node.branch === 'SITUATIONS'
  )!.node as LearningObjective;
  const snapshot = {
    id: objective.id,
    title: objective.title,
    criterionVersion: objective.criterionVersion,
    policyVersion: objective.policyVersion,
    branch: objective.branch,
    level: objective.level,
    assessment: objective.assessment,
    examples: objective.examples,
    skills: objective.skills,
    skillCriteria: objective.skillCriteria,
    grammarKeys: objective.grammarKeys,
    vocabulary: objective.vocabulary,
  };
  return {
    selection: {
      schemaVersion: 1,
      catalogVersion: map.catalogVersion,
      catalogHash: map.catalogHash,
      targetLang: map.targetLang,
      level: map.viewedLevel,
      nodeIds: [objective.id],
      objectives: [snapshot],
      materialFocusId: null,
    },
    requirementId: map.requirementId,
    availableKinds: ['FULL', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'],
  };
}
async function selectSituation() {
  fireEvent.click(screen.getByText('Arrange a meeting', { selector: 'summary > span' }));
  const checkbox = screen.getByRole('checkbox', { name: 'Select Arrange a meeting for practice' });
  await waitFor(() => expect(checkbox).toBeVisible());
  fireEvent.click(checkbox);
}
describe('optional oral practice in an exempt band', () => {
  it('checks current formats without admitting practice or changing captured exemptions', async () => {
    const requests: unknown[] = [];
    const admissions: unknown[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/selection')) {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json(preview());
      }
      if (url.endsWith('/practice') && init?.method === 'POST') admissions.push(init.body);
      if (url.includes('/material-analyses'))
        return Response.json({ courseId: 'course-1', items: [], nextCursor: null });
      return Response.json(exemptMap());
    });
    render(<LearningMapPanel courseId="course-1" />);
    await screen.findByRole('heading', { name: 'Learning map' });
    await selectSituation();
    const format = screen.getByRole('combobox', { name: 'Practice format' });
    expect(within(format).queryByRole('option', { name: 'Speaking' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check available practice formats' }));
    await waitFor(() =>
      expect(within(format).getByRole('option', { name: 'Speaking' })).toBeInTheDocument()
    );
    expect(requests).toEqual([{ catalogVersion: 1, level: 'A2', nodeIds: ['de.s.a2'] }]);
    expect(admissions).toEqual([]);
    expect(screen.getByText(/Captured level exemptions stay unchanged/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Complete A2/ })).not.toBeInTheDocument();
  });
  it('shows optional oral evidence while retaining the completion exemption', async () => {
    const map = exemptMap();
    const row = map.nodes.find((value) => value.node.id === 'de.s.a2')!;
    row.progress = objectiveProgress(
      row.node as LearningObjective,
      [
        {
          objectiveId: row.node.id,
          criterionVersion: 1,
          policyVersion: 1,
          level: 'A2',
          skill: 'SPEAKING',
          mastery: 0.95,
          assessedTasks: 5,
          assessedSessions: 2,
          lastQuality: 1,
          lastReviewed: '2026-10-20T12:00:00.000Z',
          dueAt: '2026-10-21T12:00:00.000Z',
        },
      ],
      ['LISTENING', 'SPEAKING'],
      new Date('2026-10-20T13:00:00.000Z')
    );
    render(
      <LearningMap
        map={map}
        onViewLevel={vi.fn()}
        onPractice={async () => {}}
        onAdvance={async () => {}}
        busy={false}
        error={null}
      />
    );
    await selectSituation();
    expect(
      screen.getByText('Exempt from completion; optional assessment: Confident')
    ).toBeVisible();
    expect(screen.getByText(/5 assessed tasks across 2 sessions/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Complete A2/ })).not.toBeInTheDocument();
  });
  it('discards a late format check when navigation changes the viewed band', async () => {
    const pending = Promise.withResolvers<Response>();
    let requested = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/selection')) {
        requested = true;
        return pending.promise;
      }
      if (url.pathname.includes('/material-analyses'))
        return Response.json({ courseId: 'course-1', items: [], nextCursor: null });
      return Response.json(
        url.searchParams.get('level') === 'A1' ? makeMap({ viewedLevel: 'A1' }) : exemptMap()
      );
    });
    render(<LearningMapPanel courseId="course-1" />);
    await screen.findByRole('heading', { name: 'Learning map' });
    await selectSituation();
    fireEvent.click(screen.getByRole('button', { name: 'Check available practice formats' }));
    await waitFor(() => expect(requested).toBe(true));
    window.history.pushState(null, '', '/?course=course-1&level=A1');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Viewing level' })).toHaveValue('A1')
    );
    await act(async () => {
      pending.resolve(Response.json(preview()));
    });
    expect(screen.getByRole('combobox', { name: 'Practice format' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Focused practice' })).not.toBeInTheDocument();
  });
});
