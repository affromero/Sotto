import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LearningObjectiveMemory, CefrLevel } from '@sotto/shared';
import { ObjectiveMemorySummary } from '@/components/memory/ObjectiveMemorySummary';
import { makeMap } from '../learn/learning-map/fixtures';

afterEach(cleanup);
function objectives(level: CefrLevel = 'A2'): LearningObjectiveMemory[] {
  const map = makeMap({ viewedLevel: level, confident: true });
  return map.nodes.flatMap(({ node, progress }) =>
    node.kind === 'OBJECTIVE' && progress
      ? [
          {
            objective: node,
            progress,
            requirementId: map.requirementId!,
            catalogVersion: map.catalogVersion,
            catalogHash: map.catalogHash,
          },
        ]
      : []
  );
}

describe('pinned objective memory', () => {
  it('keeps confident and review-due counts independent and links each exact band and criterion', () => {
    render(
      <ObjectiveMemorySummary
        courseId="course with spaces"
        objectives={[...objectives('A1'), ...objectives('A2')]}
      />
    );
    expect(screen.getByText('Confident').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Review due').parentElement).toHaveTextContent('4');
    expect(screen.getByText(/across your saved level requirements/)).toBeVisible();
    expect(
      screen.getByText(/Open the learning map for your current level requirements/)
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /Put the finite verb second/ })).toHaveAttribute(
      'href',
      '/learn/map?course=course+with+spaces&level=A1&objective=de.g.a1'
    );
    expect(screen.getByRole('link', { name: /Choose als or wenn/ })).toHaveAttribute(
      'href',
      '/learn/map?course=course+with+spaces&level=A2&objective=de.g.a2'
    );
    expect(screen.getByRole('link', { name: 'Open learning map' })).toHaveAttribute(
      'href',
      '/learn/map?course=course+with+spaces'
    );
  });
  it('does not infer unassessed requirements or a completion percentage from absent pinned coverage', () => {
    render(<ObjectiveMemorySummary courseId="course" objectives={[]} />);
    expect(
      screen.getByText('Open the learning map to inspect your level requirements.')
    ).toBeVisible();
    expect(screen.queryByText('Not assessed')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open learning map' })).toBeVisible();
  });
  it('bounds objective highlights while retaining full saved-band counts and a route to all requirements', () => {
    const entries = [...objectives('A1'), ...objectives('A2'), ...objectives('B1')];
    render(<ObjectiveMemorySummary courseId="course" objectives={entries} />);
    expect(
      within(screen.getByRole('list', { name: 'Objectives to inspect' })).getAllByRole('link')
    ).toHaveLength(5);
    expect(screen.getByText('Showing 5 of 6 saved objectives.')).toBeVisible();
    expect(screen.getByText('Confident').parentElement).toHaveTextContent('6');
    expect(entries.map((entry) => entry.objective.level)).toEqual([
      'A1',
      'A1',
      'A2',
      'A2',
      'B1',
      'B1',
    ]);
  });
});
