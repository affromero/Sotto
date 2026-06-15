import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlacementEntry } from '@/components/placement/PlacementEntry';

// Stub the heavy children so we test only the chooser's mode switching.
vi.mock('@/components/placement/PlacementTest', () => ({
  PlacementTest: ({ focusLevel }: { focusLevel?: string }) => (
    <div data-testid="placement-test">test {focusLevel ?? 'full'}</div>
  ),
}));
vi.mock('@/components/placement/NotesPlacement', () => ({
  NotesPlacement: ({ onVerify }: { onVerify: (l: string) => void }) => (
    <button type="button" onClick={() => onVerify('B1')}>
      stub-verify
    </button>
  ),
}));

describe('PlacementEntry', () => {
  it('offers both the test and the materials path', () => {
    render(<PlacementEntry native="en" target="es" />);
    expect(screen.getByText('Take the placement test')).toBeInTheDocument();
    expect(screen.getByText('I have materials from my level')).toBeInTheDocument();
  });

  it('opens the multiple-choice test when chosen', () => {
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('Take the placement test'));
    expect(screen.getByTestId('placement-test')).toHaveTextContent('full');
  });

  it('opens the materials path and can go back', () => {
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('I have materials from my level'));
    expect(screen.getByText('stub-verify')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Take the placement test')).toBeInTheDocument();
  });

  it('hands off to the test in verify mode at the deduced level', () => {
    render(<PlacementEntry native="en" target="es" />);
    fireEvent.click(screen.getByText('I have materials from my level'));
    fireEvent.click(screen.getByText('stub-verify'));
    // onVerify('B1') switches to the test focused on B1.
    expect(screen.getByTestId('placement-test')).toHaveTextContent('B1');
  });
});
