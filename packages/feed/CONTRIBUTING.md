# Contributing to @sottofm/feed

We welcome contributions! Whether you want to tune weights, add new signals, fix bugs, or improve documentation.

## Development Setup

```bash
git clone https://github.com/SottoFM/feed.git
cd feed
npm install
npm test
```

## How to Contribute

### Tuning Weights

Signal weights and archetype classifications are in `src/archetypes.ts` and `src/config.ts`. If you want to propose weight changes:

1. Explain the hypothesis (what behavior you expect to improve)
2. Provide evidence (listening data, A/B test results, or simulation)
3. Show before/after test cases

Weight changes without evidence will not be merged.

### Adding New Signals

1. Create `src/signals/your-signal.ts` with a pure function
2. Add the input type to `src/types.ts`
3. Export from `src/signals/index.ts` and `src/index.ts`
4. Add tests in `tests/signals.test.ts`
5. Update `computeAllSignals` if it should be included by default

### Bug Fixes

1. Write a failing test that demonstrates the bug
2. Fix the bug
3. Ensure all existing tests still pass

## Code Standards

- **Zero runtime dependencies** -- this package must stay pure
- **Every function must be deterministic** -- same input, same output, no side effects
- **Test behavior, not implementation** -- assert on outputs, not internals
- **TypeScript strict mode** -- no `any`, no implicit types

## Pull Request Process

1. Fork the repo and create a branch
2. Make your changes
3. Run `npm run typecheck && npm test && npm run build`
4. Open a PR with a clear description of what changed and why
5. Link any relevant issues

## Test Patterns

```typescript
// Good: test behavior
it('gives cold-start bonus to new content with few listeners', () => {
  const result = computeFreshness({ createdAt: now, totalUniqueListeners: 3, now });
  expect(result).toBeGreaterThan(computeFreshness({ createdAt: now, totalUniqueListeners: 100, now }));
});

// Bad: test implementation details
it('calls Math.min', () => { ... });
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
