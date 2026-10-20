'use client';

import { useState, type FormEvent } from 'react';
import type { PlayRoundCommand, PlayRoundView } from '@sotto/shared';
import styles from './RoundPlay.module.css';

const names = {
  DESCRIBE: 'Describe & guess',
  KNOW_ME: 'Pick & predict',
  MISSION: 'Secret mission',
};
const prompts = {
  SET_TARGET: { label: 'Your secret word or phrase', button: 'Keep this secret' },
  GIVE_CLUE: { label: 'One clue, without saying the word', button: 'Send clue' },
  GUESS: { label: 'Your guess', button: 'Make a guess' },
  ANSWER: { label: 'Your answer', button: 'Lock in answer' },
  MESSAGE: { label: 'Your next line', button: 'Send line' },
};

export function RoundPlay({
  round,
  busy,
  onCommand,
}: {
  round: PlayRoundView;
  busy: boolean;
  onCommand: (command: PlayRoundCommand) => Promise<boolean>;
}) {
  const [draftEntry, setDraftEntry] = useState({ key: '', text: '' });
  const [hint, setHint] = useState('');
  const [correction, setCorrection] = useState('');
  const [meanings, setMeanings] = useState(false);
  const entry = (['SET_TARGET', 'GIVE_CLUE', 'GUESS', 'ANSWER', 'MESSAGE'] as const).find((type) =>
    round.allowedActions.includes(type)
  );
  const ownMessages =
    round.mode === 'MISSION'
      ? round.messages.filter(
          (message) => (message.seat === round.learner) === (round.role === 'LEARNER')
        ).length
      : '';
  const draftKey = `${round.phase}:${entry ?? ''}:${ownMessages}`;
  const draft = draftEntry.key === draftKey ? draftEntry.text : '';
  const setDraft = (text: string) => setDraftEntry({ key: draftKey, text });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!entry || !draft.trim() || busy) return;
    if (await onCommand({ type: entry, text: draft.trim() }))
      setDraftEntry((current) =>
        current.key === draftKey && current.text === draft ? { key: draftKey, text: '' } : current
      );
  };
  const cards =
    round.mode === 'KNOW_ME' && round.questionStyle === 'CHOICES'
      ? round.choices
      : round.mode === 'DESCRIBE' && round.phase === 'SETUP'
        ? round.targetSuggestions
        : null;
  const ownPick = round.mode === 'KNOW_ME' ? round.ownAnswer : null;
  const otherPick = round.mode === 'KNOW_ME' ? round.otherAnswer : null;
  const choosing =
    round.allowedActions.includes('CHOOSE') || round.allowedActions.includes('SET_TARGET');

  return (
    <section className={styles.root} aria-label={names[round.mode]}>
      <div className={styles.meta}>
        <span>{names[round.mode]}</span>
        <span>
          {round.targetLang.toUpperCase()} · {round.level} ·{' '}
          {round.role === 'LEARNER' ? 'Your language turn' : 'Partner turn'}
        </span>
      </div>
      <h2 className={styles.prompt}>{round.prompt}</h2>
      <p className={styles.instruction}>{round.instruction}</p>
      {cards && (
        <>
          <div className={styles.cards}>
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                disabled={busy || !choosing}
                className={`${styles.card} ${ownPick === card.id ? styles.picked : ''}`}
                onClick={() => {
                  void onCommand(
                    round.mode === 'DESCRIBE'
                      ? { type: 'SET_TARGET', text: card.text }
                      : { type: 'CHOOSE', optionId: card.id }
                  );
                }}
              >
                <span className={styles.cardIndex}>{card.id}</span>
                <span className={styles.word} lang={round.targetLang}>
                  {card.text}
                </span>
                {meanings && card.supportText && (
                  <span className={styles.meaning} lang={round.supportLang}>
                    {card.supportText}
                  </span>
                )}
                {ownPick === card.id && <span className={styles.pickLabel}>Your pick</span>}
                {otherPick === card.id && <span className={styles.pickLabel}>Partner’s pick</span>}
              </button>
            ))}
          </div>
          {cards.some((card) => card.supportText) && (
            <button
              type="button"
              className={styles.textButton}
              aria-pressed={meanings}
              onClick={() => setMeanings(!meanings)}
            >
              {meanings ? 'Hide meanings' : 'Show meanings'}
            </button>
          )}
        </>
      )}
      {round.mode === 'DESCRIBE' && (
        <>
          {round.role === 'LEARNER' &&
            round.phase === 'SETUP' &&
            round.targetSuggestions === null && (
              <p>Word cards are unavailable for this language. Enter your own word or phrase.</p>
            )}
          {round.target && (
            <p className={styles.languageLine}>
              <span>{round.revealed ? 'Secret word' : 'Only you can see this'}</span>
              <strong lang={round.targetLang}>{round.target}</strong>
            </p>
          )}
          {round.clue && (
            <p className={styles.languageLine}>
              <span>The clue</span>
              <strong lang={round.targetLang}>{round.clue}</strong>
            </p>
          )}
          {round.guess && (
            <p className={styles.languageLine}>
              <span>The guess</span>
              <strong lang={round.targetLang}>{round.guess}</strong>
            </p>
          )}
        </>
      )}
      {round.mode === 'KNOW_ME' && round.questionStyle === 'OPEN' && (
        <>
          {round.ownAnswer && (
            <p className={styles.languageLine}>
              <span>Your locked answer</span>
              <strong lang={round.targetLang}>{round.ownAnswer}</strong>
            </p>
          )}
          {round.otherAnswer && (
            <p className={styles.languageLine}>
              <span>Partner’s answer</span>
              <strong lang={round.targetLang}>{round.otherAnswer}</strong>
            </p>
          )}
        </>
      )}
      {round.mode === 'KNOW_ME' && !round.revealed && (
        <p className={styles.waiting} role="status">
          {round.ownAnswer
            ? 'Your pick is locked. Waiting for your partner.'
            : round.otherCommitted
              ? 'Your partner has picked. Your turn.'
              : 'Your answers stay hidden until both of you commit.'}
        </p>
      )}
      {round.mode === 'MISSION' && (
        <>
          <div className={styles.objective}>
            <span>Your secret objective</span>
            <p>{round.ownObjective}</p>
          </div>
          <p className={styles.budget} role="status">
            {round.remainingMessages} {round.remainingMessages === 1 ? 'message' : 'messages'} left
            between you
          </p>
          {round.twist && (
            <div className={styles.twist} role="status">
              <strong>Plot twist</strong>
              <p>{round.twist}</p>
            </div>
          )}
          <ol className={styles.messages}>
            {round.messages.map((message, index) => (
              <li key={index}>
                <span>{message.seat === round.learner ? 'Learner' : 'Partner'}</span>
                <p lang={round.targetLang}>{message.text}</p>
              </li>
            ))}
          </ol>
          {round.otherObjective && (
            <p className={styles.languageLine}>
              <span>Partner’s secret objective</span>
              <strong>{round.otherObjective}</strong>
            </p>
          )}
          {round.ownOutcome !== null && (
            <p>Your objective: {round.ownOutcome ? 'achieved' : 'still practicing'}.</p>
          )}
          {round.otherOutcome !== null && (
            <p>Partner’s objective: {round.otherOutcome ? 'achieved' : 'still practicing'}.</p>
          )}
          {round.allowedActions.includes('MISSION_DONE') && (
            <fieldset className={styles.assessment} disabled={busy}>
              <legend>Did you meet your objective?</legend>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  void onCommand({ type: 'MISSION_DONE', achieved: true });
                }}
              >
                Yes, got it
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  void onCommand({ type: 'MISSION_DONE', achieved: false });
                }}
              >
                Not quite
              </button>
            </fieldset>
          )}
          {!entry &&
            round.phase === 'EXCHANGE' &&
            !round.allowedActions.includes('MISSION_DONE') && (
              <p className={styles.waiting} role="status">
                {round.ownOutcome !== null
                  ? 'Your outcome is locked. Waiting for your partner.'
                  : 'Waiting for your partner’s line.'}
              </p>
            )}
        </>
      )}
      {entry && (
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className={styles.entry}
        >
          <label htmlFor="round-draft">{prompts[entry].label}</label>
          <textarea
            id="round-draft"
            lang={round.targetLang}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={500}
            rows={2}
            required
            disabled={busy}
          />
          <button className={styles.primary} type="submit" disabled={busy || !draft.trim()}>
            {prompts[entry].button}
          </button>
        </form>
      )}
      {round.allowedActions.includes('FEEDBACK') && (
        <fieldset className={styles.assessment} disabled={busy}>
          <legend>Did you understand your partner?</legend>
          <label htmlFor="round-correction">A natural way to say it (optional)</label>
          <textarea
            id="round-correction"
            value={correction}
            onChange={(event) => setCorrection(event.target.value)}
            maxLength={500}
            rows={2}
            lang={round.targetLang}
          />
          <button
            className={styles.primary}
            type="button"
            onClick={() => {
              void onCommand({
                type: 'FEEDBACK',
                understood: true,
                correction: correction.trim() || null,
              });
            }}
          >
            Yes, understood
          </button>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              void onCommand({
                type: 'FEEDBACK',
                understood: false,
                correction: correction.trim() || null,
              });
            }}
          >
            Let’s keep practicing
          </button>
        </fieldset>
      )}
      {round.phase === 'FEEDBACK' && !round.allowedActions.includes('FEEDBACK') && (
        <p className={styles.waiting} role="status">
          Your partner is giving feedback.
        </p>
      )}
      {round.result && (
        <div className={styles.result} role="status">
          <h3>
            {round.result.skipped
              ? 'Skipped. Try the next one.'
              : round.result.matched === true
                ? 'You picked the same card!'
                : round.result.matched === false
                  ? 'A new thing to know about each other.'
                  : round.result.understood
                    ? 'You understood each other.'
                    : 'One to try again together.'}
          </h3>
          <p>
            {round.result.points} {round.result.points === 1 ? 'point' : 'points'} together
          </p>
          {round.result.correction && <p lang={round.targetLang}>{round.result.correction}</p>}
        </div>
      )}
      {round.hints.length > 0 && (
        <aside className={styles.hints} aria-label="Shared hints">
          {round.hints.map((item, index) => (
            <p key={index} lang={round.targetLang}>
              {item.text}
            </p>
          ))}
        </aside>
      )}
      <div className={styles.utilities}>
        {round.allowedActions.includes('HINT') && (
          <details>
            <summary>Share a hint</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (hint.trim())
                  void onCommand({ type: 'HINT', text: hint.trim() }).then((saved) => {
                    if (saved) setHint('');
                  });
              }}
            >
              <label htmlFor="round-hint">A helpful word or phrase</label>
              <input
                id="round-hint"
                value={hint}
                onChange={(event) => setHint(event.target.value)}
                maxLength={500}
                disabled={busy}
                required
              />
              <button type="submit" className={styles.secondary} disabled={busy || !hint.trim()}>
                Send hint
              </button>
            </form>
          </details>
        )}
        {round.allowedActions.includes('SKIP') && (
          <button
            type="button"
            className={styles.textButton}
            disabled={busy}
            onClick={() => {
              void onCommand({ type: 'SKIP' });
            }}
          >
            Skip this round
          </button>
        )}
      </div>
      <details className={styles.guidance}>
        <summary>Language tip</summary>
        <p>{round.guidance}</p>
      </details>
    </section>
  );
}
