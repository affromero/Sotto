import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CefrLevel } from '@sotto/shared';
import { makeMap, grammarExamples } from './fixtures';
import { LearningMap, type LearningMapProps } from '@/components/learn/learning-map/LearningMap';

afterEach(cleanup);

function props(map = makeMap()): LearningMapProps {
  return {
    map,
    onViewLevel: vi.fn(),
    onPractice: vi.fn(async () => {}),
    onAdvance: vi.fn(async () => {}),
    busy: false,
    error: null,
  };
}

async function openGrammar(level: CefrLevel) {
  fireEvent.click(screen.getByText('Connecting sentences'));
  fireEvent.click(screen.getByText(grammarExamples[level].title, { selector: 'summary > span' }));
  const checkbox = screen.getByRole('checkbox', {
    name: `Select ${grammarExamples[level].title} for practice`,
  });
  await waitFor(() => expect(checkbox).toBeVisible());
  return checkbox;
}

describe('LearningMap', () => {
  it('reveals a precise objective, its criterion, and its target-language example', async () => {
    render(<LearningMap {...props()} />);
    await openGrammar('A2');
    expect(screen.getByText(grammarExamples.A2.assessment)).toBeVisible();
    expect(screen.getByText(grammarExamples.A2.example)).toBeVisible();
    expect(screen.getByText(grammarExamples.A2.example)).toHaveAttribute('lang', 'de');
    expect(screen.getByText('Grammar', { selector: 'summary > span' })).toBeVisible();
    expect(screen.getByText('Situations', { selector: 'summary > span' })).toBeVisible();
  });

  it('generates lower-level grammar practice without advancing or requiring a situation', async () => {
    const callbacks = props();
    const { rerender } = render(<LearningMap {...callbacks} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Viewing level' }), {
      target: { value: 'A1' },
    });
    expect(callbacks.onViewLevel).toHaveBeenCalledWith('A1');
    rerender(<LearningMap {...callbacks} map={makeMap({ viewedLevel: 'A1' })} />);
    expect(screen.getByText('Reviewing A1. Your current level stays A2.')).toBeVisible();
    fireEvent.click(await openGrammar('A1'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Practice format' }), {
      target: { value: 'GRAMMAR' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate A1 practice' }));
    await waitFor(() =>
      expect(callbacks.onPractice).toHaveBeenCalledWith(
        { catalogVersion: 1, nodeIds: ['de.g.a1'], level: 'A1' },
        'GRAMMAR'
      )
    );
    expect(callbacks.onAdvance).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
  });

  it('starts situation-only practice and restricts formats to the selected skills', async () => {
    const callbacks = props();
    render(<LearningMap {...callbacks} />);
    fireEvent.click(screen.getByText('Arrange a meeting', { selector: 'summary > span' }));
    const select = screen.getByRole('checkbox', {
      name: 'Select Arrange a meeting for practice',
    });
    await waitFor(() => expect(select).toBeVisible());
    fireEvent.click(select);
    const formats = within(screen.getByRole('combobox', { name: 'Practice format' }));
    expect(formats.queryByRole('option', { name: 'Grammar' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Practice format' }), {
      target: { value: 'SPEAKING' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate A2 practice' }));
    await waitFor(() =>
      expect(callbacks.onPractice).toHaveBeenCalledWith(
        { catalogVersion: 1, nodeIds: ['de.s.a2'], level: 'A2' },
        'SPEAKING'
      )
    );
  });

  it('keeps higher levels available as previews without admitting practice', async () => {
    const callbacks = props(makeMap({ viewedLevel: 'B1' }));
    render(<LearningMap {...callbacks} />);
    expect(screen.getByText('Reach this level to practise its objectives.')).toBeVisible();
    const checkbox = await openGrammar('B1');
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    const generate = screen.getByRole('button', { name: 'Generate B1 practice' });
    expect(generate).toBeDisabled();
    fireEvent.click(generate);
    expect(callbacks.onPractice).not.toHaveBeenCalled();
  });

  it('excludes exempt oral formats while preserving full practice', async () => {
    const map = makeMap();
    map.readiness.exemptSkills = ['LISTENING', 'SPEAKING'];
    render(<LearningMap {...props(map)} />);
    fireEvent.click(screen.getByText('Arrange a meeting', { selector: 'summary > span' }));
    const checkbox = screen.getByRole('checkbox', {
      name: 'Select Arrange a meeting for practice',
    });
    await waitFor(() => expect(checkbox).toBeVisible());
    fireEvent.click(checkbox);
    const formats = within(screen.getByRole('combobox', { name: 'Practice format' }));
    expect(formats.queryByRole('option', { name: 'Listening' })).not.toBeInTheDocument();
    expect(formats.queryByRole('option', { name: 'Speaking' })).not.toBeInTheDocument();
    expect(formats.getByRole('option', { name: 'Full practice class' })).toBeInTheDocument();
    expect(formats.getByRole('option', { name: 'Writing' })).toBeInTheDocument();
  });

  it('shows confidence and review due together with the actual skill evidence', async () => {
    render(<LearningMap {...props(makeMap({ confident: true }))} />);
    const checkbox = await openGrammar('A2');
    const objective = checkbox.closest('details');
    expect(objective).not.toBeNull();
    const detail = within(objective!);
    expect(detail.getAllByText('Confident').length).toBeGreaterThan(0);
    expect(detail.getByText('Review due')).toBeVisible();
    expect(detail.getAllByText(/5 assessed tasks across 2 sessions/)[0]).toBeVisible();
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: 'Generate A2 practice' })).toBeEnabled();
  });

  it('announces pending requests and errors and prevents duplicate actions', async () => {
    const callbacks = props(makeMap({ confident: true }));
    const { rerender } = render(
      <LearningMap {...callbacks} busy error="Practice could not be prepared." />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saving your request. Please wait.');
    expect(screen.getByRole('alert')).toHaveTextContent('Practice could not be prepared.');
    expect(screen.getByRole('combobox', { name: 'Viewing level' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Advance to B1' })).toBeDisabled();
    rerender(<LearningMap {...callbacks} />);
    expect(screen.getByRole('button', { name: 'Advance to B1' })).toBeEnabled();
  });

  it('offers advancement only for the ready current band with no blockers', async () => {
    const callbacks = props(makeMap({ confident: true }));
    const { rerender } = render(<LearningMap {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Advance to B1' }));
    await waitFor(() => expect(callbacks.onAdvance).toHaveBeenCalled());
    rerender(
      <LearningMap
        {...callbacks}
        map={makeMap({
          confident: true,
          blockers: ['Finish the current course class before advancing.'],
        })}
      />
    );
    expect(screen.getByText('Finish the current course class before advancing.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
    rerender(<LearningMap {...callbacks} map={makeMap({ viewedLevel: 'A1', confident: true })} />);
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
    rerender(<LearningMap {...callbacks} map={makeMap({ viewedLevel: 'B1', confident: true })} />);
    expect(screen.getByText('Previewing B1. Your current level is A2.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
  });

  it('reports a rejected practice request and keeps the selected objective available', async () => {
    const callbacks = props();
    callbacks.onPractice = vi.fn(async () => {
      throw new Error('Practice generation is unavailable.');
    });
    render(<LearningMap {...callbacks} />);
    fireEvent.click(await openGrammar('A2'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate A2 practice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Practice generation is unavailable.'
    );
    expect(
      screen.getByRole('checkbox', {
        name: `Select ${grammarExamples.A2.title} for practice`,
      })
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Generate A2 practice' })).toBeEnabled();
  });

  it('lists the missing required objectives by title and shows catalog sources separately', () => {
    render(<LearningMap {...props()} />);
    fireEvent.click(screen.getByText('What remains for A2'));
    const remaining = screen.getByText('What remains for A2').closest('details');
    expect(within(remaining!).getByText(grammarExamples.A2.title)).toBeVisible();
    expect(within(remaining!).getByText('Arrange a meeting')).toBeVisible();
    fireEvent.click(screen.getByText('Sources and curriculum references'));
    expect(screen.getByRole('link', { name: /curriculum reference/i })).toHaveAttribute(
      'href',
      'https://www.coe.int/'
    );
  });

  it('keeps earned C2 completion in maintenance without offering another completion action', () => {
    render(
      <LearningMap
        {...props(
          makeMap({
            viewedLevel: 'C2',
            currentLevel: 'C2',
            confident: true,
            completed: true,
          })
        )}
      />
    );
    expect(screen.getByRole('heading', { name: 'C2 complete. Keep practising.' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Complete C2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
  });
});
