import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WritingSection } from '@/components/learn/WritingSection';

describe('writing directions', () => {
  it('shows the matching native direction while retaining the learner draft', () => {
    const setText = vi.fn();
    render(
      <WritingSection
        sectionId="writing"
        prompts={[
          {
            id: 'w1',
            order: 1,
            task: 'Напиши приветствие.',
            response: null,
          },
        ]}
        drafts={{
          drafts: { w1: { text: 'Mi borrador', result: null } },
          setText,
          changedIds: ['w1'],
          hasChanges: true,
          isOverLimit: false,
          isSubmitting: false,
          error: '',
          submit: async () => false,
        }}
        prerequisiteDirections={{
          classId: 'class',
          sourceHash: 'a'.repeat(64),
          nativeLang: 'es',
          directions: {
            guided: 'Inténtalo.',
            tasks: [
              {
                sectionId: 'writing',
                taskId: 'w1',
                kind: 'writing',
                instruction: 'Escribe un saludo.',
              },
            ],
          },
        }}
      />
    );
    const card = screen.getByRole('article', { name: 'Writing prompt 1 of 1' });
    expect(card).toHaveAccessibleDescription('Escribe un saludo.');
    expect(screen.getByText('Escribe un saludo.')).toHaveAttribute('lang', 'es');
    const draft = screen.getByRole('textbox', { name: 'Your written response for prompt 1' });
    expect(draft).toHaveValue('Mi borrador');
    fireEvent.change(draft, { target: { value: 'Mi borrador nuevo' } });
    expect(setText).toHaveBeenCalledWith('w1', 'Mi borrador nuevo');
  });
});
