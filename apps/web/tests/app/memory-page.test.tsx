import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MemoryPage from '@/app/(dashboard)/memory/page';
import { makeMap } from '../components/learn/learning-map/fixtures';

vi.mock('cytoscape', () => {
  const factory = Object.assign(() => ({ on: vi.fn(), destroy: vi.fn() }), { use: vi.fn() });
  return { default: factory };
});
vi.mock('cytoscape-fcose', () => ({ default: vi.fn() }));

function objectiveMemory() {
  const map = makeMap({ confident: true });
  return map.nodes.flatMap(({ node, progress }) =>
    node.kind === 'OBJECTIVE' && progress
      ? [
          {
            objective: node,
            progress,
            requirementId: map.requirementId!,
            catalogVersion: map.catalogVersion,
            catalogHash: map.catalogHash,
          },
        ]
      : []
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows fresh loading when revisiting a course before the intermediate request finishes', async () => {
  const revisit = Promise.withResolvers<Response>();
  const intermediate = Promise.withResolvers<Response>();
  let germanReads = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/v1/courses')
      return Response.json({
        courses: [
          { id: 'de', nativeLang: 'en', targetLang: 'de', currentLevel: 'B1' },
          { id: 'es', nativeLang: 'en', targetLang: 'es', currentLevel: 'A2' },
        ],
      });
    if (url.endsWith('/es/graph')) return intermediate.promise;
    return ++germanReads === 1
      ? Response.json({ objectives: objectiveMemory(), nodes: [], edges: [] })
      : revisit.promise;
  });
  render(<MemoryPage />);
  await screen.findByLabelText('Memory graph empty');
  expect(screen.getByRole('link', { name: /Choose als or wenn/ })).toBeVisible();
  const selector = screen.getByRole('combobox');
  fireEvent.change(selector, { target: { value: 'es' } });
  fireEvent.change(selector, { target: { value: 'de' } });
  expect(screen.queryByLabelText('Memory graph empty')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Choose als or wenn/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Loading graph')).toBeInTheDocument();
  await act(async () => intermediate.resolve(Response.json({}, { status: 500 })));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => revisit.resolve(Response.json({ objectives: [], nodes: [], edges: [] })));
  expect(screen.getByLabelText('Memory graph empty')).toBeInTheDocument();
});

it('clears the old graph while changing courses and ignores a late previous-course response', async () => {
  const first = Promise.withResolvers<Response>();
  let previousSignal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/courses')
      return Response.json({
        courses: [
          { id: 'de', nativeLang: 'en', targetLang: 'de', currentLevel: 'B1' },
          { id: 'es', nativeLang: 'en', targetLang: 'es', currentLevel: 'A2' },
        ],
      });
    if (url.endsWith('/de/graph')) {
      previousSignal = options?.signal;
      return first.promise;
    }
    return Response.json({ objectives: [], nodes: [], edges: [] });
  });
  render(<MemoryPage />);
  const selector = await screen.findByRole('combobox');
  expect(screen.getByLabelText('Loading graph')).toBeInTheDocument();
  fireEvent.change(selector, { target: { value: 'es' } });
  expect(await screen.findByLabelText('Memory graph empty')).toBeInTheDocument();
  expect(previousSignal?.aborted).toBe(true);
  await act(async () =>
    first.resolve(Response.json({ objectives: objectiveMemory(), nodes: [], edges: [] }))
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(selector).toHaveValue('es');
  expect(screen.getByLabelText('Memory graph empty')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Choose als or wenn/ })).not.toBeInTheDocument();
  expect(
    screen.getByText('Open the learning map to inspect your level requirements.')
  ).toBeVisible();
});

it('surfaces canonical confidence and due status separately from a weak legacy SRS node', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('fetch', async (url: string) =>
    url === '/api/v1/courses'
      ? Response.json({
          courses: [{ id: 'de', nativeLang: 'en', targetLang: 'de', currentLevel: 'A2' }],
        })
      : Response.json({
          objectives: objectiveMemory(),
          nodes: [
            {
              id: 'legacy-grammar',
              kind: 'grammar',
              label: 'Legacy als/wenn',
              strength: 0.1,
              due: true,
            },
          ],
          edges: [],
        })
  );
  render(<MemoryPage />);
  const summary = await screen.findByRole('region', { name: 'Objective progress' });
  expect(within(summary).getByText('Confident').parentElement).toHaveTextContent('2');
  expect(within(summary).getByText('Review due').parentElement).toHaveTextContent('2');
  expect(within(summary).getByRole('link', { name: /Choose als or wenn/ })).toHaveAttribute(
    'href',
    '/learn/map?course=de&level=A2&objective=de.g.a2'
  );
  expect(within(summary).queryByText(/%/)).not.toBeInTheDocument();
  expect(screen.getByText('10%')).toBeVisible();
  expect(screen.getByText('10% / due')).toBeVisible();
  expect(
    screen.getByText(/Graph strengths summarize vocabulary and broad grammar reviews/)
  ).toBeVisible();
});

it.each([undefined, [{ objective: { id: 'invalid' } }]])(
  'surfaces missing or malformed pinned coverage instead of claiming an empty successful result (%j)',
  async (objectives) => {
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/api/v1/courses'
        ? Response.json({
            courses: [{ id: 'de', nativeLang: 'en', targetLang: 'de', currentLevel: 'A2' }],
          })
        : Response.json({ objectives, nodes: [], edges: [] })
    );
    render(<MemoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the memory graph');
    expect(screen.queryByRole('region', { name: 'Objective progress' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Open the learning map to inspect your level requirements.')
    ).not.toBeInTheDocument();
  }
);
