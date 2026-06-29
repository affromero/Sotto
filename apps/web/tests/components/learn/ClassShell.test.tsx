import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassShell } from '@/components/learn/ClassShell';
import type { ClassData, ClassSection } from '@/components/learn/classTypes';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function section(skill: string, overrides: Partial<ClassSection> = {}): ClassSection {
  return {
    id: `section-${skill.toLowerCase()}`,
    skill,
    status: 'READY',
    attempt: 1,
    score: null,
    passed: null,
    episode: null,
    questions: [],
    prompts: [],
    writingPrompts: [],
    ...overrides,
  };
}

function incompleteClass(): ClassData {
  return {
    id: 'class-15',
    courseId: 'course-1',
    status: 'AVAILABLE',
    order: 15,
    passThreshold: 0.7,
    sourceUrl: null,
    sourceTitle: null,
    lesson: {
      title: 'A tricky class',
      level: 'B1',
      objective: 'Practice the target structure.',
    },
    intro: {
      purpose: 'Practice the target structure.',
      about: 'A compact class.',
      focus: ['Use the target phrase.'],
      examples: [],
      tips: [],
    },
    vocabulary: [],
    submitted: false,
    submission: null,
    sections: [
      section('GRAMMAR', {
        questions: [
          {
            id: 'q-grammar',
            order: 1,
            question: 'Pick one.',
            options: ['A', 'B'],
          },
        ],
      }),
      section('READING', {
        questions: [
          {
            id: 'q-reading',
            order: 1,
            question: 'What happened?',
            options: ['A', 'B'],
            passageText: 'A readable passage.',
          },
        ],
      }),
      section('LISTENING', {
        episode: {
          id: 'episode-1',
          audioUrl: null,
          status: 'READY',
          title: 'Listening scene',
          references: [],
        },
        questions: [
          {
            id: 'q-listening',
            order: 1,
            question: 'What did you hear?',
            options: ['A', 'B'],
          },
        ],
      }),
      section('SPEAKING', {
        prompts: [
          {
            id: 'prompt-1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
          },
        ],
      }),
      section('WRITING', {
        writingPrompts: [
          {
            id: 'writing-1',
            order: 1,
            task: 'Write one sentence.',
            response: null,
          },
        ],
      }),
    ],
  };
}

describe('ClassShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('does not regenerate an incomplete non-generating class during resume', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(incompleteClass()));

    render(<ClassShell classId="class-15" />);

    expect(
      await screen.findByText(/This class is missing required presentation material/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate class/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to learn/i })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/v1/classes/class-15?background=1',
      expect.objectContaining({ method: 'POST' })
    );

    fireEvent.click(screen.getByRole('button', { name: /back to learn/i }));
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });

  it('surfaces failed listening audio details', async () => {
    const cls = incompleteClass();
    const listening = cls.sections.find((item) => item.skill === 'LISTENING');
    if (listening?.episode) {
      listening.episode.status = 'FAILED';
      listening.episode.failureReason = 'Audio generation failed. Please try again.';
      listening.episode.technicalError =
        'R2 storage not configured - set R2_* environment variables';
    }
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(cls));

    render(<ClassShell classId="class-15" />);

    expect(await screen.findByText(/Listening section audio failed/i)).toHaveTextContent(
      /Audio generation failed/i
    );
  });
});
