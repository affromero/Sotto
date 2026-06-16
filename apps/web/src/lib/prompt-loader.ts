import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Runtime and CI run with cwd=apps/web, so prompts live at <cwd>/prompts. Some
// tooling (e.g. the pre-commit test runner) invokes from the monorepo root, so
// fall back to apps/web/prompts. Still cwd-based, no __dirname across packages.
function resolvePromptsDir(): string {
  const localPrompts = join(/* turbopackIgnore: true */ process.cwd(), 'prompts');
  if (existsSync(/* turbopackIgnore: true */ localPrompts)) return localPrompts;
  return join(/* turbopackIgnore: true */ process.cwd(), 'apps', 'web', 'prompts');
}

const PROMPTS_DIR = resolvePromptsDir();
const cache = new Map<string, string>();

/**
 * Load a prompt template from a .md file under apps/web/prompts/.
 * Results are cached after first read (server-side only, synchronous).
 */
export function loadPrompt(path: string): string {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  const content = readFileSync(
    /* turbopackIgnore: true */ join(/* turbopackIgnore: true */ PROMPTS_DIR, path),
    'utf-8',
  );
  cache.set(path, content);
  return content;
}

/**
 * Replace {{VAR}} placeholders in a template string.
 * Unrecognized placeholders collapse to empty string (by design, for optional sections).
 */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '');
}

/**
 * Load a prompt template and render it with the given variables.
 */
export function loadAndRender(path: string, vars: Record<string, string>): string {
  return render(loadPrompt(path), vars);
}
