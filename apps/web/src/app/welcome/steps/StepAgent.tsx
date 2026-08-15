'use client';

import { useEffect, useMemo } from 'react';
import { PROVIDERS } from '../data';
import type { AgentState, ModelOption } from '../WelcomeFlow';
import { aiModelProviderId } from '../providerMap';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.styles';
import {
  formatAgentModelId,
  parseAgentModelId,
  type AgentEffortLevel,
  type AgentProviderId,
} from '@/lib/agent-models/id';
import type { AgentStatus } from '@/lib/agent-availability';

interface Props {
  agent: AgentState;
  demoMode: boolean;
  /** Wizard provider ids whose platform key already exists in the server env (owner only). */
  envDetected?: string[];
  /** Registry AI models keyed by backend provider id (anthropic, openai). */
  aiModels?: Record<string, ModelOption[]>;
  agentStatuses?: Partial<Record<'claude-code' | 'codex', AgentStatus>>;
  setAgent: (updater: (prev: AgentState) => AgentState) => void;
  onNext: () => void;
  onBack: () => void;
}

const EMPTY_AI_MODELS: Record<string, ModelOption[]> = {};

export function StepAgent({
  agent,
  demoMode,
  envDetected = [],
  aiModels = EMPTY_AI_MODELS,
  agentStatuses,
  setAgent,
  onNext,
  onBack,
}: Props) {
  const prov = PROVIDERS.find((p) => p.id === agent.provider);
  const liveTranslationKey = agent.liveTranslationKey ?? '';

  // A key-method provider whose platform key already lives in the server env
  // needs nothing typed: treat it as connected so the owner can continue, and
  // any pasted key simply overrides the server one.
  const envReady =
    !demoMode && agent.method === 'key' && !agent.value && envDetected.includes(agent.provider);
  useEffect(() => {
    if (envReady && agent.status === 'idle') {
      setAgent((a) => ({ ...a, status: 'connected' }));
    }
  }, [envReady, agent.status, setAgent]);

  // Model options for the current method. key: claude → anthropic, codex → openai.
  // cli: the matching keyless local agent backend (claude-code or codex).
  const aiRegistryId =
    agent.method === 'cli'
      ? agent.provider === 'codex'
        ? 'codex'
        : 'claude-code'
      : agent.method === 'key'
        ? aiModelProviderId(agent.provider)
        : null;
  const pickerModels = useMemo(
    () => (aiRegistryId ? (aiModels[aiRegistryId] ?? []) : []),
    [aiModels, aiRegistryId]
  );
  const agentProvider: AgentProviderId | null =
    agent.method === 'cli' ? (agent.provider === 'codex' ? 'codex' : 'claude-code') : null;
  const agentSelection = agentProvider ? parseAgentModelId(agent.model, agentProvider) : null;
  const cliStatus = agentProvider ? agentStatuses?.[agentProvider] : undefined;
  const pickerBaseModels = useMemo(
    () =>
      agentProvider
        ? pickerModels.filter((model) => !parseAgentModelId(model.id, agentProvider)?.effort)
        : pickerModels,
    [agentProvider, pickerModels]
  );
  const pickerEfforts = useMemo(() => {
    if (!agentProvider || !agentSelection) return [];
    return [
      ...new Set(
        pickerModels.flatMap((model) => {
          const parsed = parseAgentModelId(model.id, agentProvider);
          return parsed?.model === agentSelection.model && parsed.effort ? [parsed.effort] : [];
        })
      ),
    ];
  }, [agentProvider, agentSelection, pickerModels]);

  function setAgentBaseModel(modelId: string) {
    if (!agentProvider) {
      setAgent((current) => ({ ...current, model: modelId }));
      return;
    }
    const base = parseAgentModelId(modelId, agentProvider);
    if (!base) return;
    const preferred = formatAgentModelId(agentProvider, base.model, agentSelection?.effort);
    setAgent((current) => ({
      ...current,
      model: pickerModels.some((model) => model.id === preferred)
        ? preferred
        : formatAgentModelId(agentProvider, base.model),
    }));
  }

  // Always keep a concrete model selected once a provider+method is chosen, so
  // configuring an agent always implies a model. Defaults to the first (cheapest).
  useEffect(() => {
    if (pickerModels.length > 0 && !pickerModels.some((m) => m.id === agent.model)) {
      setAgent((a) => ({ ...a, model: pickerModels[0].id }));
    }
  }, [pickerModels, agent.model, setAgent]);

  function pick(id: string) {
    const p = PROVIDERS.find((x) => x.id === id);
    if (!p) return;
    setAgent((prev) => ({
      provider: id,
      method: p.cli ? 'cli' : p.kind === 'key' ? 'key' : 'url',
      value: '',
      model: '',
      liveTranslationKey: prev.liveTranslationKey ?? '',
      status: demoMode ? 'connected' : 'idle',
    }));
  }

  function setMethod(m: AgentState['method']) {
    setAgent((a) => ({ ...a, method: m, value: '', status: 'idle' }));
  }

  function verify() {
    setAgent((a) => ({ ...a, status: 'verifying' }));
    setTimeout(
      () => setAgent((a) => ({ ...a, status: 'connected' })),
      agent.method === 'cli' ? 900 : 1300
    );
  }

  const inputMethod = !demoMode && prov && (agent.method === 'key' || agent.method === 'url');

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>03 ·</span> Bring your own agent
      </div>
      <h1 className={t.title}>
        Connect the agent that <em>already knows you</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'This hosted walkthrough simulates the connection. Choose an agent to see how Sotto turns your own stack into a tutor when you self-host it.'
          : 'Sotto is infrastructure, not a model. Hook the Claude Code or Codex you already run, point it at a local endpoint, or paste a key. The same agent that knows your work becomes your tutor.'}
      </p>

      <div className={c.providerGrid}>
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            className={`${c.providerCard} ${agent.provider === p.id ? c.providerCardSel : ''}`}
          >
            <button
              className={c.providerSelect}
              onClick={() => pick(p.id)}
              aria-pressed={agent.provider === p.id}
            >
              <span className={c.pico}>
                <Glyph name={p.icon} size={20} />
              </span>
              <div>
                <div className={c.pname}>{p.name}</div>
                <div className={c.pmeta}>{p.meta}</div>
              </div>
            </button>
            {p.apiUrl ? (
              <a
                className={c.providerLink}
                href={p.apiUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${p.name} ${p.apiLabel ?? 'API'} page`}
              >
                {p.apiLabel ?? 'API'}
              </a>
            ) : null}
          </div>
        ))}
      </div>

      {prov && (
        <div className={c.connect} key={prov.id}>
          {demoMode && (
            <div className={`${c.statusPill} ${c.statusPillConnected}`}>
              <Glyph name="check" size={14} />
              {prov.name} preview connected · ready to compose
            </div>
          )}

          {!demoMode && prov.cli && (
            <div className={c.methodTabs}>
              <button
                className={`${c.methodTab} ${agent.method === 'cli' ? c.methodTabOn : ''}`}
                onClick={() => setMethod('cli')}
                aria-pressed={agent.method === 'cli'}
              >
                Installed CLI <span className={c.mtag}>no key</span>
              </button>
              <button
                className={`${c.methodTab} ${agent.method === 'key' ? c.methodTabOn : ''}`}
                onClick={() => setMethod('key')}
                aria-pressed={agent.method === 'key'}
              >
                API key
              </button>
            </div>
          )}

          {!demoMode && agent.method === 'cli' && prov.cli && (
            <div className={c.cliDetect}>
              <span className={c.cliIco}>
                <Glyph name={cliStatus?.readiness === 'ready' ? 'check' : 'retry'} size={18} />
              </span>
              <div>
                <div className={c.cliName}>
                  {cliStatus?.readiness === 'ready'
                    ? `${prov.cli.label} ready`
                    : cliStatus?.readiness === 'not_authenticated'
                      ? `${prov.cli.label} needs a login`
                      : cliStatus?.readiness === 'unreachable'
                        ? `${prov.cli.label} is unreachable`
                        : `${prov.cli.label} not found`}
                </div>
                <div className={c.cliPath}>
                  {cliStatus?.version ?? `${prov.cli.bin} · ${prov.cli.path}`}
                </div>
              </div>
              <button
                className={`${t.btn} ${t.btnGhost}`}
                disabled={cliStatus?.readiness === 'ready'}
                onClick={() => window.location.reload()}
              >
                {cliStatus?.readiness === 'ready' ? 'Linked' : 'Recheck'}
              </button>
            </div>
          )}

          {inputMethod && (
            <div>
              <div className={c.fieldLabel}>
                {agent.method === 'key' ? 'API key' : 'Endpoint URL'}
              </div>
              <div className={c.field}>
                <input
                  className={c.fieldInput}
                  type={agent.method === 'key' ? 'password' : 'text'}
                  placeholder={
                    agent.method === 'key'
                      ? envDetected.includes(agent.provider)
                        ? 'detected on the server · paste a key only to override'
                        : prov.keyHint
                      : prov.hint
                  }
                  value={agent.value}
                  onChange={(e) =>
                    setAgent((a) => ({ ...a, value: e.target.value, status: 'idle' }))
                  }
                  aria-label={agent.method === 'key' ? `${prov.name} API key` : 'Endpoint URL'}
                />
                <button
                  className={`${t.btn} ${t.btnGhost}`}
                  disabled={!agent.value || agent.status === 'connected'}
                  onClick={verify}
                >
                  {agent.status === 'connected' ? 'Connected' : 'Verify'}
                </button>
              </div>
            </div>
          )}

          {!demoMode &&
            (agent.method === 'key' || agent.method === 'cli') &&
            pickerModels.length > 0 && (
              <div>
                <div className={c.fieldLabel}>Model</div>
                <div className={c.field}>
                  <select
                    className={c.fieldInput}
                    value={
                      agentProvider && agentSelection
                        ? formatAgentModelId(agentProvider, agentSelection.model)
                        : agent.model
                    }
                    onChange={(e) => setAgentBaseModel(e.target.value)}
                    aria-label={`${prov.name} model`}
                  >
                    {pickerBaseModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                {agentProvider && pickerEfforts.length > 0 && (
                  <>
                    <div className={c.fieldLabel}>Reasoning effort</div>
                    <div className={c.field}>
                      <select
                        className={c.fieldInput}
                        value={agentSelection?.effort ?? ''}
                        onChange={(event) =>
                          setAgent((current) => ({
                            ...current,
                            model: formatAgentModelId(
                              agentProvider,
                              agentSelection?.model,
                              (event.target.value || null) as AgentEffortLevel | null
                            ),
                          }))
                        }
                        aria-label={`${prov.name} reasoning effort`}
                      >
                        <option value="">CLI default</option>
                        {pickerEfforts.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div className={c.locknote}>
                  <Glyph name="spark" size={15} />
                  The model that generates your lessons. Change it anytime in admin settings.
                </div>
              </div>
            )}

          {!demoMode && agent.method === 'url' && (
            <div>
              <div className={c.fieldLabel}>Model</div>
              <div className={c.field}>
                <input
                  className={c.fieldInput}
                  type="text"
                  placeholder="qwen3, llama3.3, gemma3…"
                  value={agent.model}
                  onChange={(e) => setAgent((a) => ({ ...a, model: e.target.value }))}
                  aria-label="Local model name"
                />
              </div>
              <div className={c.locknote}>
                <Glyph name="spark" size={15} />
                The model your local server serves (sent as AI_MODEL). Change it anytime in admin
                settings.
              </div>
            </div>
          )}

          {!demoMode && agent.status === 'verifying' && (
            <div className={`${c.statusPill} ${c.statusPillVerifying}`}>
              <span className={c.spin} />
              {agent.method === 'cli'
                ? `reusing ${prov.cli?.label} session…`
                : `handshaking with ${prov.name}…`}
            </div>
          )}
          {!demoMode && agent.status === 'connected' && (
            <div className={`${c.statusPill} ${c.statusPillConnected}`}>
              <Glyph name="check" size={14} />
              {agent.method === 'cli'
                ? `${prov.cli?.label} linked · session reused`
                : envReady
                  ? `${prov.name} key detected on the server`
                  : `${prov.name} connected`}{' '}
              · ready to compose
            </div>
          )}

          <div className={c.locknote}>
            <Glyph name="lock" size={15} />
            {demoMode
              ? 'Demo mode only simulates this connection; no key or endpoint is sent or stored.'
              : agent.method === 'cli'
                ? "Sotto reuses your CLI's existing auth. Nothing new to paste, nothing leaves your machine."
                : 'Your key stays in your environment. Sotto never proxies it through us. There is no us.'}
          </div>
        </div>
      )}

      {!demoMode && (
        <div className={c.connect}>
          <div>
            <div className={c.fieldLabel}>Google API key for Live</div>
            <div className={c.field}>
              <input
                className={c.fieldInput}
                type="password"
                placeholder="AIza-..."
                value={liveTranslationKey}
                onChange={(e) => setAgent((a) => ({ ...a, liveTranslationKey: e.target.value }))}
                aria-label="Google Gemini API key for live conversation"
              />
              <a
                className={c.providerLink}
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                aria-label="Open Google AI Studio API key page"
              >
                Get key
              </a>
            </div>
          </div>
          <div className={c.locknote}>
            <Glyph name="lock" size={15} />
            Optional. Saves a Google key for live spoken translation; your course agent choice stays
            separate.
          </div>
        </div>
      )}

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          disabled={agent.status !== 'connected'}
          onClick={onNext}
        >
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
