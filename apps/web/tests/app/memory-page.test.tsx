import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MemoryPage from '@/app/(dashboard)/memory/page';

afterEach(() => vi.unstubAllGlobals());

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
    return ++germanReads === 1 ? Response.json({ nodes: [], edges: [] }) : revisit.promise;
  });
  render(<MemoryPage />);
  await screen.findByLabelText('Memory graph empty');
  const selector = screen.getByRole('combobox');
  fireEvent.change(selector, { target: { value: 'es' } });
  fireEvent.change(selector, { target: { value: 'de' } });
  expect(screen.queryByLabelText('Memory graph empty')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Loading graph')).toBeInTheDocument();
  await act(async () => intermediate.resolve(Response.json({}, { status: 500 })));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => revisit.resolve(Response.json({ nodes: [], edges: [] })));
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
    return Response.json({ nodes: [], edges: [] });
  });
  render(<MemoryPage />);
  const selector = await screen.findByRole('combobox');
  expect(screen.getByLabelText('Loading graph')).toBeInTheDocument();
  fireEvent.change(selector, { target: { value: 'es' } });
  expect(await screen.findByLabelText('Memory graph empty')).toBeInTheDocument();
  expect(previousSignal?.aborted).toBe(true);
  await act(async () => first.resolve(Response.json({}, { status: 500 })));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(selector).toHaveValue('es');
  expect(screen.getByLabelText('Memory graph empty')).toBeInTheDocument();
});
