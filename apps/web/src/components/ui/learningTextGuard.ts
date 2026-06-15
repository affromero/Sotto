import type { ClipboardEvent, ClipboardEventHandler, HTMLAttributes } from 'react';

export const LEARNING_TEXT_GUARD_ATTR = 'data-learning-text-guard' as const;

type LearningTextGuardProps<T extends HTMLElement> = HTMLAttributes<T> &
  Record<typeof LEARNING_TEXT_GUARD_ATTR, 'true'>;

function preventLearningTextClipboard<T extends HTMLElement>(event: ClipboardEvent<T>) {
  event.preventDefault();
}

export function learningTextGuardProps<T extends HTMLElement>(): LearningTextGuardProps<T> {
  return {
    'data-learning-text-guard': 'true',
    onCopy: preventLearningTextClipboard as ClipboardEventHandler<T>,
    onCut: preventLearningTextClipboard as ClipboardEventHandler<T>,
  };
}
