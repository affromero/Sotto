import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepWelcome } from '@/app/welcome/steps/StepWelcome';

function LanguageChoice() {
  const [pair, setPair] = useState({ baseLang: 'en', language: '' });
  const [submitted, setSubmitted] = useState('');
  return (
    <>
      <StepWelcome
        state={pair}
        demoMode={false}
        setBaseLang={(baseLang) => setPair({ ...pair, baseLang })}
        setLanguage={(language) => setPair({ ...pair, language })}
        onBack={() => setPair({ baseLang: 'en', language: '' })}
        onNext={() => setSubmitted(pair.baseLang + ':' + pair.language)}
      />
      <output aria-label="Selected language pair">{submitted}</output>
    </>
  );
}

it.each([
  { source: 'Русский', target: 'German', pair: 'ru:de' },
  { source: 'Español', target: 'French', pair: 'es:fr' },
])('continues with $pair after choosing both sides of the language bridge', async (choice) => {
  const user = userEvent.setup();
  render(<LanguageChoice />);
  const next = screen.getByRole('button', { name: 'Continue to agent setup' });
  expect(next).toBeDisabled();
  await user.click(screen.getByRole('button', { name: choice.source }));
  await user.click(screen.getByRole('button', { name: 'Learn ' + choice.target }));
  expect(screen.getByRole('button', { name: choice.source })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await user.click(next);
  expect(screen.getByLabelText('Selected language pair')).toHaveTextContent(choice.pair);
});
