import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaces = [
  { directory: 'apps/web', name: '@sotto/web', typecheck: 'type-check' },
  { directory: 'packages/shared', name: '@sotto/shared' },
  { directory: 'packages/mcp', name: '@sotto/mcp', typecheck: 'type-check', tests: false },
  { directory: 'packages/groundcheck', name: 'groundcheck', typecheck: 'typecheck' },
  { directory: 'packages/learning-model', name: '@sotto/learning-model', typecheck: 'typecheck' },
];
const args = process.argv.slice(2);
const mode = args[0] || '--staged';
if (!['--staged', '--push', '--files'].includes(mode) || (mode !== '--files' && args.length > 1)) {
  console.error('Usage: node scripts/ci/check-affected.mjs [--staged | --push | --files PATH...]');
  process.exit(1);
}

function git(arguments_, optional = false) {
  const result = spawnSync('git', arguments_, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    if (optional) return undefined;
    console.error(result.error?.message || result.stderr);
    process.exit(result.status || 1);
  }
  return result.stdout;
}

function changedFiles() {
  if (mode === '--files') return args.slice(1);
  if (mode === '--staged') {
    return git(['diff', '--cached', '--name-only', '--no-renames', '-z'])
      .split('\0')
      .filter(Boolean);
  }
  const from = process.env.PRE_COMMIT_FROM_REF;
  const to = process.env.PRE_COMMIT_TO_REF;
  if (from && to) {
    return git(['diff', '--name-only', '--no-renames', '-z', from, to]).split('\0').filter(Boolean);
  }
  const base = git(['merge-base', 'origin/main', 'HEAD'], true)?.trim();
  if (base) {
    return git(['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'])
      .split('\0')
      .filter(Boolean);
  }
  // A first push without a known base must check the tracked tree.
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

const files = [
  ...new Set(
    changedFiles().map((file) => {
      const path = relative(root, resolve(root, file)).split('\\').join('/');
      if (!path || path.startsWith('../') || isAbsolute(path)) {
        console.error(`Affected check path is outside the repository: ${file}`);
        process.exit(1);
      }
      return path;
    })
  ),
];
const manifests = files.some((file) =>
  /^(?:package(?:-lock)?\.json|apps\/(?!desktop\/)[^/]+\/package(?:-lock)?\.json|(?:packages|services)\/[^/]+\/package(?:-lock)?\.json)$/.test(
    file
  )
);
const globalConfig = files.some((file) =>
  /^(?:vitest\.config\.[^/]+|tsconfig[^/]*\.json)$/.test(file)
);
const sharedContract = files.some((file) =>
  /^packages\/shared\/(?:openapi[^/]*\.json|scripts\/|src\/(?:contracts\/|types\/|index\.ts|validations\.ts|learning-evidence\.ts|learning-requirements\.ts|reading-vocabulary\.ts)|test\/openapi)/.test(
    file
  )
);
const rust = manifests || sharedContract || files.some((file) => file.startsWith('tui/'));
const openApiArtifact = files.some((file) =>
  /^(?:packages\/shared\/|tui\/)openapi[^/]*\.json$/.test(file)
);
const validationEnvironment = { ...process.env };
// Git hooks export repository-local variables. Validation may create its own
// repositories, so keep that context only for classifying the outer diff.
for (const name of git(['rev-parse', '--local-env-vars']).trim().split('\n')) {
  delete validationEnvironment[name];
}
delete validationEnvironment.PRE_COMMIT_FROM_REF;
delete validationEnvironment.PRE_COMMIT_TO_REF;

function run(command, arguments_, cwd = root) {
  console.log(`Affected checks: ${command} ${arguments_.join(' ')}`);
  const result = spawnSync(command, arguments_, {
    cwd,
    stdio: 'inherit',
    env: validationEnvironment,
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

if (mode === '--push') {
  if (rust) {
    run('cargo', ['build', '--locked'], resolve(root, 'tui'));
    run('cargo', ['test', '--locked'], resolve(root, 'tui'));
  } else {
    console.log(
      'Affected checks: no TUI or shared contract changes. Full source validation runs in CI.'
    );
  }
  process.exit(0);
}

const source = /\.(?:[cm]?[jt]sx?|css|jsonc?)$/;
const scripts = files.filter(
  (file) => /^(?:scripts\/|\.pre-commit-config\.yaml$)/.test(file) && !/\.md$/.test(file)
);
const scriptTests = new Set();
const knownScriptTests = new Map([
  ['scripts/ci/check-affected.mjs', 'scripts/tests/delivery/test_affected_checks.py'],
  ['.pre-commit-config.yaml', 'scripts/tests/delivery/test_affected_checks.py'],
  ['scripts/ci/native-scope.mjs', 'scripts/tests/delivery/test_native_scope.py'],
]);
let allScriptTests = false;
for (const file of scripts) {
  const test = knownScriptTests.get(file);
  if (test) scriptTests.add(test);
  else if (
    /^scripts\/tests\/(?:[^/]+\/)*test[^/]*\.py$/.test(file) &&
    existsSync(resolve(root, file))
  ) {
    scriptTests.add(file);
  } else allScriptTests = true;
}
if (allScriptTests) {
  run('python3', ['-m', 'unittest', 'discover', '-s', 'scripts/tests', '-p', 'test*.py']);
} else {
  for (const test of scriptTests) {
    run('python3', ['-m', 'unittest', 'discover', '-s', dirname(test), '-p', basename(test)]);
  }
}

for (const workspace of workspaces) {
  const isBrowserInput = (file) =>
    workspace.name === '@sotto/web' && file.startsWith('apps/web/e2e/');
  const browserInputs = files.filter(isBrowserInput);
  const own = files.filter(
    (file) =>
      file.startsWith(`${workspace.directory}/`) && source.test(file) && !isBrowserInput(file)
  );
  const dependencies =
    workspace.name === '@sotto/web'
      ? files.filter(
          (file) =>
            /^packages\/(?:shared|groundcheck|learning-model)\//.test(file) && source.test(file)
        )
      : [];
  const prisma =
    workspace.name === '@sotto/web' &&
    files.some((file) => /^(?:apps\/web\/prisma\/|prisma\.config\.)/.test(file));
  const sharedArtifact = workspace.name === '@sotto/shared' && openApiArtifact;
  const dynamicInputs = files.filter(
    (file) =>
      file.startsWith(`${workspace.directory}/`) &&
      !isBrowserInput(file) &&
      /\/(?:prompts|fixtures|test-fixtures|__fixtures__|models)\//.test(file)
  );
  if (
    !manifests &&
    !globalConfig &&
    !prisma &&
    !sharedArtifact &&
    !own.length &&
    !browserInputs.length &&
    !dependencies.length &&
    !dynamicInputs.length
  )
    continue;

  if (workspace.typecheck)
    run('npm', ['run', workspace.typecheck, `--workspace=${workspace.name}`]);
  if (workspace.tests === false) continue;
  const related = [...new Set([...own, ...dependencies, ...dynamicInputs])];
  const full =
    manifests ||
    globalConfig ||
    prisma ||
    sharedArtifact ||
    dynamicInputs.length > 0 ||
    related.some(
      (file) =>
        !existsSync(resolve(root, file)) ||
        /\/(?:tests?\/(?:setup|helpers)\/|[^/]*(?:config|schema)[^/]*\.[^/]+$)/.test(file)
    );
  if (full) {
    run('npm', [
      'run',
      'test',
      `--workspace=${workspace.name}`,
      '--',
      '--run',
      '--no-file-parallelism',
    ]);
    continue;
  }
  if (!related.length) {
    console.log(
      `Affected checks: browser inputs are type-checked; browser CI runs their journeys.`
    );
    continue;
  }
  const changedTest = related.some((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  if (!changedTest) {
    console.log(
      `Affected checks: ${workspace.name} may have no related tests; full CI remains required.`
    );
  }
  run('npm', [
    'exec',
    `--workspace=${workspace.name}`,
    '--',
    'vitest',
    'related',
    '--run',
    '--no-file-parallelism',
    ...(changedTest ? [] : ['--passWithNoTests']),
    ...related.map((file) => resolve(root, file)),
  ]);
}

if (rust) {
  run('cargo', ['fmt', '--check'], resolve(root, 'tui'));
  run(
    'cargo',
    ['clippy', '--all-targets', '--locked', '--', '-D', 'warnings'],
    resolve(root, 'tui')
  );
}
if (!files.length) console.log('Affected checks: no staged files.');
