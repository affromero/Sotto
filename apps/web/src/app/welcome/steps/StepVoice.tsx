'use client';

import { useEffect, useMemo, useState } from 'react';
import { LANGUAGE_DISPLAY } from '@sotto/shared';
import { LANGUAGES, TTS_PROVIDERS, STT_PROVIDERS } from '../data';
import type { ModelOption, VoiceState } from '../WelcomeFlow';
import {
  DEFAULT_LOCAL_STT_BASE_URL,
  DEFAULT_LOCAL_TTS_BASE_URL,
  sttModelProviderId,
} from '../providerMap';
import { Glyph } from '../Glyph';
import {
  getWelcomeSpeechProviderLanguageCount,
  normalizeSottoLanguageCode,
  SOTTO_LANGUAGE_CODES,
  supportsWelcomeSpeechProviderLanguage,
} from '@/lib/speech-language-support';
import t from '../theme.module.css';
import c from '../components.module.css';

const VISUAL_CUE_KEY_ID = 'visual:pexels';

function displayLanguageName(code: string): string {
  return (
    LANGUAGES.find((language) => language.code === code)?.name ??
    LANGUAGE_DISPLAY[code as keyof typeof LANGUAGE_DISPLAY] ??
    code.toUpperCase()
  );
}

interface VoicePickerProps {
  label: string;
  sub: string;
  providers: typeof TTS_PROVIDERS;
  kind: 'tts' | 'stt';
  value: string;
  onChange: (id: string) => void;
  language: string;
  keys: Record<string, string>;
  onKey: (id: string, val: string) => void;
  baseUrls: Record<string, string>;
  onBaseUrl: (id: string, val: string) => void;
  localPlaceholder: string;
  demoMode: boolean;
  /** Model options for the currently selected provider (empty for local/none). */
  modelOptions: ModelOption[];
  modelValue: string;
  onModel: (modelId: string) => void;
}

function VoicePicker({
  label,
  sub,
  providers,
  kind,
  value,
  onChange,
  language,
  keys,
  onKey,
  baseUrls,
  onBaseUrl,
  localPlaceholder,
  demoMode,
  modelOptions,
  modelValue,
  onModel,
}: VoicePickerProps) {
  const sel = providers.find((p) => p.id === value) ?? providers[0];
  const languageCode = normalizeSottoLanguageCode(language);
  const languageLabel = languageCode ? displayLanguageName(languageCode) : null;
  const selectedSupported = supportsWelcomeSpeechProviderLanguage(kind, sel.id, languageCode);
  const selectedReason = languageLabel
    ? selectedSupported
      ? `${sel.name} has a compatible ${kind === 'tts' ? 'speech' : 'transcription'} model for ${languageLabel}. Sotto keeps the configured model when it fits and swaps within ${sel.name} before calling the provider when it does not.`
      : `${sel.name} has no ${kind === 'tts' ? 'speech' : 'transcription'} model for ${languageLabel}. Choose another provider before continuing.`
    : 'Choose a course language first; Sotto checks model-language fit before any provider call.';
  const k = keys[sel.id] ?? '';
  const bu = baseUrls[sel.id] ?? '';
  const selectedLinkLabel = sel.apiLabel === 'API' ? 'Get key' : (sel.apiLabel ?? 'Get key');
  const selectedLinkAria =
    sel.apiLabel === 'Docs' ? `Open ${sel.name} docs page` : `Open ${sel.name} API page`;

  return (
    <div className={c.voiceBlock}>
      <div className={c.voiceHead}>
        <span className={t.mlabel}>{label}</span>
        <span className={c.voiceSub}>{sub}</span>
      </div>
      <div className={c.voicePills}>
        {providers.map((p) => {
          const set = !p.local && (keys[p.id] ?? '').trim().length > 0;
          const isSelected = value === p.id;
          const isSupported = supportsWelcomeSpeechProviderLanguage(kind, p.id, languageCode);
          const languageCount = getWelcomeSpeechProviderLanguageCount(kind, p.id);
          const languageNote = languageLabel
            ? isSupported
              ? `${languageLabel} ready`
              : `No ${languageLabel}`
            : `${languageCount}/${SOTTO_LANGUAGE_CODES.size} languages`;
          return (
            <button
              key={p.id}
              className={`${c.voiceChoice} ${isSelected ? c.voiceChoiceSel : ''} ${
                !isSupported ? c.voiceChoiceDisabled : ''
              }`}
              onClick={() => {
                if (isSupported) onChange(p.id);
              }}
              aria-pressed={isSelected}
              aria-disabled={!isSupported}
              disabled={!isSupported}
            >
              <span className={c.voiceChipText}>
                <span className={c.voiceChipName}>
                  {p.name}
                  {p.local && (
                    <span className={c.vcLocal}>
                      <Glyph name="shield" size={12} />
                      local
                    </span>
                  )}
                  {set && (
                    <span className={c.vcSet}>
                      <Glyph name="check" size={12} />
                    </span>
                  )}
                </span>
                <span className={c.voiceChipNote}>{p.note}</span>
                <span className={`${c.vcLang} ${!isSupported ? c.vcLangBad : ''}`}>
                  {languageNote}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className={`${c.voiceReason} ${!selectedSupported ? c.voiceReasonWarn : ''}`}>
        <Glyph name={selectedSupported ? 'check' : 'x'} size={13} />
        <span>{selectedReason}</span>
      </div>

      {demoMode ? (
        <div className={c.voiceKey}>
          <div className={c.voiceNote}>
            <Glyph name="lock" size={13} />
            Hosted demo preview · no key or local endpoint is requested or saved.
            {sel.apiUrl ? (
              <a
                className={c.voiceInlineLink}
                href={sel.apiUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={selectedLinkAria}
              >
                {selectedLinkLabel}
              </a>
            ) : null}
          </div>
        </div>
      ) : sel.local ? (
        <div className={c.voiceKey}>
          <div className={c.voiceNote}>
            <Glyph name="lock" size={13} />
            {sel.name} · {sel.note} · runs on-device, no key needed
          </div>
          <div className={c.vkRow}>
            <span className={c.vkLabel}>
              <Glyph name="link" size={13} /> {sel.name} endpoint
            </span>
            <input
              className={c.vkInput}
              type="text"
              placeholder={localPlaceholder}
              value={bu}
              onChange={(e) => onBaseUrl(sel.id, e.target.value)}
              aria-label={`${sel.name} endpoint URL (optional)`}
            />
            {sel.apiUrl ? (
              <a
                className={c.vkActionLink}
                href={sel.apiUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={selectedLinkAria}
              >
                {selectedLinkLabel}
              </a>
            ) : null}
          </div>
          <div className={c.vkNote}>Optional · leave blank to use the default local endpoint.</div>
        </div>
      ) : (
        <div className={c.voiceKey}>
          <div className={c.vkRow}>
            <span className={c.vkLabel}>
              <Glyph name="key" size={13} /> {sel.name} key
            </span>
            <input
              className={c.vkInput}
              type="password"
              placeholder={sel.keyHint}
              value={k}
              onChange={(e) => onKey(sel.id, e.target.value)}
              aria-label={`${sel.name} API key`}
            />
            {sel.apiUrl ? (
              <a
                className={c.vkActionLink}
                href={sel.apiUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={selectedLinkAria}
              >
                {selectedLinkLabel}
              </a>
            ) : null}
          </div>
          {modelOptions.length > 0 && (
            <div className={c.vkRow}>
              <span className={c.vkLabel}>
                <Glyph name="spark" size={13} /> {sel.name} model
              </span>
              <select
                className={c.vkInput}
                value={modelValue}
                onChange={(e) => onModel(e.target.value)}
                aria-label={`${sel.name} model`}
              >
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={c.vkNote}>
            {k.trim()
              ? `Saved to your config · ${sel.note} · edit anytime in admin providers`
              : `${sel.note} · paste now or add it later in admin providers`}
          </div>
        </div>
      )}
    </div>
  );
}

function VisualCuePicker({
  voice,
  demoMode,
  onProvider,
  onKey,
}: {
  voice: VoiceState;
  demoMode: boolean;
  onProvider: (provider: VoiceState['visualCueProvider']) => void;
  onKey: (value: string) => void;
}) {
  const enabled = voice.visualCueProvider === 'pexels';
  const key = voice.keys[VISUAL_CUE_KEY_ID] ?? '';

  return (
    <section className={c.learningBlock} aria-labelledby="learning-tools-title">
      <div className={c.learningHead}>
        <div>
          <span className={t.mlabel}>Learning actions</span>
          <h2 id="learning-tools-title" className={c.learningTitle}>
            Right-click practice that feeds the model
          </h2>
        </div>
        <span className={c.learningBadge}>optional</span>
      </div>

      <div className={c.learningFlow} aria-label="Right-click learning flow">
        <div className={c.learningStep}>
          <Glyph name="book" size={16} />
          <span>Select a word or sentence</span>
        </div>
        <div className={c.learningStep}>
          <Glyph name="graph" size={16} />
          <span>Mark it as a weak target</span>
        </div>
        <div className={c.learningStep}>
          <Glyph name="volume" size={16} />
          <span>Practice, hear it, or attach an image</span>
        </div>
      </div>

      <p className={c.learningCopy}>
        Pronounce uses the text-to-speech provider above. Image cues use a separate visual provider
        so practice can build memory from context instead of translation.
      </p>

      <div className={c.visualChoiceRow} role="group" aria-label="Visual cue provider">
        <button
          type="button"
          className={`${c.visualChoice} ${enabled ? c.visualChoiceSel : ''}`}
          aria-pressed={enabled}
          onClick={() => onProvider('pexels')}
        >
          <Glyph name="spark" size={15} />
          <span>
            <strong>Pexels</strong>
            <small>licensed image search for memory cues</small>
          </span>
        </button>
        <button
          type="button"
          className={`${c.visualChoice} ${!enabled ? c.visualChoiceSel : ''}`}
          aria-pressed={!enabled}
          onClick={() => onProvider('off')}
        >
          <Glyph name="x" size={15} />
          <span>
            <strong>Off</strong>
            <small>save focus targets without images</small>
          </span>
        </button>
      </div>

      {enabled ? (
        demoMode ? (
          <div className={c.voiceNote}>
            <Glyph name="lock" size={13} />
            Hosted demo preview · no visual provider key is requested or saved.
            <a
              className={c.voiceInlineLink}
              href="https://www.pexels.com/api/"
              target="_blank"
              rel="noreferrer"
              aria-label="Open Pexels API page"
            >
              Get key
            </a>
          </div>
        ) : (
          <div className={c.voiceKey}>
            <div className={c.vkRow}>
              <span className={c.vkLabel}>
                <Glyph name="key" size={13} /> Pexels key
              </span>
              <input
                className={c.vkInput}
                type="password"
                placeholder="pexels_..."
                value={key}
                onChange={(event) => onKey(event.target.value)}
                aria-label="Pexels API key"
              />
              <a
                className={c.vkActionLink}
                href="https://www.pexels.com/api/"
                target="_blank"
                rel="noreferrer"
                aria-label="Open Pexels API page"
              >
                Get key
              </a>
            </div>
            <div className={c.vkNote}>
              {key.trim()
                ? 'Saved as an encrypted visual cue key when setup finishes.'
                : 'Paste now or add it later; image cues stay optional.'}
            </div>
          </div>
        )
      ) : (
        <div className={c.vkNote}>
          Image cues are disabled. Right-click focus practice still works.
        </div>
      )}
    </section>
  );
}

interface Props {
  voice: VoiceState;
  demoMode: boolean;
  language: string;
  /** Registry TTS models keyed by provider id (elevenlabs, openai, cartesia, hume). */
  ttsModels?: Record<string, ModelOption[]>;
  /** Registry STT models keyed by registry provider id (openai, deepgram, assemblyai, elevenlabs). */
  sttModels?: Record<string, ModelOption[]>;
  setVoice: (updater: (prev: VoiceState) => VoiceState) => void;
  onNext: () => void;
  onBack: () => void;
}

interface LocalSpeechCheckItem {
  id: 'tts' | 'stt';
  label: string;
  url: string;
  ok: boolean;
  detail: string;
}

interface LocalSpeechCheckState {
  status: 'idle' | 'checking' | 'ok' | 'error';
  signature: string;
  message: string;
  checks: LocalSpeechCheckItem[];
}

function isLocalProvider(id: string, providers: typeof TTS_PROVIDERS) {
  return providers.some((provider) => provider.id === id && provider.local);
}

export function StepVoice({
  voice,
  demoMode,
  language,
  ttsModels = {},
  sttModels = {},
  setVoice,
  onNext,
  onBack,
}: Props) {
  const [localCheck, setLocalCheck] = useState<LocalSpeechCheckState>({
    status: 'idle',
    signature: '',
    message: '',
    checks: [],
  });
  const setKey = (id: string, val: string) =>
    setVoice((s) => ({ ...s, keys: { ...s.keys, [id]: val } }));
  const setBaseUrl = (id: string, val: string) =>
    setVoice((s) => ({ ...s, baseUrls: { ...s.baseUrls, [id]: val } }));
  const ttsIsLocal = isLocalProvider(voice.tts, TTS_PROVIDERS);
  const sttIsLocal = isLocalProvider(voice.stt, STT_PROVIDERS);

  // Model pickers for the currently-selected cloud provider. TTS keys by provider
  // id directly; STT remaps the wizard id (whisper→local, assembly→assemblyai).
  const ttsModelRegId = voice.tts;
  const sttModelRegId = sttModelProviderId(voice.stt);
  const ttsModelOptions = useMemo<ModelOption[]>(
    () => (ttsIsLocal ? [] : (ttsModels[ttsModelRegId] ?? [])),
    [ttsIsLocal, ttsModels, ttsModelRegId]
  );
  const sttModelOptions = useMemo<ModelOption[]>(
    () => (sttIsLocal ? [] : (sttModels[sttModelRegId] ?? [])),
    [sttIsLocal, sttModels, sttModelRegId]
  );
  const setTtsModel = (modelId: string) =>
    setVoice((s) => ({ ...s, ttsModel: { ...s.ttsModel, [ttsModelRegId]: modelId } }));
  const setSttModel = (modelId: string) =>
    setVoice((s) => ({ ...s, sttModel: { ...s.sttModel, [sttModelRegId]: modelId } }));

  // Keep a concrete model selected for the active cloud provider (defaults to the
  // first option) so choosing a provider always yields a model — changeable later.
  useEffect(() => {
    if (
      ttsModelOptions.length > 0 &&
      !ttsModelOptions.some((m) => m.id === voice.ttsModel[ttsModelRegId])
    ) {
      setTtsModel(ttsModelOptions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsModelOptions, ttsModelRegId, voice.ttsModel]);
  useEffect(() => {
    if (
      sttModelOptions.length > 0 &&
      !sttModelOptions.some((m) => m.id === voice.sttModel[sttModelRegId])
    ) {
      setSttModel(sttModelOptions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sttModelOptions, sttModelRegId, voice.sttModel]);
  const ttsLanguageCompatible = supportsWelcomeSpeechProviderLanguage('tts', voice.tts, language);
  const sttLanguageCompatible = supportsWelcomeSpeechProviderLanguage('stt', voice.stt, language);
  const languageCompatible = ttsLanguageCompatible && sttLanguageCompatible;
  const languageCode = normalizeSottoLanguageCode(language);
  const languageLabel = languageCode ? displayLanguageName(languageCode) : null;
  const needsLocalCheck = !demoMode && (ttsIsLocal || sttIsLocal);
  const localCheckSignature = useMemo(
    () =>
      JSON.stringify({
        tts: ttsIsLocal
          ? {
              provider: voice.tts,
              baseUrl: voice.baseUrls[voice.tts]?.trim() || DEFAULT_LOCAL_TTS_BASE_URL,
            }
          : null,
        stt: sttIsLocal
          ? {
              provider: voice.stt,
              baseUrl: voice.baseUrls[voice.stt]?.trim() || DEFAULT_LOCAL_STT_BASE_URL,
            }
          : null,
      }),
    [sttIsLocal, ttsIsLocal, voice.baseUrls, voice.stt, voice.tts]
  );
  const localCheckFresh = localCheck.signature === localCheckSignature;
  const localCheckStatus =
    localCheck.status !== 'idle' && !localCheckFresh ? 'stale' : localCheck.status;
  const canContinue =
    languageCompatible && (!needsLocalCheck || (localCheckStatus === 'ok' && localCheckFresh));

  async function checkLocalSpeech() {
    setLocalCheck({
      status: 'checking',
      signature: localCheckSignature,
      message: 'Checking selected local endpoints.',
      checks: [],
    });

    try {
      const res = await fetch('/api/v1/onboarding/check-local-speech', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tts: { provider: voice.tts, baseUrl: voice.baseUrls[voice.tts] ?? '' },
          stt: { provider: voice.stt, baseUrl: voice.baseUrls[voice.stt] ?? '' },
        }),
      });
      if (!res.ok) {
        setLocalCheck({
          status: 'error',
          signature: localCheckSignature,
          message: 'Could not run the local endpoint check.',
          checks: [],
        });
        return;
      }

      const data = (await res.json()) as { ok?: boolean; checks?: LocalSpeechCheckItem[] };
      const checks = Array.isArray(data.checks) ? data.checks : [];
      setLocalCheck({
        status: data.ok ? 'ok' : 'error',
        signature: localCheckSignature,
        message: data.ok
          ? 'Local speech endpoints are ready.'
          : 'One or more local speech endpoints failed.',
        checks,
      });
    } catch {
      setLocalCheck({
        status: 'error',
        signature: localCheckSignature,
        message: 'Could not reach Sotto to run the local endpoint check.',
        checks: [],
      });
    }
  }

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>04 ·</span> Voice
      </div>
      <h1 className={t.title}>
        Choose the tools that <em>practice with you</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'This hosted walkthrough previews the learning stack without asking for keys. In self-hosted Sotto, these choices power listening lessons, pronunciation feedback, and right-click focus practice.'
          : 'Listening, pronunciation, and visual memory cues run on providers you pick — swap them anytime. Drop in your keys now so the whole stack is wired from the first session.'}
      </p>

      <VoicePicker
        label="Text to speech"
        sub="listening lessons, spoken examples, and right-click Pronounce"
        providers={TTS_PROVIDERS}
        kind="tts"
        value={voice.tts}
        onChange={(v) => setVoice((s) => ({ ...s, tts: v }))}
        language={language}
        keys={voice.keys}
        onKey={setKey}
        baseUrls={voice.baseUrls}
        onBaseUrl={setBaseUrl}
        localPlaceholder="http://localhost:8000"
        demoMode={demoMode}
        modelOptions={ttsModelOptions}
        modelValue={voice.ttsModel[ttsModelRegId] ?? ''}
        onModel={setTtsModel}
      />

      <VoicePicker
        label="Speech to text"
        sub="speaking submissions and pronunciation feedback"
        providers={STT_PROVIDERS}
        kind="stt"
        value={voice.stt}
        onChange={(v) => setVoice((s) => ({ ...s, stt: v }))}
        language={language}
        keys={voice.keys}
        onKey={setKey}
        baseUrls={voice.baseUrls}
        onBaseUrl={setBaseUrl}
        localPlaceholder="http://localhost:8001/v1"
        demoMode={demoMode}
        modelOptions={sttModelOptions}
        modelValue={voice.sttModel[sttModelRegId] ?? ''}
        onModel={setSttModel}
      />

      {!languageCompatible && languageLabel ? (
        <div className={c.compatWarning} role="alert">
          <Glyph name="x" size={14} />
          <span>
            Choose voice providers with {languageLabel} support before continuing. Runtime
            generation and speaking grading will reject incompatible model choices.
          </span>
        </div>
      ) : null}

      <VisualCuePicker
        voice={voice}
        demoMode={demoMode}
        onProvider={(provider) => setVoice((s) => ({ ...s, visualCueProvider: provider }))}
        onKey={(value) => setKey(VISUAL_CUE_KEY_ID, value)}
      />

      <div className={`${c.locknote} ${c.voiceFoot}`}>
        <Glyph name="spark" size={15} />
        {demoMode
          ? 'No credentials are requested or stored in the hosted demo; this is only a preview of the provider choices.'
          : 'Keys are shared where it makes sense — enter OpenAI, ElevenLabs, or a visual provider once and Sotto uses the selected provider for the matching learning action.'}
      </div>

      {needsLocalCheck && (
        <section className={c.localCheck} aria-live="polite">
          <div className={c.localCheckTop}>
            <div className={c.localCheckCopy}>
              <span className={c.localCheckTitle}>
                <Glyph name={localCheckStatus === 'ok' ? 'check' : 'link'} size={14} />
                Local endpoint check
              </span>
              <span className={c.localCheckHint}>
                Tests selected local speech servers from this Sotto instance before continuing.
              </span>
            </div>
            <button
              type="button"
              className={c.localCheckButton}
              onClick={checkLocalSpeech}
              disabled={localCheckStatus === 'checking'}
            >
              {localCheckStatus === 'checking' ? 'Checking.' : 'Check'}
            </button>
          </div>

          {localCheckStatus !== 'idle' && (
            <div
              className={`${c.localCheckResult} ${
                localCheckStatus === 'ok' ? c.localCheckResultOk : c.localCheckResultError
              }`}
              role={
                localCheckStatus === 'error' || localCheckStatus === 'stale' ? 'alert' : undefined
              }
            >
              {localCheckStatus === 'stale'
                ? 'Endpoint changed. Run the check again before continuing.'
                : localCheck.message}
            </div>
          )}

          {localCheck.checks.length > 0 && localCheckFresh && (
            <ul className={c.localCheckList}>
              {localCheck.checks.map((item) => (
                <li
                  key={item.id}
                  className={`${c.localCheckItem} ${
                    item.ok ? c.localCheckItemOk : c.localCheckItemError
                  }`}
                >
                  <span className={c.localCheckItemHead}>
                    <Glyph name={item.ok ? 'check' : 'x'} size={13} />
                    <span>{item.label}</span>
                    <code>{item.url}</code>
                  </span>
                  <span className={c.localCheckItemDetail}>{item.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button className={`${t.btn} ${t.btnPrimary}`} onClick={onNext} disabled={!canContinue}>
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
