import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AutoModelConfigData } from '../auto-model-config';
import {
  AGENT_EFFORT_LEVELS,
  CLAUDE_EFFORT_LEVELS,
  formatAgentModelId,
  isAgentEffort,
  parseAgentModelId,
  titleAgentModel,
  type AgentEffortLevel,
  type AgentModelSelection,
  type AgentProviderId,
} from './id';
import { getAiProviderMeta, type AiModelOption } from '../providers/ai-registry';
import { discoverCodexModels, type CodexModelOffering } from './codex-app-server';

type AgentModelEnv = Record<string, string | undefined>;

export {
  AGENT_EFFORT_LEVELS,
  CLAUDE_EFFORT_LEVELS,
  formatAgentModelId,
  normalizeAgentModelId,
  parseAgentModelId,
  type AgentEffortLevel,
  type AgentModelSelection,
  type AgentProviderId,
} from './id';

interface AgentModelOptionInput {
  provider: AgentProviderId;
  model: string | null;
  displayName: string;
  shortDisplayName: string;
  tier?: AiModelOption['tier'];
  effort?: AgentEffortLevel | null;
}

interface AgentModelDiscoveryOptions {
  env?: AgentModelEnv;
  autoConfig?: AutoModelConfigData;
}

// Used only when live App Server discovery fails. Exact current offerings come
// from `model/list`; keeping this list deliberately small limits stale data.
const CODEX_DEFAULT_MODELS: AgentModelOptionInput[] = [
  ['gpt-5.6-sol', 'GPT-5.6 Sol', 'best'],
  ['gpt-5.6-terra', 'GPT-5.6 Terra', 'balanced'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', 'fast'],
].map(([model, displayName, tier]) => ({
  provider: 'codex',
  model,
  displayName,
  shortDisplayName: displayName,
  tier: tier as AiModelOption['tier'],
}));

export interface AgentModelOffering {
  models: AiModelOption[];
  source: 'live' | 'configured' | 'curated';
  error: string | null;
  defaultModel: string | null;
  defaultEffort: AgentEffortLevel | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function splitConfiguredList(value: string | null | undefined): string[] {
  return clean(value)
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = clean(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function codexHome(env: AgentModelEnv): string {
  return clean(env.CODEX_HOME) || join(homedir(), '.codex');
}

function collectCodexConfigModels(env: AgentModelEnv): string[] {
  const config = readIfExists(join(codexHome(env), 'config.toml'));
  if (!config) return [];

  const values: string[] = [];
  for (const line of config.split('\n')) {
    const modelMatch = line.match(/^\s*model\s*=\s*"([^"]+)"/);
    if (modelMatch) values.push(modelMatch[1]);

    const quotedKeyMatch = line.match(/^\s*"([^"]+)"\s*=/);
    if (quotedKeyMatch && /^(gpt|o\d|codex|chatgpt|openai)[\w./-]*/i.test(quotedKeyMatch[1])) {
      values.push(quotedKeyMatch[1]);
    }
  }
  return values;
}

function collectCodexConfigEfforts(env: AgentModelEnv): AgentEffortLevel[] {
  const config = readIfExists(join(codexHome(env), 'config.toml'));
  if (!config) return [];
  return config
    .split('\n')
    .map((line) => line.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/)?.[1])
    .filter(isAgentEffort);
}

function collectClaudeSettings(env: AgentModelEnv): {
  models: string[];
  efforts: AgentEffortLevel[];
} {
  const explicitHome = clean(env.CLAUDE_HOME);
  const settingsPath = join(explicitHome || join(homedir(), '.claude'), 'settings.json');
  const settings = readIfExists(settingsPath);
  if (!settings) return { models: [], efforts: [] };

  try {
    const parsed = JSON.parse(settings) as Record<string, unknown>;
    const models = [parsed.model, parsed.defaultModel, parsed.modelName].filter(
      (value): value is string => typeof value === 'string'
    );
    const efforts = [parsed.effortLevel, parsed.effort].filter(
      (value): value is AgentEffortLevel => typeof value === 'string' && isAgentEffort(value)
    );
    return { models, efforts };
  } catch {
    return { models: [], efforts: [] };
  }
}

function configuredAgentModels(
  provider: AgentProviderId,
  autoConfig?: AutoModelConfigData
): string[] {
  if (!autoConfig) return [];
  const directValues = [
    autoConfig.model.aiProvider === provider ? autoConfig.model.aiModel : null,
    autoConfig.platform.aiProvider === provider ? autoConfig.platform.aiModel : null,
  ];
  const legacyClaudeModels = new Set(
    getAiProviderMeta('claude-code').models.map((model) => model.id)
  );
  const includedValues = (autoConfig.includedModels ?? [])
    .map((value) => {
      const parsed = parseAgentModelId(value);
      if (parsed?.provider === provider) return parsed;
      if (provider === 'claude-code' && legacyClaudeModels.has(value)) {
        return parseAgentModelId(value, provider);
      }
      return null;
    })
    .filter((selection): selection is AgentModelSelection => !!selection);

  return [...directValues.map((value) => parseAgentModelId(value, provider)), ...includedValues]
    .filter(
      (selection): selection is AgentModelSelection =>
        !!selection && selection.provider === provider
    )
    .map((selection) => selection.model)
    .filter((model): model is string => !!model);
}

function configuredAgentEfforts(
  provider: AgentProviderId,
  autoConfig?: AutoModelConfigData
): AgentEffortLevel[] {
  if (!autoConfig) return [];
  const directValues = [
    autoConfig.model.aiProvider === provider ? autoConfig.model.aiModel : null,
    autoConfig.platform.aiProvider === provider ? autoConfig.platform.aiModel : null,
  ];
  const includedValues = (autoConfig.includedModels ?? [])
    .map((value) => parseAgentModelId(value))
    .filter(
      (selection): selection is AgentModelSelection =>
        !!selection && selection.provider === provider
    )
    .map((selection) => formatAgentModelId(selection.provider, selection.model, selection.effort));
  return [...directValues, ...includedValues]
    .map((value) => parseAgentModelId(value, provider)?.effort ?? null)
    .filter(isAgentEffort);
}

function effortOptions(
  provider: AgentProviderId,
  opts: AgentModelDiscoveryOptions
): AgentEffortLevel[] {
  const env = opts.env ?? process.env;
  const fromEnv =
    provider === 'claude-code'
      ? splitConfiguredList(env.CLAUDE_CODE_EFFORTS)
      : splitConfiguredList(env.CODEX_MODEL_REASONING_EFFORTS ?? env.CODEX_EFFORTS);
  const fromConfig =
    provider === 'claude-code'
      ? collectClaudeSettings(env).efforts
      : collectCodexConfigEfforts(env);
  return unique([
    ...fromEnv.filter(isAgentEffort),
    ...fromConfig,
    ...configuredAgentEfforts(provider, opts.autoConfig),
    ...(provider === 'claude-code' ? CLAUDE_EFFORT_LEVELS : AGENT_EFFORT_LEVELS),
  ]).filter(isAgentEffort);
}

function baseModelOptions(
  provider: AgentProviderId,
  opts: AgentModelDiscoveryOptions
): AgentModelOptionInput[] {
  const env = opts.env ?? process.env;
  if (provider === 'claude-code') {
    const registryModels = getAiProviderMeta('claude-code').models.map((model) => model.id);
    const settings = collectClaudeSettings(env);
    const models = unique([
      ...splitConfiguredList(env.CLAUDE_CODE_MODELS),
      env.CLAUDE_CODE_MODEL,
      ...settings.models,
      ...configuredAgentModels(provider, opts.autoConfig),
      ...registryModels,
    ]);
    return models.map((model) => {
      const registry = getAiProviderMeta('claude-code').models.find((entry) => entry.id === model);
      return {
        provider,
        model,
        displayName: registry?.displayName ?? titleAgentModel(model),
        shortDisplayName: registry?.shortDisplayName ?? titleAgentModel(model),
        tier: registry?.tier ?? 'balanced',
      };
    });
  }

  const codexModels = unique([
    ...splitConfiguredList(env.CODEX_MODELS),
    env.CODEX_MODEL,
    ...collectCodexConfigModels(env),
    ...configuredAgentModels(provider, opts.autoConfig),
  ]);
  const defaultsById = new Map(CODEX_DEFAULT_MODELS.map((model) => [model.model, model] as const));
  const modelOptions = unique([
    ...codexModels,
    ...CODEX_DEFAULT_MODELS.map((model) => model.model),
  ]).map((model) => {
    const defaultOption = defaultsById.get(model);
    if (defaultOption) return defaultOption;
    return {
      provider,
      model,
      displayName: titleAgentModel(model),
      shortDisplayName: titleAgentModel(model),
      tier: 'balanced' as const,
    };
  });
  return [
    {
      provider,
      model: null,
      displayName: 'Configured Codex default',
      shortDisplayName: 'Configured default',
      tier: 'balanced',
    },
    ...modelOptions,
  ];
}

function toAiModelOption(input: AgentModelOptionInput): AiModelOption {
  const id = formatAgentModelId(input.provider, input.model, input.effort);
  const effortSuffix = input.effort ? ` (${input.effort} effort)` : '';
  return {
    id,
    displayName: `${input.displayName}${effortSuffix}`,
    shortDisplayName: `${input.shortDisplayName}${effortSuffix}`,
    tier: input.tier ?? 'balanced',
    contextWindow: 0,
    maxOutputTokens: 0,
  };
}

export function getAgentModelOptions(
  provider: AgentProviderId,
  opts: AgentModelDiscoveryOptions = {}
): AiModelOption[] {
  const bases = baseModelOptions(provider, opts);
  const efforts = effortOptions(provider, opts);
  const options: AiModelOption[] = [];

  for (const base of bases) {
    options.push(toAiModelOption(base));
    for (const effort of efforts) {
      options.push(toAiModelOption({ ...base, effort }));
    }
  }

  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function liveCodexOptions(
  offerings: CodexModelOffering[],
  opts: AgentModelDiscoveryOptions
): AiModelOption[] {
  const options: AiModelOption[] = [
    toAiModelOption({
      provider: 'codex',
      model: null,
      displayName: 'Configured Codex default',
      shortDisplayName: 'Configured default',
      tier: 'balanced',
    }),
  ];
  const liveModels = new Set(offerings.map((offering) => offering.model));
  for (const offering of offerings) {
    const base: AgentModelOptionInput = {
      provider: 'codex',
      model: offering.model,
      displayName: titleAgentModel(offering.model),
      shortDisplayName: titleAgentModel(offering.model),
      tier: offering.isDefault ? 'best' : 'balanced',
    };
    options.push(toAiModelOption(base));
    for (const effort of offering.effortOptions) {
      options.push(toAiModelOption({ ...base, effort }));
    }
  }

  // Keep explicitly configured selections visible even if the current CLI no
  // longer advertises them, so an admin can inspect and replace stale state.
  for (const option of getAgentModelOptions('codex', opts)) {
    const parsed = parseAgentModelId(option.id, 'codex');
    if (parsed?.model && !liveModels.has(parsed.model)) options.push(option);
  }
  const seen = new Set<string>();
  return options.filter((option) => !seen.has(option.id) && Boolean(seen.add(option.id)));
}

export async function getAgentModelOffering(
  provider: AgentProviderId,
  opts: AgentModelDiscoveryOptions = {}
): Promise<AgentModelOffering> {
  if (provider === 'claude-code') {
    return {
      models: getAgentModelOptions(provider, opts),
      source: 'configured',
      error: null,
      defaultModel: getAiProviderMeta('claude-code').defaultModel,
      defaultEffort: null,
    };
  }
  try {
    const offerings = await discoverCodexModels();
    const selected = offerings.find((offering) => offering.isDefault) ?? offerings[0];
    return {
      models: liveCodexOptions(offerings, opts),
      source: 'live',
      error: null,
      defaultModel: selected?.model ?? null,
      defaultEffort: selected?.defaultEffort ?? null,
    };
  } catch (error) {
    return {
      models: getAgentModelOptions(provider, opts),
      source: 'curated',
      error: error instanceof Error ? error.message : 'Codex model discovery failed.',
      defaultModel: null,
      defaultEffort: null,
    };
  }
}
