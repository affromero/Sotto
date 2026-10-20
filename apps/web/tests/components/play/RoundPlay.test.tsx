import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayMode, PlaySeat } from '@sotto/shared';
import { RoundPlay } from '@/components/play/RoundPlay';
import { advancePlayRound, createPlayRounds, otherPlaySeat } from '@/lib/play/engine';
import { projectPlayRound } from '@/lib/play/projection';

function Game({ mode }: { mode: PlayMode }) {
  const [round, setRound] = useState(
    () =>
      createPlayRounds({
        kind: mode,
        theme: 'FOOD',
        players: {
          HOST: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
          GUEST: { nativeLang: 'en', targetLang: 'es', level: 'B1' },
        },
      })[0]
  );
  const [viewer, setViewer] = useState<PlaySeat>('HOST');
  return (
    <>
      <button type="button" onClick={() => setViewer(otherPlaySeat(viewer))}>
        Switch player
      </button>
      <p>Viewing {viewer}</p>
      <RoundPlay
        key={viewer}
        round={projectPlayRound(round, viewer)}
        busy={false}
        onCommand={async (command) => {
          setRound((current) => advancePlayRound(current, viewer, command));
          return true;
        }}
      />
    </>
  );
}

describe('playable card and conversation rounds', () => {
  it('preserves an unsent mission line when the partner starts the exchange', () => {
    const round = createPlayRounds({
      kind: 'MISSION',
      theme: 'FOOD',
      players: {
        HOST: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
        GUEST: { nativeLang: 'en', targetLang: 'es', level: 'A1' },
      },
    })[0];
    const display = render(
      <RoundPlay
        round={projectPlayRound(round, 'HOST')}
        busy={false}
        onCommand={async () => true}
      />
    );
    fireEvent.change(screen.getByLabelText('Your next line'), {
      target: { value: 'My unsent reply' },
    });
    const incoming = advancePlayRound(round, 'GUEST', {
      type: 'MESSAGE',
      text: 'Let’s cook together.',
    });
    display.rerender(
      <RoundPlay
        round={projectPlayRound(incoming, 'HOST')}
        busy={false}
        onCommand={async () => true}
      />
    );
    expect(screen.getByLabelText('Your next line')).toHaveValue('My unsent reply');
    expect(screen.getByText('Let’s cook together.')).toBeInTheDocument();
  });
  it('does not carry a custom secret draft into the clue when a suggestion is selected', async () => {
    render(<Game mode="DESCRIBE" />);
    fireEvent.change(screen.getByLabelText('Your secret word or phrase'), {
      target: { value: 'private draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Apfel/ }));
    expect(await screen.findByLabelText('One clue, without saying the word')).toHaveValue('');
    expect(screen.queryByDisplayValue('private draft')).not.toBeInTheDocument();
  });

  it('keeps a new clue when the previous secret submission finishes later', async () => {
    let finish: ((value: boolean) => void) | undefined;
    function DelayedGame() {
      const [round, setRound] = useState(
        () =>
          createPlayRounds({
            kind: 'DESCRIBE',
            theme: 'FOOD',
            players: {
              HOST: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
              GUEST: { nativeLang: 'en', targetLang: 'es', level: 'A1' },
            },
          })[0]
      );
      return (
        <RoundPlay
          round={projectPlayRound(round, 'HOST')}
          busy={false}
          onCommand={(command) => {
            setRound((current) => advancePlayRound(current, 'HOST', command));
            return new Promise<boolean>((resolve) => {
              finish = resolve;
            });
          }}
        />
      );
    }
    render(<DelayedGame />);
    fireEvent.change(screen.getByLabelText('Your secret word or phrase'), {
      target: { value: 'Koala' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this secret' }));
    const clue = await screen.findByLabelText('One clue, without saying the word');
    fireEvent.change(clue, { target: { value: 'It lives in a tree.' } });
    await act(async () => {
      finish?.(true);
    });
    expect(clue).toHaveValue('It lives in a tree.');
  });
  it('locks independent picks and reveals the match only when both players choose', async () => {
    render(<Game mode="KNOW_ME" />);
    const options = screen
      .getAllByRole('button')
      .filter((button) => button.textContent?.startsWith('A'));
    const firstLabel = options[0].textContent!;
    fireEvent.click(options[0]);
    await waitFor(() => expect(screen.getByText(/Your pick is locked/)).toBeInTheDocument());
    expect(screen.queryByText('Partner’s pick')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch player' }));
    await waitFor(() => expect(screen.getByText('Viewing GUEST')).toBeInTheDocument());
    expect(screen.getByText(/Your partner has picked/)).toBeInTheDocument();
    expect(screen.queryByText('Your pick')).not.toBeInTheDocument();
    const sameOption = screen.getByRole('button', {
      name: (name) => name.replace(/\s/g, '') === firstLabel.replace(/\s/g, ''),
    });
    fireEvent.click(sameOption);
    await waitFor(() => expect(screen.getByText('You picked the same card!')).toBeInTheDocument());
    expect(screen.getByText('2 points together')).toBeInTheDocument();
    expect(screen.getByText('Partner’s pick')).toBeInTheDocument();
  });

  it('keeps a selected word private through a clue, then reveals it after a guess', async () => {
    render(<Game mode="DESCRIBE" />);
    const apple = screen.getByRole('button', { name: /Apfel/ });
    fireEvent.click(apple);
    await waitFor(() =>
      expect(screen.getByLabelText('One clue, without saying the word')).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText('One clue, without saying the word'), {
      target: { value: 'Es ist rot und wächst am Baum.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send clue' }));
    await waitFor(() => expect(screen.getByText('The clue')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Switch player' }));
    await waitFor(() => expect(screen.getByLabelText('Your guess')).toBeInTheDocument());
    expect(screen.queryByText('Apfel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apfel/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your guess'), { target: { value: 'Ein Apfel?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make a guess' }));
    await waitFor(() => expect(screen.getByText('Secret word')).toBeInTheDocument());
    expect(screen.getByText('Apfel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, understood' }));
    await waitFor(() => expect(screen.getByText('You understood each other.')).toBeInTheDocument());
  });

  it('shows a turn budget and a twist before either player can finish a mission', async () => {
    render(<Game mode="MISSION" />);
    expect(screen.getByText('6 messages left between you')).toBeInTheDocument();
    const lines = [
      'Kochen wir Gemüse?',
      'Wir haben zwanzig Minuten.',
      'Unser Freund kann mitessen.',
      'Ich bringe einen Teller.',
    ];
    for (let index = 0; index < lines.length; index++) {
      await waitFor(() => expect(screen.getByLabelText('Your next line')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText('Your next line'), {
        target: { value: lines[index] },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send line' }));
      await waitFor(() => expect(screen.getByText(lines[index])).toBeInTheDocument());
      if (index < 3)
        expect(screen.queryByRole('button', { name: 'Yes, got it' })).not.toBeInTheDocument();
      if (index === 2) expect(screen.getByText('Plot twist')).toBeInTheDocument();
      if (index < 3) fireEvent.click(screen.getByRole('button', { name: 'Switch player' }));
    }
    expect(screen.getByText('2 messages left between you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, got it' })).toBeInTheDocument();
    expect(screen.queryByText('Partner’s secret objective')).not.toBeInTheDocument();
  });
});
