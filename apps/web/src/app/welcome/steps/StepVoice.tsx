'use client';

import { TTS_PROVIDERS, STT_PROVIDERS } from '../data';
import type { VoiceState } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.module.css';

interface VoicePickerProps {
  label: string;
  sub: string;
  providers: typeof TTS_PROVIDERS;
  value: string;
  onChange: (id: string) => void;
  keys: Record<string, string>;
  onKey: (id: string, val: string) => void;
  baseUrls: Record<string, string>;
  onBaseUrl: (id: string, val: string) => void;
  localPlaceholder: string;
  demoMode: boolean;
}

function VoicePicker({
  label,
  sub,
  providers,
  value,
  onChange,
  keys,
  onKey,
  baseUrls,
  onBaseUrl,
  localPlaceholder,
  demoMode,
}: VoicePickerProps) {
  const sel = providers.find((p) => p.id === value) ?? providers[0];
  const k = keys[sel.id] ?? '';
  const bu = baseUrls[sel.id] ?? '';

  return (
    <div className={c.voiceBlock}>
      <div className={c.voiceHead}>
        <span className={t.mlabel}>{label}</span>
        <span className={c.voiceSub}>{sub}</span>
      </div>
      <div className={c.voicePills}>
        {providers.map((p) => {
          const set = !p.local && (keys[p.id] ?? '').trim().length > 0;
          return (
            <button
              key={p.id}
              className={`${c.voiceChip} ${value === p.id ? c.voiceChipSel : ''}`}
              onClick={() => onChange(p.id)}
              aria-pressed={value === p.id}
            >
              {p.name}
              {p.rec && <span className={c.vcTag}>rec</span>}
              {p.local && (
                <span className={c.vcLocal}>
                  <Glyph name="shield" size={12} />
                </span>
              )}
              {set && (
                <span className={c.vcSet}>
                  <Glyph name="check" size={12} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {demoMode ? (
        <div className={c.voiceKey}>
          <div className={c.voiceNote}>
            <Glyph name="lock" size={13} />
            Hosted demo preview · no key or local endpoint is requested or saved.
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
          </div>
          <div className={c.vkNote}>
            {k.trim()
              ? `Saved to your config · ${sel.note} · edit anytime in settings`
              : `${sel.note} · paste now or add it later in settings`}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  voice: VoiceState;
  demoMode: boolean;
  setVoice: (updater: (prev: VoiceState) => VoiceState) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepVoice({ voice, demoMode, setVoice, onNext, onBack }: Props) {
  const setKey = (id: string, val: string) =>
    setVoice((s) => ({ ...s, keys: { ...s.keys, [id]: val } }));
  const setBaseUrl = (id: string, val: string) =>
    setVoice((s) => ({ ...s, baseUrls: { ...s.baseUrls, [id]: val } }));

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>02 ·</span> Voice
      </div>
      <h1 className={t.title}>
        Choose the voice that <em>speaks with you</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'This hosted walkthrough previews the voice stack without asking for keys. In self-hosted Sotto, these choices power listening lessons and pronunciation feedback.'
          : 'Listening and speaking run on providers you pick — swap them anytime. Drop in your keys now so the whole stack is wired from the first session; you can change any of it later in settings.'}
      </p>

      <VoicePicker
        label="Text to speech"
        sub="your listening lesson & spoken examples"
        providers={TTS_PROVIDERS}
        value={voice.tts}
        onChange={(v) => setVoice((s) => ({ ...s, tts: v }))}
        keys={voice.keys}
        onKey={setKey}
        baseUrls={voice.baseUrls}
        onBaseUrl={setBaseUrl}
        localPlaceholder="http://localhost:8000"
        demoMode={demoMode}
      />

      <VoicePicker
        label="Speech to text"
        sub="scores your pronunciation, phoneme by phoneme"
        providers={STT_PROVIDERS}
        value={voice.stt}
        onChange={(v) => setVoice((s) => ({ ...s, stt: v }))}
        keys={voice.keys}
        onKey={setKey}
        baseUrls={voice.baseUrls}
        onBaseUrl={setBaseUrl}
        localPlaceholder="http://localhost:8000/v1"
        demoMode={demoMode}
      />

      <div className={`${c.locknote} ${c.voiceFoot}`}>
        <Glyph name="spark" size={15} />
        {demoMode
          ? 'No credentials are requested or stored in the hosted demo; this is only a preview of the provider choices.'
          : 'Keys are shared where it makes sense — enter ElevenLabs or OpenAI once and it powers both. Everything writes to your local config, nothing leaves your machine.'}
      </div>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button className={`${t.btn} ${t.btnPrimary}`} onClick={onNext}>
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
