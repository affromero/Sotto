import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VocabularySupport } from '@sotto/shared';
import { VocabularySupportSettings } from '@/components/learn/vocabulary/VocabularySupportSettings';
import { StepContextReview } from '@/app/welcome/steps/StepContextReview';

afterEach(() => vi.unstubAllGlobals());

describe('learner vocabulary support', () => {
  it('asks during onboarding and lets a learner change the starting support', async () => {
    function Onboarding() {
      const [value, setValue] = useState<VocabularySupport | null>(null);
      return (
        <StepContextReview
          baseLang="en"
          language="de"
          level="A2"
          contextItems={[]}
          vocabularySupport={value}
          onVocabularySupportChange={setValue}
          onNext={() => {}}
          onBack={() => {}}
        />
      );
    }
    const user = userEvent.setup();
    render(<Onboarding />);
    expect(
      await screen.findByRole('group', { name: /what makes vocabulary difficult/i })
    ).toBeVisible();
    const meaning = screen.getByRole('radio', { name: /forget what a word means/i });
    await user.click(meaning);
    expect(meaning).toBeChecked();
    const unsure = screen.getByRole('radio', { name: /not sure yet/i });
    await user.click(unsure);
    expect(unsure).toBeChecked();
  });

  it('saves a revised course setting and reports the successful change', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<VocabularySupportSettings courseId="course-1" current="WORD_RECALL" />);
    await user.click(await screen.findByRole('radio', { name: /forget what a word means/i }));
    await user.click(screen.getByRole('button', { name: 'Save vocabulary support' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/courses/course-1/vocabulary-support',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ vocabularySupport: 'MEANING_RECALL' }),
      })
    );
    expect(screen.getByRole('button', { name: 'Save vocabulary support' })).toBeDisabled();
  });

  it('keeps a failed selection available for retry and can clear support', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<VocabularySupportSettings courseId="course-1" current="MEANING_RECALL" />);
    const unsure = await screen.findByRole('radio', { name: /not sure yet/i });
    await user.click(unsure);
    await user.click(screen.getByRole('button', { name: 'Save vocabulary support' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not save/i));
    expect(unsure).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save vocabulary support' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));
    expect(fetch.mock.calls.at(-1)?.[1].body).toBe(JSON.stringify({ vocabularySupport: null }));
  });
});
