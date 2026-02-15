import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkPreview } from '@/components/discovery/LinkPreview';

describe('LinkPreview', () => {
  it('renders title and site name', () => {
    render(
      <LinkPreview
        url="https://example.com/article"
        title="Test Article"
        siteName="Example"
        wordCount={500}
        isLoading={false}
      />
    );

    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('Test Article')).toBeInTheDocument();
    expect(screen.getByText('500 words')).toBeInTheDocument();
  });

  it('shows loading state while isLoading', () => {
    render(
      <LinkPreview
        url="https://example.com"
        title={null}
        siteName={null}
        wordCount={null}
        isLoading={true}
      />
    );

    expect(screen.getByText('Extracting content...')).toBeInTheDocument();
  });

  it('shows hostname when siteName is null', () => {
    render(
      <LinkPreview
        url="https://www.example.com/article"
        title="Article"
        siteName={null}
        wordCount={null}
        isLoading={false}
      />
    );

    expect(screen.getByText('example.com')).toBeInTheDocument();
  });
});
