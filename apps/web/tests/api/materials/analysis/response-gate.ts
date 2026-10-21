/** Holds only the synthetic HTTP response, allowing real dispatch and settlement races. */
export function createMaterialAnalysisResponseGate() {
  let current: {
    pageNumber: number | undefined;
    entered: () => void;
    released: Promise<void>;
  } | null = null;
  const releases = new Set<() => void>();
  return {
    hold(pageNumber?: number) {
      if (current) throw new Error('A synthetic provider response is already held.');
      const arrival = Promise.withResolvers<void>();
      const settlement = Promise.withResolvers<void>();
      const entered = arrival.resolve;
      const release = settlement.resolve;
      releases.add(release);
      current = { pageNumber, entered, released: settlement.promise };
      return {
        entered: arrival.promise,
        release: () => {
          release();
          releases.delete(release);
        },
      };
    },
    async wait(pageNumber: number) {
      const gate = current;
      if (!gate || (gate.pageNumber !== undefined && gate.pageNumber !== pageNumber)) return;
      current = null;
      gate.entered();
      await gate.released;
    },
    releaseAll() {
      for (const release of releases) release();
      releases.clear();
      current = null;
    },
  };
}
