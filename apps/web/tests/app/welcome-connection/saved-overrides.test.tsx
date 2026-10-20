import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { StepAgent } from '@/app/welcome/steps/StepAgent';
import type { AgentState } from '@/app/welcome/WelcomeFlow';

function SavedProviders() {
  const [agent, setAgent] = useState<AgentState>({
    provider: 'claude',
    method: 'key',
    value: '',
    model: '',
    status: 'connected',
  });
  return (
    <>
      <button onClick={() => setAgent((current) => ({ ...current, provider: 'claude' }))}>
        Select saved Claude
      </button>
      <button onClick={() => setAgent((current) => ({ ...current, provider: 'codex' }))}>
        Select saved Codex
      </button>
      <StepAgent
        agent={agent}
        demoMode={false}
        savedDetected={['claude', 'codex']}
        setAgent={setAgent}
        onNext={() => undefined}
        onBack={() => undefined}
      />
    </>
  );
}

it('keeps a saved key override scoped to its provider across selection changes', async () => {
  const user = userEvent.setup();
  render(<SavedProviders />);
  await user.click(await screen.findByRole('button', { name: /Override the detected/ }));
  expect(screen.getByLabelText('Claude API key')).toHaveValue('');

  await user.click(screen.getByRole('button', { name: 'Select saved Codex' }));
  expect(await screen.findByRole('button', { name: /Override the detected/ })).toBeVisible();
  expect(screen.queryByLabelText('Codex API key')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Select saved Claude' }));
  expect(screen.getByLabelText('Claude API key')).toHaveValue('');
  expect(screen.queryByRole('button', { name: /Override the detected/ })).not.toBeInTheDocument();
});
