import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('renders input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with label', () => {
    render(<Input label="Email Address" />);
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByText('Email Address')).toBeInTheDocument();
  });

  it('generates id from label when id is not provided', () => {
    render(<Input label="Email Address" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('id', 'email-address');
  });

  it('uses provided id instead of generating from label', () => {
    render(<Input label="Email Address" id="custom-id" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('id', 'custom-id');
  });

  it('shows error message when error prop is provided', () => {
    render(<Input label="Email" error="Invalid email address" />);
    expect(screen.getByText('Invalid email address')).toBeInTheDocument();
  });

  it('applies error class when error exists', () => {
    render(<Input error="Error message" />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('hasError');
  });

  it('shows helper text when provided', () => {
    render(<Input label="Password" helperText="Must be at least 8 characters" />);
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
  });

  it('does not show helper text when error is present', () => {
    render(
      <Input
        label="Password"
        helperText="Must be at least 8 characters"
        error="Password is too short"
      />
    );
    expect(screen.queryByText('Must be at least 8 characters')).not.toBeInTheDocument();
    expect(screen.getByText('Password is too short')).toBeInTheDocument();
  });

  it('forwards ref to input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('handles onChange events', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<Input onChange={handleChange} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'test');
    expect(handleChange).toHaveBeenCalled();
    expect(handleChange).toHaveBeenCalledTimes(4); // Once per character
  });

  it('updates value on user input', async () => {
    const user = userEvent.setup();
    render(<Input />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(input, 'Hello World');
    expect(input.value).toBe('Hello World');
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  it('has required attribute when required prop is true', () => {
    render(<Input required />);
    const input = screen.getByRole('textbox');
    expect(input).toBeRequired();
  });

  it('displays placeholder text', () => {
    render(<Input placeholder="Enter your email" />);
    expect(screen.getByPlaceholderText('Enter your email')).toBeInTheDocument();
  });

  it('applies custom className to wrapper', () => {
    const { container } = render(<Input className="custom-class" />);
    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('custom-class');
  });

  it('passes through additional HTML input attributes', () => {
    render(
      <Input
        type="email"
        name="user-email"
        autoComplete="email"
        maxLength={100}
        aria-describedby="email-hint"
      />
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('name', 'user-email');
    expect(input).toHaveAttribute('autoComplete', 'email');
    expect(input).toHaveAttribute('maxLength', '100');
    expect(input).toHaveAttribute('aria-describedby', 'email-hint');
  });

  it('works as controlled component', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    const { rerender } = render(<Input value="initial" onChange={handleChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');

    await user.type(input, 'x');
    rerender(<Input value="initial x" onChange={handleChange} />);
    expect(input.value).toBe('initial x');
  });

  it('renders without label', () => {
    render(<Input placeholder="No label" />);
    expect(screen.getByPlaceholderText('No label')).toBeInTheDocument();
    expect(screen.queryByRole('label')).not.toBeInTheDocument();
  });
});
