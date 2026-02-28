'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

export function useHasMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
