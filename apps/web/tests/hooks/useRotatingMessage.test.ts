import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { STAGE_MESSAGES, resolveMessage } from '@sotto/shared';
import { useRotatingMessage } from '@/lib/hooks/useRotatingMessage';

afterEach(() => vi.useRealTimers());

it('starts the late message pool on the thirteenth active tick and resets every stage visit', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ status }) => useRotatingMessage({ status, topic: 'travel', isActive: true }),
    { initialProps: { status: 'SCRIPTING' } }
  );
  act(() => vi.advanceTimersByTime(12 * 9000));
  expect(result.current.message).toBe(resolveMessage(STAGE_MESSAGES.SCRIPTING!.early[0], 'travel'));
  act(() => vi.advanceTimersByTime(9000));
  expect(result.current.message).toBe(resolveMessage(STAGE_MESSAGES.SCRIPTING!.late[1], 'travel'));
  const key = result.current.transitionKey;
  rerender({ status: 'EXTRACTING' });
  expect(result.current.message).toBe(
    resolveMessage(STAGE_MESSAGES.EXTRACTING!.early[0], 'travel')
  );
  rerender({ status: 'SCRIPTING' });
  expect(result.current.message).toBe(resolveMessage(STAGE_MESSAGES.SCRIPTING!.early[0], 'travel'));
  expect(result.current.transitionKey).toBe(key);
  act(() => vi.advanceTimersByTime(9000));
  expect(result.current.transitionKey).toBe(key + 1);
  expect(result.current.message).toBe(resolveMessage(STAGE_MESSAGES.SCRIPTING!.early[1], 'travel'));
});

it('pauses rotation when inactive and updates topic without restarting the stage', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ isActive, topic }) => useRotatingMessage({ status: 'SCRIPTING', isActive, topic }),
    { initialProps: { isActive: true, topic: 'travel' } }
  );
  act(() => vi.advanceTimersByTime(9000));
  rerender({ isActive: false, topic: 'food' });
  expect(result.current.message).toBeNull();
  act(() => vi.advanceTimersByTime(30_000));
  expect(result.current.transitionKey).toBe(1);
  rerender({ isActive: true, topic: 'food' });
  expect(result.current.message).toBe(resolveMessage(STAGE_MESSAGES.SCRIPTING!.early[1], 'food'));
});
