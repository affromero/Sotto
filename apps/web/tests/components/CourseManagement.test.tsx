import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourseManagement } from '@/components/settings/CourseManagement';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }) }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const COURSES = [
  { id: 'c1', nativeLang: 'en', targetLang: 'de', currentLevel: 'B1', title: 'German' },
  { id: 'c2', nativeLang: 'en', targetLang: 'es', currentLevel: 'A2', title: 'Spanish' },
];

describe('CourseManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((_url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve(
          jsonResponse({
            deleted: true,
            episodesDeleted: 1,
            filesAttempted: 2,
            filesDeleted: 2,
            filesFailed: 0,
          })
        );
      }
      // graph fetch (counts + export)
      return Promise.resolve(
        jsonResponse({
          nodes: [
            { id: 'v1', kind: 'vocab' },
            { id: 'v2', kind: 'vocab' },
            { id: 'g1', kind: 'grammar' },
          ],
          edges: [],
        })
      );
    });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  });

  it('lists the learner courses', () => {
    render(<CourseManagement courses={COURSES} />);
    expect(screen.getByText('German')).toBeInTheDocument();
    expect(screen.getByText('Spanish')).toBeInTheDocument();
  });

  it('exports the memory graph for a course', async () => {
    render(<CourseManagement courses={COURSES} />);
    fireEvent.click(screen.getAllByRole('button', { name: /export vocab/i })[0]);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/courses/c1/graph');
  });

  it('blocks deletion until the language code is typed exactly', async () => {
    render(<CourseManagement courses={COURSES} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove language/i })[0]);

    // Loss summary reflects the fetched counts.
    await waitFor(() =>
      expect(screen.getByText(/2 tracked words and 1 grammar points/i)).toBeInTheDocument()
    );

    const deleteBtn = screen.getByRole('button', { name: /delete permanently/i });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type the language code/i), { target: { value: 'es' } });
    expect(deleteBtn).toBeDisabled(); // wrong code (course is 'de')

    fireEvent.change(screen.getByLabelText(/type the language code/i), { target: { value: 'de' } });
    expect(deleteBtn).toBeEnabled();
  });

  it('removing a language sends the confirm token and refreshes', async () => {
    render(<CourseManagement courses={COURSES} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove language/i })[0]);
    fireEvent.change(screen.getByLabelText(/type the language code/i), { target: { value: 'de' } });
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/courses/c1',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ confirm: 'de' }) })
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('resetting deletes then routes into placement for the same pair', async () => {
    render(<CourseManagement courses={COURSES} />);
    fireEvent.click(screen.getAllByRole('button', { name: /reset & restart/i })[0]);
    fireEvent.change(screen.getByLabelText(/type the language code/i), { target: { value: 'de' } });
    fireEvent.click(screen.getByRole('button', { name: /delete & restart/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/learn/placement?native=en&target=de')
    );
  });
});
