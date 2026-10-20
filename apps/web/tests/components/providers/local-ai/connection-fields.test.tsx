import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionFields } from '@/app/welcome/steps/agent/ConnectionFields';

function Connection({ keyed = false, busy = false }: { keyed?: boolean; busy?: boolean }) {
  const [fields, setFields] = useState({ value: '', model: '', apiKey: '' });
  const [detected, setDetected] = useState(keyed);
  const [submitted, setSubmitted] = useState('');
  return (
    <>
      <ConnectionFields
        method={keyed ? 'key' : 'url'}
        providerName="Workshop"
        {...fields}
        detected={detected}
        hasSavedKey={keyed}
        busy={busy}
        focusKey={!detected}
        canSave
        outcome={null}
        onOverride={() => setDetected(false)}
        onChange={(field, value) => setFields({ ...fields, [field]: value })}
        onSave={async () => {
          setSubmitted(JSON.stringify(fields));
        }}
      />
      <output aria-label="Submitted connection">{submitted}</output>
    </>
  );
}

describe('connection entry', () => {
  it('requires a valid address and model but permits unauthenticated servers', async () => {
    const user = userEvent.setup();
    render(<Connection />);
    const save = screen.getByRole('button', { name: 'Save configuration' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Endpoint URL'), 'file:///etc/model');
    await user.type(screen.getByLabelText('Workshop model name'), 'seminar');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Endpoint URL'));
    await user.type(screen.getByLabelText('Endpoint URL'), 'https://inference.example/v1{Enter}');
    expect(screen.getByLabelText('Submitted connection')).toHaveTextContent('');
    expect(save).toBeEnabled();
    await user.click(save);
    expect(JSON.parse(screen.getByLabelText('Submitted connection').textContent!)).toEqual({
      value: 'https://inference.example/v1',
      model: 'seminar',
      apiKey: '',
    });
  });

  it('requires an explicit override to expose a saved provider key editor', async () => {
    const user = userEvent.setup();
    render(<Connection keyed />);
    expect(screen.queryByLabelText('Workshop API key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /override/i }));
    expect(screen.getByLabelText('Workshop API key')).toHaveFocus();
    await user.type(screen.getByLabelText('Workshop API key'), 'replacement{Enter}');
    expect(screen.getByLabelText('Submitted connection')).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(screen.getByLabelText('Submitted connection')).toHaveTextContent('replacement');
  });

  it('makes all connection inputs unavailable during persistence', () => {
    render(<Connection busy />);
    expect(screen.getByLabelText('Endpoint URL')).toBeDisabled();
    expect(screen.getByLabelText('Workshop model name')).toBeDisabled();
    expect(screen.getByLabelText('Workshop API key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
  });
});
