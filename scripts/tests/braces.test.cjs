const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const braces = require('braces');

// Preserve public AST reference relationships in the upstream golden fixtures.
function graph(value, seen = new Map(), address = '$') {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return { $ref: seen.get(value) };
  seen.set(value, address);
  if (Array.isArray(value)) {
    return value.map((child, index) => graph(child, seen, `${address}.${index}`));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, graph(child, seen, `${address}.${key}`)])
  );
}

const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/braces-compatible.json')));
for (const fixture of fixtures.cases) {
  test(`preserves ${fixture.method} for ${JSON.stringify(fixture.input)} ${JSON.stringify(fixture.options)}`, () => {
    const result =
      fixture.method === 'main'
        ? braces(fixture.input, fixture.options)
        : braces[fixture.method](fixture.input, fixture.options);
    assert.deepEqual(graph(result), fixture.expected);
  });
}

function rejectsSafely(action) {
  assert.throws(
    action,
    (error) => error instanceof RangeError && /safety limit/.test(error.message)
  );
}

for (const [open, close] of [
  ['{', '}'],
  ['(', ')'],
]) {
  for (const method of ['main', 'create', 'parse', 'compile', 'expand', 'stringify']) {
    test(`${method} rejects deeply nested ${open}${close} before exhausting the stack`, () => {
      const pattern = open.repeat(4000) + 'a' + close.repeat(4000);
      rejectsSafely(() => (method === 'main' ? braces(pattern) : braces[method](pattern)));
    });
  }
}

for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method} rejects caller-supplied cyclic ASTs`, () => {
    const ast = { type: 'root', nodes: [] };
    ast.nodes.push(ast);
    rejectsSafely(() => braces[method](ast));
  });
}

test('expansion rejects a cyclic enclosing parent chain', () => {
  const parent = { type: 'paren', nodes: [] };
  parent.parent = parent;
  const child = { type: 'paren', nodes: [], parent };
  parent.nodes.push(child);
  rejectsSafely(() => braces.expand({ type: 'root', nodes: [parent] }));
});

test('expansion rejects cyclic nested arrays when flattening results', () => {
  const value = [];
  value.push(value);
  rejectsSafely(() => braces.expand({ type: 'root', nodes: [{ type: 'text', value }] }));
});

test('expansion rejects cyclic arrays when appending subsequent text', () => {
  const value = [];
  value.push(value);
  rejectsSafely(() =>
    braces.expand({
      type: 'root',
      nodes: [
        { type: 'text', value },
        { type: 'text', value: 'x' },
      ],
    })
  );
});

test('expansion rejects a cyclic parent supplied as the root node', () => {
  const ast = { type: 'paren', nodes: [] };
  ast.parent = ast;
  rejectsSafely(() => braces.expand(ast));
});
