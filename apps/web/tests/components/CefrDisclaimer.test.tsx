import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrDisclaimer } from '@/components/learn/CefrDisclaimer';

describe('CefrDisclaimer', () => {
  it('states the levels are not an official certificate and names where to certify', () => {
    render(<CefrDisclaimer />);
    expect(screen.getByText(/not an official\s+CEFR certificate/i)).toBeInTheDocument();
    expect(screen.getByText(/accredited institution/i)).toBeInTheDocument();
  });

  it('keeps the not-a-certificate message in the compact variant', () => {
    render(<CefrDisclaimer variant="compact" />);
    expect(screen.getByText(/not an official CEFR certificate/i)).toBeInTheDocument();
  });
});
