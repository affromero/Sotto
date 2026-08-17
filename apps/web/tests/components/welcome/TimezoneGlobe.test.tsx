/**
 * Behavior tests for the welcome-wizard globe timezone picker: selection via
 * the accessible select, dot rendering, and alias zones absent from zone.tab.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimezoneGlobe } from '@/app/welcome/timezone/TimezoneGlobe';

describe('TimezoneGlobe', () => {
  it('offers every zone in the select and reports a pick', () => {
    const onChange = vi.fn();
    render(<TimezoneGlobe value="America/Mexico_City" onChange={onChange} />);
    const select = screen.getByLabelText<HTMLSelectElement>(/your timezone/i);
    expect(select.value).toBe('America/Mexico_City');
    fireEvent.change(select, { target: { value: 'Europe/Berlin' } });
    expect(onChange).toHaveBeenCalledWith('Europe/Berlin');
  });

  it('keeps an alias zone not present in zone.tab as the shown value', () => {
    render(<TimezoneGlobe value="Some/Alias_Zone" onChange={() => {}} />);
    const select = screen.getByLabelText<HTMLSelectElement>(/your timezone/i);
    expect(select.value).toBe('');
    expect(screen.getByText('Some/Alias_Zone')).toBeTruthy();
  });

  it('renders the selected place as a highlighted, labelled dot', () => {
    const { container } = render(<TimezoneGlobe value="America/Bogota" onChange={() => {}} />);
    expect(screen.getAllByText('Bogota').length).toBeGreaterThan(0);
    // Front hemisphere shows a subset of the 400+ dots, selected one included.
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(50);
  });

  it('rotate buttons are present and clickable', () => {
    render(<TimezoneGlobe value="America/Bogota" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Rotate globe left'));
    fireEvent.click(screen.getByLabelText('Rotate globe right'));
  });
});
