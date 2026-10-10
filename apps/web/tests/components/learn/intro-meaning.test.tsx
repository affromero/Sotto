import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassHub } from '@/components/learn/ClassHub';
import WorksheetPage from '@/app/classes/[classId]/worksheet/page';

const boundary = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'learner' } }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { courseClass: { findFirst: boundary.findFirst } } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not found');
  },
}));

afterEach(cleanup);

describe('intro example meaning display', () => {
  it.each([true, false])(
    'shows distinct meaning without repeating an identical target (%s)',
    async (identical) => {
      const target = 'Ich habe gestern einen Film gesehen.';
      const meaning = identical ? target : 'I watched a film yesterday.';
      const intro = {
        purpose: 'Erzähle von gestern.',
        about: target,
        focus: ['Das Perfekt beschreibt Vergangenes.'],
        examples: [{ target, meaning, note: 'Sehen verwendet hier haben.' }],
        tips: ['Nenne den Tag.'],
      };
      const lesson = { title: 'Gestern', level: 'A2', objective: 'Erzähle von gestern.' };
      const { container, unmount } = render(
        <ClassHub
          classId="class-1"
          courseId="course-1"
          lesson={lesson}
          intro={intro}
          order={1}
          sections={[]}
          scores={{}}
          started={false}
          onBegin={vi.fn()}
          onRegenerate={vi.fn()}
        />
      );
      const summary = container.querySelector('details summary');
      expect(summary?.querySelector('b')?.textContent).toBe(target);
      expect(summary?.querySelector('span')?.textContent ?? null).toBe(identical ? null : meaning);
      expect(container.querySelector('details small')?.textContent).toBe(intro.examples[0].note);
      unmount();

      boundary.findFirst.mockResolvedValue({
        id: 'class-1',
        course: { nativeLang: 'en', targetLang: 'de' },
        lesson: { ...lesson, grammarPoints: ['Perfekt'], targetVocab: [] },
        adaptiveSeed: { intro },
        sourceTitle: null,
        sections: [],
      });
      render(await WorksheetPage({ params: Promise.resolve({ classId: 'class-1' }) }));
      const example = screen.getByRole('heading', { name: target, level: 3 }).closest('article');
      expect(example?.querySelector('p')?.textContent ?? null).toBe(identical ? null : meaning);
      expect(example?.querySelector('small')?.textContent).toBe(intro.examples[0].note);
    }
  );
});
