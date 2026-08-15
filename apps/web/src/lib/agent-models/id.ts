export const AGENT_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffortLevel = (typeof AGENT_EFFORT_LEVELS)[number];
export type AgentProviderId = 'claude-code' | 'codex';

export interface AgentModelSelection {
  provider: AgentProviderId;
  /** Null means "use the CLI's configured default model". */
  model: string | null;
  effort: AgentEffortLevel | null;
}

const TITLE_WORD_RE = /(^|[-_/\s])([a-z0-9])/g;

export function titleAgentModel(raw: string): string {
  return raw
    .replace(
      TITLE_WORD_RE,
      (_match: string, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
    )
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bAi\b/g, 'AI')
    .trim();
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function isAgentEffort(value: string | null | undefined): value is AgentEffortLevel {
  return AGENT_EFFORT_LEVELS.includes(value as AgentEffortLevel);
}

function stripEffortSuffix(raw: string): {
  base: string;
  effort: AgentEffortLevel | null;
  invalidEffort: boolean;
} {
  const [base, fragment] = raw.split('#', 2);
  if (!fragment) return { base, effort: null, invalidEffort: false };
  const params = new URLSearchParams(fragment);
  const effort = params.get('effort');
  if (!effort) return { base, effort: null, invalidEffort: false };
  return {
    base,
    effort: isAgentEffort(effort) ? effort : null,
    invalidEffort: !isAgentEffort(effort),
  };
}

export function parseAgentModelId(
  value: string | null | undefined,
  providerHint?: AgentProviderId
): AgentModelSelection | null {
  const raw = clean(value);
  if (!raw && !providerHint) return null;

  const { base, effort, invalidEffort } = stripEffortSuffix(raw);
  if (invalidEffort) return null;
  if (base === 'claude-code') return { provider: 'claude-code', model: null, effort };
  if (base.startsWith('claude-code:')) {
    const model = clean(base.slice('claude-code:'.length));
    return { provider: 'claude-code', model: model || null, effort };
  }
  if (base === 'codex') return { provider: 'codex', model: null, effort };
  if (base.startsWith('codex:')) {
    const model = clean(base.slice('codex:'.length));
    return { provider: 'codex', model: model || null, effort };
  }
  if (providerHint) {
    return { provider: providerHint, model: clean(base) || null, effort };
  }
  return null;
}

export function formatAgentModelId(
  provider: AgentProviderId,
  model: string | null | undefined,
  effort?: AgentEffortLevel | null
): string {
  const baseModel = clean(model);
  const base = baseModel ? `${provider}:${baseModel}` : provider;
  return effort ? `${base}#effort=${effort}` : base;
}

export function normalizeAgentModelId(
  provider: AgentProviderId,
  value: string | null | undefined
): string | null {
  const parsed = parseAgentModelId(value, provider);
  if (!parsed) return null;
  if (provider === 'claude-code' && !parsed.model) return null;
  return formatAgentModelId(parsed.provider, parsed.model, parsed.effort);
}

export function getAgentProviderForModelId(modelId: string): AgentProviderId | null {
  const parsed = parseAgentModelId(modelId);
  if (!parsed) return null;
  if (parsed.provider === 'claude-code' && !parsed.model) return null;
  return parsed.provider;
}

export function getAgentModelDisplayName(modelId: string, short = false): string | null {
  const parsed = parseAgentModelId(modelId);
  if (!parsed) return null;
  const providerLabel = parsed.provider === 'claude-code' ? 'Claude Code' : 'Codex';
  const modelLabel = parsed.model ? titleAgentModel(parsed.model) : 'Configured default';
  const base = short ? modelLabel : `${providerLabel} ${modelLabel}`;
  return parsed.effort ? `${base} (${parsed.effort} effort)` : base;
}
