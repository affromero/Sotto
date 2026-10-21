import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AboutPage from '@/app/about/page';
import SupportPage from '@/app/support/page';

describe('public support destinations', () => {
  it.each([
    { name: 'support', Page: SupportPage },
    { name: 'about', Page: AboutPage },
  ])('offers actual project support and operator directions on $name', ({ Page }) => {
    render(<Page />);
    const main = within(screen.getByRole('main'));
    expect(main.getByText(/Contact .*operator/)).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'project issue' })).toHaveAttribute(
      'href',
      'https://github.com/affromero/Sotto/issues'
    );
    expect(
      main.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('mailto:'))
    ).toEqual([]);
  });

  it('keeps the community support destination available', () => {
    render(<SupportPage />);
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Discord server' })
    ).toHaveAttribute('href', 'https://discord.gg/Dm4T42RXa');
  });
});
