import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PracticePage from '@/app/(dashboard)/learn/practice/page';

const boundary = vi.hoisted(() => ({ auth: vi.fn(), courses: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: boundary.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { course: { findMany: boundary.courses } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => {
  boundary.auth.mockResolvedValue({ user: { id: 'learner' } });
  boundary.courses.mockImplementation(
    async ({ where }: { where: { userId: string; id?: string } }) => {
      const rows = [
        { id: 'de', userId: 'learner', targetLang: 'de', curriculum: { title: 'German' } },
        { id: 'es', userId: 'learner', targetLang: 'es', curriculum: { title: 'Spanish' } },
        { id: 'private', userId: 'other', targetLang: 'fr', curriculum: { title: 'Private' } },
      ];
      return rows.filter(
        (row) => row.userId === where.userId && (!where.id || row.id === where.id)
      );
    }
  );
  vi.stubGlobal('fetch', async () =>
    Response.json({ due: { vocab: 0, grammar: 0 }, totalVocab: 0, recent: [] })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('shows only the selected owned course when opened from its course card', async () => {
  render(await PracticePage({ searchParams: Promise.resolve({ course: 'de' }) }));
  expect(screen.getByRole('heading', { name: 'German' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Spanish' })).not.toBeInTheDocument();
});

it('shows all owned courses when no course is selected', async () => {
  render(await PracticePage({}));
  expect(screen.getByRole('heading', { name: 'German' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Spanish' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Private' })).not.toBeInTheDocument();
});

it('does not fall back to another course for an unowned selection', async () => {
  render(await PracticePage({ searchParams: Promise.resolve({ course: 'private' }) }));
  expect(screen.getByText('Course not found.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'German' })).not.toBeInTheDocument();
});
