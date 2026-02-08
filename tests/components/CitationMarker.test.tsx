import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationMarker } from '@/components/ui/CitationMarker';
import type { ReferenceData } from '@/types/reference';

const mockRef: ReferenceData = {
  id: 'ref-1',
  number: 1,
  title: 'A Study on AI',
  authors: ['Smith, J.', 'Doe, A.'],
  year: 2023,
  url: 'https://example.com/study',
  type: 'PAPER',
  publisher: 'Nature',
  doi: '10.1234/test1',
  verificationStatus: 'VERIFIED',
};

const mockRefNoUrl: ReferenceData = {
  id: 'ref-2',
  number: 2,
  title: 'Book Title',
  authors: ['Author'],
  year: 2021,
  url: null,
  type: 'BOOK',
  publisher: 'MIT Press',
  doi: null,
  verificationStatus: 'VERIFIED',
};

describe('CitationMarker', () => {
  it('renders the citation number', () => {
    render(<CitationMarker references={[mockRef]} />);
    expect(screen.getByRole('button')).toHaveTextContent('[1]');
  });

  it('renders grouped citation numbers', () => {
    render(<CitationMarker references={[mockRef, mockRefNoUrl]} />);
    expect(screen.getByRole('button')).toHaveTextContent('[1,2]');
  });

  it('has proper aria attributes', () => {
    render(<CitationMarker references={[mockRef]} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Citation 1');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows tooltip on hover', async () => {
    render(<CitationMarker references={[mockRef]} />);

    // The component opens on mouseEnter
    fireEvent.mouseEnter(screen.getByRole('button'));

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('A Study on AI')).toBeInTheDocument();
    expect(screen.getByText('Smith, J., Doe, A.')).toBeInTheDocument();
    expect(screen.getByText('Paper')).toBeInTheDocument();
  });

  it('shows source link when URL is present', () => {
    render(<CitationMarker references={[mockRef]} />);

    fireEvent.mouseEnter(screen.getByRole('button'));

    const link = screen.getByText(/View source/);
    expect(link).toHaveAttribute('href', 'https://example.com/study');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not show link when URL is null', () => {
    render(<CitationMarker references={[mockRefNoUrl]} />);

    fireEvent.mouseEnter(screen.getByRole('button'));

    expect(screen.queryByText(/View source/)).not.toBeInTheDocument();
  });

  it('closes tooltip on Escape key', () => {
    render(<CitationMarker references={[mockRef]} />);

    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes tooltip on outside click', () => {
    render(
      <div>
        <span data-testid="outside">Outside</span>
        <CitationMarker references={[mockRef]} />
      </div>
    );

    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders multiple references in tooltip', () => {
    render(<CitationMarker references={[mockRef, mockRefNoUrl]} />);

    fireEvent.mouseEnter(screen.getByRole('button'));

    expect(screen.getByText('A Study on AI')).toBeInTheDocument();
    expect(screen.getByText('Book Title')).toBeInTheDocument();
  });
});
