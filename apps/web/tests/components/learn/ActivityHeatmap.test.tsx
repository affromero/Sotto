/**
 * Render tests for the learn-hub activity heatmap: streak text, per-day
 * tooltip breakdowns, and dominant-category cell coloring.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityHeatmap } from '@/components/learn/activity/ActivityHeatmap';
import type { ActivityData } from '@/lib/activity/heatmap';

function data(overrides: Partial<ActivityData> = {}): ActivityData {
  return {
    timeZone: 'UTC',
    todayIso: '2026-08-17',
    days: new Map([
      ['2026-08-16', { vocab: 2, class: 1 }],
      ['2026-08-17', { speaking: 1 }],
    ]),
    currentStreak: 2,
    longestStreak: 5,
    ...overrides,
  };
}

describe('ActivityHeatmap', () => {
  it('shows the current and longest streak', () => {
    render(<ActivityHeatmap data={data()} />);
    expect(screen.getByText(/day streak/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('describes an active day with its per-category breakdown in the tooltip', () => {
    const { container } = render(<ActivityHeatmap data={data()} />);
    const active = container.querySelector('[title="Sun Aug 16, 2026 — 2 vocabulary, 1 class"]');
    expect(active).toBeTruthy();
    expect(active?.getAttribute('data-cat')).toBe('vocab');
    expect(active?.getAttribute('data-tier')).toBe('2');
  });

  it('marks inactive days with tier 0 and no category', () => {
    const { container } = render(<ActivityHeatmap data={data()} />);
    const idle = container.querySelector('[title="Sat Aug 15, 2026 — no activity"]');
    expect(idle).toBeTruthy();
    expect(idle?.getAttribute('data-cat')).toBeNull();
    expect(idle?.getAttribute('data-tier')).toBe('0');
  });

  it('renders a full year of day cells ending today', () => {
    const { container } = render(<ActivityHeatmap data={data()} />);
    const cells = container.querySelectorAll('[title]');
    expect(cells.length).toBe(365);
    expect(
      container.querySelector('[title="Mon Aug 17, 2026 — 1 speaking"]')?.getAttribute('data-cat')
    ).toBe('speaking');
  });

  it('summarizes activity for screen readers including the timezone', () => {
    render(<ActivityHeatmap data={data({ timeZone: 'America/Mexico_City' })} />);
    expect(screen.getByText(/Active on 2 of the last 365 days/)).toBeTruthy();
    expect(screen.getByText(/America\/Mexico_City/)).toBeTruthy();
  });
});
