import { describe, it, expect } from 'vitest';
import { scorePlacement, type PlacementQuestion } from '@/lib/placement-test';

function q(id: string, cefr: string, skill: string): PlacementQuestion {
  return {
    id,
    cefr: cefr as PlacementQuestion['cefr'],
    skill: skill as PlacementQuestion['skill'],
    prompt: id,
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: '',
  };
}

// Two questions per band A1..B2 (>=70% ⇒ both correct to pass a band).
const questions: PlacementQuestion[] = [
  q('a1-1', 'A1', 'grammar'),
  q('a1-2', 'A1', 'vocab'),
  q('a2-1', 'A2', 'grammar'),
  q('a2-2', 'A2', 'vocab'),
  q('b1-1', 'B1', 'grammar'),
  q('b1-2', 'B1', 'reading'),
  q('b2-1', 'B2', 'grammar'),
  q('b2-2', 'B2', 'reading'),
];
const allCorrect = questions.map((x) => ({ id: x.id, selectedIndex: 0 }));


describe('scorePlacement staircase', () => {
  it('assigns the highest fully-passed band', () => {
    expect(scorePlacement(questions, allCorrect).level).toBe('B2');
  });

  it('stops one band below the first failed band', () => {
    const answers = questions.map((x) => ({ id: x.id, selectedIndex: x.cefr === 'B1' ? 3 : 0 }));
    expect(scorePlacement(questions, answers).level).toBe('A2');
  });

  it('floors at A1 when A1 is failed', () => {
    const answers = questions.map((x) => ({ id: x.id, selectedIndex: x.cefr === 'A1' ? 3 : 0 }));
    expect(scorePlacement(questions, answers).level).toBe('A1');
  });

  it('reports per-skill scores and a response per question', () => {
    const out = scorePlacement(questions, allCorrect);
    expect(out.scoreBySkill.grammar).toBe(1);
    expect(out.responses).toHaveLength(questions.length);
    expect(out.responses.every((r) => r.correct)).toBe(true);
  });
});
