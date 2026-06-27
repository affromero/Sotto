import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  CourseClassHistory,
  type CourseClassHistoryItem,
} from '@/components/learn/CourseClassHistory';

function makeClass(overrides: Partial<CourseClassHistoryItem>): CourseClassHistoryItem {
  return {
    id: 'class-1',
    order: 1,
    status: 'PASSED',
    attempt: 1,
    sourceTitle: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    submittedAt: '2026-01-01T13:00:00.000Z',
    passedAt: '2026-01-01T13:00:00.000Z',
    failedAt: null,
    lesson: { title: 'Ordering coffee', level: 'A1' },
    submission: {
      overallScore: 0.82,
      passed: true,
      submittedAt: '2026-01-01T13:00:00.000Z',
    },
    ...overrides,
  };
}

describe('CourseClassHistory', () => {
  it('lists saved classes with web and workbook entry actions', () => {
    render(
      <CourseClassHistory
        courseTitle="German for English speakers"
        classes={[
          makeClass({ id: 'class-active', status: 'IN_PROGRESS', passedAt: null }),
          makeClass({
            id: 'class-passed',
            order: 2,
            sourceTitle: 'Bundestag election explainer',
            lesson: { title: 'Politics in context', level: 'B1' },
          }),
        ]}
      />
    );

    expect(screen.getByRole('heading', { name: /class history/i })).toBeInTheDocument();
    expect(screen.getByText(/2 classes/i)).toBeInTheDocument();
    expect(screen.getByText('Ordering coffee')).toBeInTheDocument();
    expect(screen.getByText('Bundestag election explainer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Resume$/i })).toHaveAttribute(
      'href',
      '/learn/class/class-active'
    );
    expect(screen.getByRole('link', { name: /^Review$/i })).toHaveAttribute(
      'href',
      '/learn/class/class-passed'
    );
    expect(
      screen.getByRole('link', {
        name: /open Bundestag election explainer workbook for iPad or PDF annotation/i,
      })
    ).toHaveAttribute('href', '/classes/class-passed/worksheet');
  });

  it('labels the workbook for iPad-like browsers', async () => {
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });

    render(
      <CourseClassHistory
        courseTitle="German for English speakers"
        classes={[makeClass({ id: 'class-ipad' })]}
      />
    );

    expect(await screen.findByText('iPad workbook')).toBeInTheDocument();

    const event = new Event('pointerdown') as PointerEvent;
    Object.defineProperty(event, 'pointerType', { value: 'pen' });
    window.dispatchEvent(event);

    expect(await screen.findByText('Pencil ready')).toBeInTheDocument();
    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  it('shows an empty state before the learner starts a class', () => {
    render(<CourseClassHistory courseTitle="German for English speakers" classes={[]} />);

    expect(screen.getByText(/classes you start or complete will appear here/i)).toBeInTheDocument();
  });
});
