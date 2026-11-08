import { createContext, useContext } from 'react';
import type { ClassPreludeResponse } from '@sotto/shared';

export const ClassPreludeContext = createContext<ClassPreludeResponse | null>(null);

export function useClassPrelude() {
  return useContext(ClassPreludeContext);
}
