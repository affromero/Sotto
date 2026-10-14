import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  validatePencilImage,
  validatePencilProposal,
  type PencilTask,
} from '@/lib/learning/pencil/homework-vision';

const task: PencilTask = {
  kind: 'QUESTION',
  id: 'question',
  prompt: 'Choose the past tense.',
  options: ['visited', 'visits'],
  passage: 'Yesterday I visited Berlin.',
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2',
};
const choice = {
  selectedIndex: 0,
  text: null,
  observations: ['The first option is circled.'],
  uncertainties: [],
};

describe('Pencil homework interpretation', () => {
  it('preserves a visibly selected choice without assigning a grade', () => {
    expect(validatePencilProposal(task, choice)).toEqual(choice);
    expect(() => validatePencilProposal(task, { ...choice, overallScore: 1 })).toThrow();
  });
  it('requires unclear marks to remain explicit instead of inventing an answer', () => {
    expect(() => validatePencilProposal(task, { ...choice, selectedIndex: null })).toThrow();
    const unclear = { ...choice, selectedIndex: null, uncertainties: ['Two options are marked.'] };
    expect(validatePencilProposal(task, unclear).selectedIndex).toBeNull();
  });
  it('refuses selections outside the exercise and writing text on a choice task', () => {
    expect(() => validatePencilProposal(task, { ...choice, selectedIndex: 2 })).toThrow();
    expect(() => validatePencilProposal(task, { ...choice, text: 'Correct answer' })).toThrow();
  });
  it('keeps writing errors and visual edits available for learner review', () => {
    const answer = {
      selectedIndex: null,
      text: 'Ich habe ein Picknick machen.',
      observations: ['An arrow moves habe after Ich.'],
      uncertainties: ['The noun is difficult to read.'],
    };
    expect(validatePencilProposal({ ...task, kind: 'WRITING', options: [] }, answer)).toEqual(
      answer
    );
    expect(() => validatePencilProposal({ ...task, kind: 'WRITING' }, choice)).toThrow();
  });
  it('accepts a real single-page PNG and refuses remote or falsely labelled images', async () => {
    const png = await sharp({
      create: { width: 800, height: 900, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      validatePencilImage('data:image/png;base64,' + png.toString('base64'))
    ).resolves.toBeUndefined();
    await expect(validatePencilImage('https://example.com/homework.png')).rejects.toThrow();
    await expect(
      validatePencilImage('data:image/jpeg;base64,' + png.toString('base64'))
    ).rejects.toThrow();
    await expect(validatePencilImage('data:image/png;base64,aW5r')).rejects.toThrow();
  });
});
