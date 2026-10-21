import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivacyPage from '@/app/privacy/page';

afterEach(() => vi.unstubAllEnvs());

describe('public privacy information', () => {
  it('offers the configured operator deletion contact without requiring an app', () => {
    vi.stubEnv('SOTTO_PRIVACY_CONTACT_EMAIL', 'operator@example.test');
    render(<PrivacyPage />);
    const main = within(screen.getByRole('main'));
    const contact = main.getByRole('link', { name: /Request Sotto profile deletion/ });
    const destination = new URL(contact.getAttribute('href')!);
    expect(destination.protocol).toBe('mailto:');
    expect(decodeURIComponent(destination.pathname)).toBe('operator@example.test');
    expect(main.getByText(/request deletion without installing Sotto/)).toBeInTheDocument();
    expect(document.getElementById('delete-profile')).toBeVisible();
  });

  it('explains game report recipients and private blocks without inventing a contact', () => {
    vi.stubEnv('SOTTO_PRIVACY_CONTACT_EMAIL', '');
    render(<PrivacyPage />);
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { name: 'Game safety and reports' })).toBeVisible();
    expect(main.getByText(/Reports include the selected text/)).toHaveTextContent(/operator/);
    expect(main.getByText(/Block lists are private/)).toHaveTextContent(
      /reporting player and server operator/
    );
    expect(
      main.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('mailto:'))
    ).toEqual([]);
  });
});
