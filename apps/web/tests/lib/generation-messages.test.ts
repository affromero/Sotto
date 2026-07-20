import { describe, it, expect } from 'vitest';
import { STAGE_MESSAGES, resolveMessage } from '@sotto/shared';
import type { StageMessage } from '@sotto/shared';

const ACTIVE_STAGES = [
  'EXTRACTING',
  'SCRIPTING',
  'RESEARCHING',
  'PLANNING',
  'COMPILING',
  'GENERATING_AUDIO',
  'STITCHING',
];

describe('STAGE_MESSAGES', () => {
  it('has pools for all active pipeline stages', () => {
    for (const stage of ACTIVE_STAGES) {
      const pool = STAGE_MESSAGES[stage];
      expect(pool).toBeDefined();
      expect(pool!.early.length).toBeGreaterThan(0);
      expect(pool!.late.length).toBeGreaterThan(0);
    }
  });

  it('SCRIPTING has the most messages (6 early + 3 late)', () => {
    const pool = STAGE_MESSAGES['SCRIPTING']!;
    expect(pool.early.length).toBe(6);
    expect(pool.late.length).toBe(3);
  });

  it('every message has non-empty text', () => {
    for (const stage of ACTIVE_STAGES) {
      const pool = STAGE_MESSAGES[stage]!;
      for (const msg of [...pool.early, ...pool.late]) {
        expect(msg.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('topic-aware messages contain the {topic} placeholder', () => {
    for (const stage of ACTIVE_STAGES) {
      const pool = STAGE_MESSAGES[stage]!;
      for (const msg of [...pool.early, ...pool.late]) {
        if (msg.topicAware) {
          expect(msg.text).toContain('{topic}');
        }
      }
    }
  });
});

describe('resolveMessage', () => {
  it('replaces {topic} with the provided topic', () => {
    const msg: StageMessage = { text: 'Researching {topic}', topicAware: true };
    expect(resolveMessage(msg, 'quantum computing')).toBe('Researching quantum computing');
  });

  it('strips {topic} placeholder when no topic is provided', () => {
    const msg: StageMessage = {
      text: 'Researching the latest findings on {topic}',
      topicAware: true,
    };
    const result = resolveMessage(msg);
    expect(result).not.toContain('{topic}');
    expect(result).toBe('Researching the latest findings on');
  });

  it('truncates topics longer than 60 characters', () => {
    const longTopic = 'A'.repeat(80);
    const msg: StageMessage = { text: 'Learning about {topic}', topicAware: true };
    const result = resolveMessage(msg, longTopic);
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(msg.text.length + 61);
  });

  it('does not truncate topics at exactly 60 characters', () => {
    const exactTopic = 'B'.repeat(60);
    const msg: StageMessage = { text: 'On {topic}', topicAware: true };
    const result = resolveMessage(msg, exactTopic);
    expect(result).not.toContain('...');
    expect(result).toBe(`On ${exactTopic}`);
  });

  it('passes non-topic-aware messages through unchanged', () => {
    const msg: StageMessage = { text: 'Almost there — good things take time', topicAware: false };
    expect(resolveMessage(msg, 'some topic')).toBe(msg.text);
    expect(resolveMessage(msg)).toBe(msg.text);
  });
});
