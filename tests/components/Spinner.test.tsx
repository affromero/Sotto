import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from '@/components/ui/Spinner';

describe('Spinner', () => {
  it('renders a span element', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.tagName).toBe('SPAN');
  });

  it('has role="status" for accessibility', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('[role="status"]');
    expect(spinner).toBeInTheDocument();
  });

  it('has aria-label="Loading" for accessibility', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('[aria-label="Loading"]');
    expect(spinner).toBeInTheDocument();
  });

  it('applies spinner base class', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('spinner');
  });

  it('applies medium size class by default', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('medium');
  });

  it('applies small size class', () => {
    const { container } = render(<Spinner size="small" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('small');
  });

  it('applies large size class', () => {
    const { container } = render(<Spinner size="large" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('large');
  });

  it('applies primary color class by default', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('primary');
  });

  it('applies accent color class', () => {
    const { container } = render(<Spinner color="accent" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('accent');
  });

  it('applies white color class', () => {
    const { container } = render(<Spinner color="white" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('white');
  });

  it('combines size and color classes', () => {
    const { container } = render(<Spinner size="large" color="accent" />);
    const spinner = container.firstChild as HTMLElement;
    expect(spinner.className).toContain('spinner');
    expect(spinner.className).toContain('large');
    expect(spinner.className).toContain('accent');
  });
});
