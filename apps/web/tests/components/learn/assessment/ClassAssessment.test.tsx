import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassAssessment } from '@/components/learn/assessment/ClassAssessment';

const revision = 'a'.repeat(64);
const material = {
  id: 'assessment',
  classAttempt: 1,
  assessmentAttempt: 1,
  sections: [
    {
      id: 'grammar',
      skill: 'GRAMMAR',
      passageText: null,
      audioAvailable: false,
      items: [{ id: 'q1', question: 'Choose a greeting', options: ['Hello', 'Bye', 'Yes', 'No'] }],
    },
    { id: 'writing', skill: 'WRITING', items: [{ id: 'w1', task: 'Write a greeting' }] },
  ],
};
const ready = { status: 'READY', classAttempt: 1, assessmentId: 'assessment', revision };
const receipt = {
  source: 'ASSESSMENT',
  passed: true,
  overallScore: 1,
  passedSections: 2,
  totalSections: 2,
  sections: [
    { id: 'grammar', skill: 'GRAMMAR', score: 1, passed: true },
    { id: 'writing', skill: 'WRITING', score: 1, passed: true },
  ],
};

describe('independent class assessment', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('lets the learner recheck an unresolved writing response', async () => {
    let recovered = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        if (url.endsWith('/writing/w1'))
          return Response.json({
            status: recovered ? 'COMPLETED' : 'UNRESOLVED',
            text: 'Hello',
          });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    expect(
      await screen.findByText('Your response needs recovery before continuing.')
    ).toBeVisible();
    recovered = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByText('Response saved.')).toBeVisible();
  });

  it('delivers a delayed submission to the current completion handler', async () => {
    let finishSubmission: ((response: Response) => void) | undefined;
    const firstHandler = vi.fn();
    const currentHandler = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Привет' });
        if (url.endsWith('/assessment/assessment') && init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            finishSubmission = resolve;
          });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const view = render(
      <ClassAssessment
        classId="class"
        classAttempt={1}
        onComplete={firstHandler}
        onBack={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit assessment' }));
    await waitFor(() => expect(finishSubmission).toBeDefined());
    view.rerender(
      <ClassAssessment
        classId="class"
        classAttempt={1}
        onComplete={currentHandler}
        onBack={vi.fn()}
      />
    );
    finishSubmission!(Response.json(receipt));
    await waitFor(() => expect(currentHandler).toHaveBeenCalledWith(receipt));
    expect(firstHandler).not.toHaveBeenCalled();
  });

  it('prepares only after the learner requests the observed assessment revision', async () => {
    let prepared = false;
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status') && init?.method === 'POST') {
          requests.push(JSON.parse(String(init.body)));
          prepared = true;
          return Response.json(ready);
        }
        if (url.endsWith('/assessment/status'))
          return Response.json(
            prepared ? ready : { status: 'AVAILABLE', classAttempt: 1, revision }
          );
        if (url.endsWith('/writing/w1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    const button = await screen.findByRole('button', { name: 'Prepare assessment' });
    expect(requests).toEqual([]);
    fireEvent.click(button);
    expect(await screen.findByText('Choose a greeting')).toBeInTheDocument();
    expect(requests).toEqual([{ classAttempt: 1, revision }]);
  });

  it('explains when the current speaking practice cannot yet be assessed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status') && init?.method === 'POST')
          return Response.json(
            {
              error:
                'This speaking assessment cannot yet be graded with the current practice format.',
            },
            { status: 409 }
          );
        if (url.endsWith('/assessment/status'))
          return Response.json({ status: 'AVAILABLE', classAttempt: 1, revision });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare assessment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot yet be graded');
  });

  it('preserves answers and unsent writing after returning to the assessment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const first = render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    fireEvent.change(screen.getByLabelText('Write a greeting'), { target: { value: 'Привет' } });
    await waitFor(() => expect(sessionStorage.length).toBe(1));
    first.unmount();
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    expect(await screen.findByLabelText('Hello')).toBeChecked();
    expect(screen.getByLabelText('Write a greeting')).toHaveValue('Привет');
  });

  it('keeps a different local draft accessible until the learner accepts the saved response', async () => {
    const key = `assessment:${JSON.stringify(['owner', 'class', 1, 'assessment', revision])}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({ choices: { q1: 0 }, drafts: { w1: 'Local draft' }, pending: null })
    );
    const complete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Saved elsewhere' });
        if (url.endsWith('/assessment/assessment') && init?.method === 'POST')
          return Response.json(receipt);
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={complete} onBack={vi.fn()} />
    );
    expect(await screen.findByLabelText('Write a greeting')).toHaveValue('Local draft');
    expect(screen.getByText(/Saved response: Saved elsewhere/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit assessment' })).toBeDisabled();
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
      drafts: { w1: 'Local draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use saved response' }));
    expect(screen.getByLabelText('Write a greeting')).toHaveValue('Saved elsewhere');
    fireEvent.click(screen.getByRole('button', { name: 'Submit assessment' }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt));
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
      drafts: { w1: 'Saved elsewhere' },
    });
  });

  it('preserves an intentionally empty draft when a saved response appears on refresh', async () => {
    let saved = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json(
            saved ? { status: 'COMPLETED', text: 'Saved elsewhere' } : { status: 'NOT_STARTED' }
          );
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    const draft = await screen.findByLabelText('Write a greeting');
    fireEvent.change(draft, { target: { value: 'Something' } });
    fireEvent.change(draft, { target: { value: '' } });
    saved = true;
    fireEvent.focus(window);
    expect(await screen.findByText(/Saved response: Saved elsewhere/)).toBeInTheDocument();
    expect(screen.getByLabelText('Write a greeting')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Submit assessment' })).toBeDisabled();
  });

  it('allows a pending submission to resume after resolving a local writing conflict', async () => {
    const key = `assessment:${JSON.stringify(['owner', 'class', 1, 'assessment', revision])}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        choices: { q1: 0 },
        drafts: { w1: 'Local draft' },
        pending: [{ itemId: 'q1', selectedIndex: 0 }],
      })
    );
    const complete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Saved response' });
        if (url.endsWith('/assessment/assessment') && init?.method === 'POST')
          return Response.json(receipt);
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={complete} onBack={vi.fn()} />
    );
    expect(await screen.findByRole('button', { name: 'Retry submission' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use saved response' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt));
  });

  it('does not restore a different profile’s assessment work', async () => {
    let active = 'owner';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: active });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const first = render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    fireEvent.change(screen.getByLabelText('Write a greeting'), {
      target: { value: 'Private response' },
    });
    await waitFor(() => expect(sessionStorage.length).toBe(1));
    first.unmount();
    active = 'other';
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    expect(await screen.findByLabelText('Hello')).not.toBeChecked();
    expect(screen.getByLabelText('Write a greeting')).toHaveValue('');
  });

  it('preserves unreadable retained work instead of overwriting it', async () => {
    const key = `assessment:${JSON.stringify(['owner', 'class', 1, 'assessment', revision])}`;
    sessionStorage.setItem(key, '{unreadable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not retain');
    expect(sessionStorage.getItem(key)).toBe('{unreadable');
  });

  it('does not show questions when the assessment revision changes during loading', async () => {
    let checks = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status'))
          return Response.json({ ...ready, revision: checks++ ? 'b'.repeat(64) : revision });
        if (url.endsWith('/writing/w1')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('The assessment changed');
    expect(screen.queryByText('Choose a greeting')).not.toBeInTheDocument();
  });

  it('recovers a committed assessment after the submission response is lost', async () => {
    let committed = false;
    const complete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status'))
          return committed ? new Response(null, { status: 409 }) : Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Привет' });
        if (url.endsWith('/assessment/assessment') && init?.method === 'POST') {
          committed = true;
          throw new Error('Connection lost');
        }
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        if (url === '/api/v1/classes/class')
          return Response.json({
            id: 'class',
            attempt: 1,
            submitted: true,
            submission: { receipt },
          });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={complete} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit assessment' }));
    expect(await screen.findByRole('button', { name: 'Retry submission' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt));
  });

  it('allows corrections after a definite rejection and an unchanged unsubmitted assessment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Привет' });
        if (url.endsWith('/assessment/assessment') && init?.method === 'POST')
          return new Response(null, { status: 409 });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        if (url === '/api/v1/classes/class')
          return Response.json({ id: 'class', attempt: 1, submitted: false });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    const first = render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit assessment' }));
    await screen.findByRole('button', { name: 'Change answers' });
    await waitFor(() =>
      expect(sessionStorage.getItem(sessionStorage.key(0)!)).toContain('"rejected":true')
    );
    first.unmount();
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    const change = await screen.findByRole('button', { name: 'Change answers' });
    expect(screen.getByLabelText('Bye')).toBeDisabled();
    fireEvent.click(change);
    await waitFor(() => expect(screen.getByLabelText('Bye')).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Bye'));
    expect(screen.getByLabelText('Bye')).toBeChecked();
  });

  it('does not display a late result after the active profile changes', async () => {
    let currentOwner = 'owner';
    let resolveSubmission!: (response: Response) => void;
    const complete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: currentOwner });
        if (url.endsWith('/assessment/status'))
          return currentOwner === 'owner'
            ? Response.json(ready)
            : new Response(null, { status: 403 });
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Привет' });
        if (url.endsWith('/assessment/assessment') && init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            resolveSubmission = resolve;
          });
        if (url.endsWith('/assessment/assessment')) return Response.json(material);
        if (url === '/api/v1/classes/class') return new Response(null, { status: 404 });
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={complete} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit assessment' }));
    await waitFor(() => expect(resolveSubmission).toBeDefined());
    currentOwner = 'other';
    fireEvent.focus(window);
    resolveSubmission(Response.json(receipt));
    await screen.findByRole('alert');
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a greeting')).not.toBeVisible();
  });

  it('keeps submission disabled when a speaking task is required', async () => {
    const speaking = {
      ...material,
      sections: [
        ...material.sections,
        {
          id: 'speaking',
          skill: 'SPEAKING',
          items: [
            { id: 's1', task: 'Say hello', mode: 'COMMUNICATIVE', referenceAudioAvailable: false },
            { id: 's 2', task: 'Read aloud', mode: 'READ_ALOUD', referenceAudioAvailable: true },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        if (url.endsWith('/assessment/status')) return Response.json(ready);
        if (url.endsWith('/writing/w1'))
          return Response.json({ status: 'COMPLETED', text: 'Привет' });
        if (url.endsWith('/speaking/s%202')) return Response.json({ status: 'NOT_STARTED' });
        if (url.endsWith('/assessment/assessment')) return Response.json(speaking);
        throw new Error(`Unexpected request: ${url}`);
      })
    );
    render(
      <ClassAssessment classId="class" classAttempt={1} onComplete={vi.fn()} onBack={vi.fn()} />
    );
    fireEvent.click(await screen.findByLabelText('Hello'));
    expect(
      screen.getByText('Speaking assessment is not available for this task yet.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Speaking assessment reference audio')).toHaveAttribute(
      'src',
      '/api/v1/classes/class/assessment/assessment/audio/speaking/s%202'
    );
    expect(screen.getByRole('button', { name: 'Submit assessment' })).toBeDisabled();
  });
});
