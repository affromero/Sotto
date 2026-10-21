import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLAY_CONDUCT_PARAGRAPHS, PLAY_CONDUCT_TITLE } from '@sotto/shared';
import TermsPage from '@/app/terms/page';

describe('public game conduct', () => {
  it('publishes the same conduct players accept and identifies the report recipient', () => {
    render(<TermsPage />);
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { name: `7. ${PLAY_CONDUCT_TITLE}` })).toBeVisible();
    for (const paragraph of PLAY_CONDUCT_PARAGRAPHS) {
      expect(main.getByText(paragraph)).toBeVisible();
    }
    expect(main.getByText(/Use Report or block/)).toHaveTextContent(/server's owner/);
    expect(
      main.getByRole('link', { name: /privacy information and operator contact/ })
    ).toHaveAttribute('href', '/privacy');
  });
});
