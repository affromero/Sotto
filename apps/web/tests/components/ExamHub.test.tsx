/**
 * ExamHub shows the flagship exam available for a course, the unaffiliated-practice
 * disclaimer, and a start control. Past attempts surface their mock band.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ExamHub } from '@/components/learn/ExamHub';

const AVAILABLE = {
  institution: 'GOETHE',
  institutionLabel: 'Goethe-Institut',
  examName: 'Goethe-Zertifikat B1',
  level: 'B1',
  sectionCount: 4,
};

describe('ExamHub', () => {
  it('shows the flagship exam, the not-affiliated disclaimer, and a start button', () => {
    render(<ExamHub courseId="c1" available={AVAILABLE} history={[]} />);
    expect(screen.getAllByText(/Goethe-Zertifikat B1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/not affiliated with or endorsed by Goethe-Institut/i)).toBeInTheDocument();
    expect(screen.getByText(/not an official CEFR certificate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start the exam/i })).toBeInTheDocument();
  });

  it('renders past attempts with their mock band', () => {
    render(
      <ExamHub
        courseId="c1"
        available={AVAILABLE}
        history={[
          { id: 'e1', examName: 'Goethe-Zertifikat B1', level: 'B1', status: 'SCORED', band: 'B1 pass (mock)', overallScore: 0.72, createdAt: '2026-06-09T00:00:00.000Z' },
        ]}
      />,
    );
    expect(screen.getByText(/B1 pass \(mock\)/)).toBeInTheDocument();
    expect(screen.getByText(/72%/)).toBeInTheDocument();
  });
});
