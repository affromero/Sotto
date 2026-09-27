import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PracticeRunner, type PracticeStart } from '@/components/learn/PracticeRunner';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const full: Extract<PracticeStart, { status: 'ready_full' }> = {
  status: 'ready_full',
  sessionId: 'session',
  kind: 'FULL',
  episodeId: 'audio',
  items: [
    { id: 'g0', prompt: 'Gestern hat Mia einen Film _____.', options: ['gesehen', 'sehen'] },
    { id: 'g1', prompt: 'Mia ist ins Kino _____.', options: ['gegangen', 'gehen'] },
    {
      id: 'r0',
      prompt: 'Wo war Mia?',
      passageText: 'Mia war gestern im Kino.',
      options: ['Im Kino', 'Zu Hause'],
    },
    { id: 'l0', prompt: 'Was bestellt Mia?', options: ['Tee', 'Kaffee'] },
  ],
  speakingPrompts: [
    { id: 's0', targetPhrase: 'Ich möchte einen Tee.', translation: 'I would like a tea.' },
  ],
  writingPrompts: [{ id: 'w0', task: 'Setze ins Perfekt.\nMia geht ins Kino.' }],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(response({ status: 'READY', audioUrl: '/lesson.mp3' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function openSection(title: string) {
  const summary = screen.getByText(title, { selector: 'summary' });
  fireEvent.click(summary);
  return summary.closest('details')!;
}

describe('practice sections', () => {
  it('keeps answers while paging and collapsing, and displays reading source text', async () => {
    render(<PracticeRunner courseId="course" start={full} onDone={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Practice audio')).toHaveAttribute('src', '/lesson.mp3')
    );
    const grammar = openSection('Grammar');
    fireEvent.click(within(grammar).getByRole('button', { name: 'Option 1: gesehen' }));
    fireEvent.click(within(grammar).getByRole('button', { name: 'Next question' }));
    expect(
      within(grammar).queryByText('Gestern hat Mia einen Film _____.')
    ).not.toBeInTheDocument();
    expect(within(grammar).getByText('Mia ist ins Kino _____.')).toBeInTheDocument();
    fireEvent.click(within(grammar).getByRole('button', { name: 'Previous question' }));
    expect(within(grammar).getByRole('button', { name: 'Option 1: gesehen' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(within(grammar).getByText('Grammar', { selector: 'summary' }));
    expect(grammar).not.toHaveAttribute('open');
    openSection('Grammar');
    expect(within(grammar).getByRole('button', { name: 'Option 1: gesehen' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const reading = openSection('Reading');
    expect(within(reading).getByText('Mia war gestern im Kino.')).toBeVisible();
    const listening = openSection('Listening');
    expect(within(listening).getByLabelText('Practice audio')).toHaveAttribute(
      'src',
      '/lesson.mp3'
    );
  });

  it('retains writing drafts across section collapse', async () => {
    render(<PracticeRunner courseId="course" start={full} onDone={vi.fn()} />);
    const section = openSection('Writing');
    const input = within(section).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Mia ist ins Kino gegangen.' } });
    fireEvent.click(within(section).getByText('Writing', { selector: 'summary' }));
    openSection('Writing');
    expect(within(section).getByRole('textbox')).toHaveValue('Mia ist ins Kino gegangen.');
    await waitFor(() => expect(screen.getByLabelText('Practice audio')).toBeInTheDocument());
  });

  it('reports missing oral material in historical sessions', () => {
    render(
      <PracticeRunner
        courseId="course"
        start={{ ...full, episodeId: undefined, speakingPrompts: [] }}
        onDone={vi.fn()}
      />
    );
    expect(within(openSection('Listening')).getByRole('alert')).toHaveTextContent(
      'no listening audio'
    );
    expect(within(openSection('Speaking')).getByRole('alert')).toHaveTextContent(
      'no speaking exercises'
    );
  });
});

describe('listening availability', () => {
  const listening: PracticeStart = {
    status: 'ready',
    sessionId: 'session',
    kind: 'LISTENING',
    items: [],
    episodeId: 'audio',
  };
  it.each([
    { status: 'FAILED', audioUrl: null },
    { status: 'READY', audioUrl: null },
  ])('shows an error for unavailable audio: $status', async (episode) => {
    fetchMock.mockResolvedValue(response(episode));
    render(<PracticeRunner courseId="course" start={listening} onDone={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed|unavailable/i);
    expect(screen.queryByText(/audio is generating/i)).not.toBeInTheDocument();
  });

  it('can recheck a failed request and then play audio', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    render(<PracticeRunner courseId="course" start={listening} onDone={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    fireEvent.click(screen.getByRole('button', { name: 'Check audio again' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Practice audio')).toHaveAttribute('src', '/lesson.mp3')
    );
    fireEvent.error(screen.getByLabelText('Practice audio'));
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be played/i);
  });

  it('shows pending generation honestly', async () => {
    fetchMock.mockResolvedValue(response({ status: 'GENERATING_AUDIO', audioUrl: null }));
    const view = render(<PracticeRunner courseId="course" start={listening} onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Listening audio is generating/)).toBeVisible());
    expect(screen.queryByLabelText('Practice audio')).not.toBeInTheDocument();
    view.unmount();
  });
});

it('keeps speaking practice open when the server refuses completion', async () => {
  fetchMock.mockResolvedValue(
    response({ error: 'Record every speaking exercise before finishing.' }, 409)
  );
  const onDone = vi.fn();
  render(
    <PracticeRunner
      courseId="course"
      start={{ status: 'ready_speaking', sessionId: 'session', prompts: [] }}
      onDone={onDone}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Finish practice' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/record every speaking/i);
  expect(onDone).not.toHaveBeenCalled();
});
