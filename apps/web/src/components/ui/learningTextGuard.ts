import type { ClipboardEvent, ClipboardEventHandler, HTMLAttributes } from 'react';

type LearningTextGuardProps<T extends HTMLElement> = HTMLAttributes<T> &
  Record<'data-learning-text-guard', 'true'>;

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
