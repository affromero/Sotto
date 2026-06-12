'use client';

import { PROVIDERS } from '../data';
import type { AgentState } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  agent: AgentState;
  demoMode: boolean;
  setAgent: (updater: (prev: AgentState) => AgentState) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepAgent({ agent, demoMode, setAgent, onNext, onBack }: Props) {
  const prov = PROVIDERS.find((p) => p.id === agent.provider);
  const liveTranslationKey = agent.liveTranslationKey ?? '';

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
        <span className={t.eyebrowIdx}>01 ·</span> Bring your own agent
      </div>
      <h1 className={t.title}>
        Connect the agent that <em>already knows you</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'This hosted walkthrough simulates the connection. Choose an agent to see how Sotto turns your own stack into a tutor when you self-host it.'
          : 'Sotto is infrastructure, not a model. Hook the Claude Code or Codex you already run, point it at a local endpoint, or paste a key — the same agent that knows your work becomes your tutor.'}
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
                <Glyph name="check" size={18} />
              </span>
              <div>
                <div className={c.cliName}>{prov.cli.label} detected</div>
                <div className={c.cliPath}>
                  {prov.cli.bin} v{prov.cli.ver} · {prov.cli.path}
                </div>
              </div>
              <button
                className={`${t.btn} ${t.btnGhost}`}
                disabled={agent.status === 'connected'}
                onClick={verify}
              >
                {agent.status === 'connected' ? 'Linked' : 'Link'}
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
                  placeholder={agent.method === 'key' ? prov.keyHint : prov.hint}
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
                : `${prov.name} connected`}{' '}
              · ready to compose
            </div>
          )}

          <div className={c.locknote}>
            <Glyph name="lock" size={15} />
            {demoMode
              ? 'Demo mode only simulates this connection; no key or endpoint is sent or stored.'
              : agent.method === 'cli'
                ? "Sotto reuses your CLI's existing auth — nothing new to paste, nothing leaves your machine."
                : 'Your key stays in your environment. Sotto never proxies it through us — there is no us.'}
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
