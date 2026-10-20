import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningMap } from '@/components/learn/learning-map/LearningMap';
import { LearningMapPanel } from '@/components/learn/learning-map/LearningMapPanel';
import { makeMap } from './fixtures';
import { SourceObjectiveLinks } from '@/components/learn/learning-map/discovery/SourceObjectiveLinks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
function japaneseMap() {
  const map = makeMap();
  map.targetLang = 'ja';
  for (const item of map.nodes) {
    item.node.id = item.node.id.replace(/^de\./, 'ja.');
    item.node.parentId = item.node.parentId?.replace(/^de\./, 'ja.') ?? null;
    if (item.progress) item.progress.objectiveId = item.node.id;
    if (item.node.kind !== 'OBJECTIVE') continue;
    if (item.node.branch === 'GRAMMAR') {
      item.node.title = '依頼の形を選ぶ';
      item.node.description = '丁寧な依頼を作ります。';
      item.node.examples = ['見せてください。'];
      item.node.grammarKeys = ['te-form-request', 'ＴＥＳＴ'];
    } else {
      item.node.title = '会う時間を決める';
      item.node.required = false;
      if (item.progress) {
        item.progress.status = 'NEEDS_WORK';
        item.progress.reviewDue = true;
      }
    }
  }
  return map;
}
const callbacks = () => ({
  onViewLevel: vi.fn(),
  onPractice: vi.fn(async () => {}),
  onAdvance: vi.fn(async () => {}),
  busy: false,
  error: null,
});
describe('objective discovery without changing assessment requirements', () => {
  it('matches non-Latin examples and normalized aliases, retains ancestors and labels whole-group counts', () => {
    render(<LearningMap map={japaneseMap()} {...callbacks()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search objectives' }), {
      target: { value: 'ください' },
    });
    expect(
      screen.getByText(
        'Showing 1 of 2 objectives in this level. Requirements and confidence counts describe the whole level.'
      )
    ).toBeVisible();
    expect(screen.getByText('依頼の形を選ぶ', { selector: 'summary > span' })).toBeVisible();
    expect(screen.getByText('Connecting sentences')).toBeVisible();
    expect(screen.queryByText('会う時間を決める', { selector: 'summary > span' })).toBeNull();
    expect(
      screen.getAllByText(/1 of 1 objectives shown · Whole group: 0 of 1 confident/).length
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'TEST' },
    });
    expect(screen.getByText('依頼の形を選ぶ', { selector: 'summary > span' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'TE-FORM-REQUEST 丁寧' },
    });
    expect(screen.getByText('依頼の形を選ぶ', { selector: 'summary > span' })).toBeVisible();
  });
  it('combines branch, requirement, evidence, due and skill filters without narrowing authoritative readiness', () => {
    render(<LearningMap map={japaneseMap()} {...callbacks()} />);
    for (const [name, value] of [
      ['Branch', 'SITUATIONS'],
      ['Requirement', 'OPTIONAL'],
      ['Evidence status', 'NEEDS_WORK'],
      ['Skill', 'SPEAKING'],
    ]) {
      fireEvent.change(screen.getByRole('combobox', { name }), {
        target: { value },
      });
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Review due only' }));
    expect(screen.getByText('会う時間を決める', { selector: 'summary > span' })).toBeVisible();
    expect(screen.getByText(/Showing 1 of 2 objectives/)).toBeVisible();
    expect(screen.getByText(/required objectives confident/)).toHaveTextContent(
      '0 of 2 required objectives confident'
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Skill' }), {
      target: { value: 'GRAMMAR' },
    });
    expect(screen.getByText('No objectives match these filters.')).toBeVisible();
    expect(screen.getByText(/Showing 0 of 2 objectives/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText(/Showing 2 of 2 objectives/)).toBeVisible();
  });
  it('keeps a hidden explicit selection and submits its canonical objective ID', async () => {
    const props = callbacks();
    render(<LearningMap map={japaneseMap()} {...props} />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'ください' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select 依頼の形を選ぶ for practice',
      })
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '会う' },
    });
    expect(
      within(screen.getByRole('list', { name: 'Selected objectives' })).getByText('依頼の形を選ぶ')
    ).toBeVisible();
    expect(screen.getByText(/1 selected objective is hidden by filters/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Generate A2 practice' }));
    await waitFor(() =>
      expect(props.onPractice).toHaveBeenCalledWith(
        { catalogVersion: 1, level: 'A2', nodeIds: ['ja.g.a2'] },
        'FULL'
      )
    );
  });
});

describe('shareable learning map navigation', () => {
  it('links only exact source-mapped leaves available in this band and labels them as exposure', () => {
    render(
      <SourceObjectiveLinks
        map={japaneseMap()}
        objectiveIds={['ja.g.a2', 'ja.grammar', 'ja.g.a1', 'unknown']}
      />
    );
    expect(
      screen.getByText(
        'These source mappings describe exposure. Practice results establish mastery.'
      )
    ).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '依頼の形を選ぶ' })).toHaveAttribute(
      'href',
      '?course=course-1&level=A2&objective=ja.g.a2'
    );
  });
  it('restores URL filters and objective paths, writes stable links, and restores popstate without practice admission', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname.includes('/material-analyses'))
        return Response.json({
          courseId: 'course-1',
          items: [],
          nextCursor: null,
        });
      return Response.json(japaneseMap());
    });
    window.history.replaceState(
      null,
      '',
      '/learn?course=course-1&level=A2&q=TEST&branch=GRAMMAR&required=REQUIRED&status=NOT_ASSESSED&skill=WRITING&objective=ja.g.a2&tab=map'
    );
    render(<LearningMapPanel courseId="course-1" />);
    await screen.findByRole('heading', { name: 'Learning map' });
    expect(screen.getByRole('searchbox')).toHaveValue('TEST');
    expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveValue('GRAMMAR');
    expect(screen.getByRole('combobox', { name: 'Requirement' })).toHaveValue('REQUIRED');
    expect(screen.getByRole('combobox', { name: 'Evidence status' })).toHaveValue('NOT_ASSESSED');
    expect(screen.getByRole('combobox', { name: 'Skill' })).toHaveValue('WRITING');
    expect(
      screen.getByRole('checkbox', {
        name: 'Select 依頼の形を選ぶ for practice',
      })
    ).toBeVisible();
    const link = screen.getByRole('link', { name: 'Link to 依頼の形を選ぶ' });
    expect(link).toHaveAttribute('href', '?course=course-1&level=A2&objective=ja.g.a2');
    fireEvent.click(link);
    const linked = new URL(window.location.href);
    expect(linked.searchParams.get('objective')).toBe('ja.g.a2');
    expect(linked.searchParams.get('q')).toBeNull();
    expect(linked.searchParams.get('tab')).toBe('map');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '会う' },
    });
    expect(new URL(window.location.href).searchParams.get('q')).toBe('会う');
    expect(new URL(window.location.href).searchParams.get('objective')).toBeNull();
    await act(async () => {
      window.history.pushState(null, '', '/learn?course=course-1&level=A2&due=1&branch=SITUATIONS');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Review due only' })).toBeChecked()
    );
    expect(screen.getByRole('combobox', { name: 'Branch' })).toHaveValue('SITUATIONS');
    expect(screen.getByText('会う時間を決める', { selector: 'summary > span' })).toBeVisible();
    expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
  });
  it('opens a linked objective on reload and recovers a link hidden by filters', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input).includes('/material-analyses')
        ? Response.json({ courseId: 'course-1', items: [], nextCursor: null })
        : Response.json(japaneseMap())
    );
    window.history.replaceState(null, '', '/learn?level=A2&branch=SITUATIONS&objective=ja.g.a2');
    const view = render(<LearningMapPanel courseId="course-1" />);
    await screen.findByText(/The linked objective is hidden/);
    fireEvent.click(screen.getByRole('button', { name: 'Show linked objective' }));
    expect(
      screen.getByRole('checkbox', {
        name: 'Select 依頼の形を選ぶ for practice',
      })
    ).toBeVisible();
    view.unmount();
    render(<LearningMapPanel courseId="course-1" />);
    await screen.findByRole('checkbox', {
      name: 'Select 依頼の形を選ぶ for practice',
    });
    expect(
      screen.getByRole('checkbox', {
        name: 'Select 依頼の形を選ぶ for practice',
      })
    ).toBeVisible();
  });
});
