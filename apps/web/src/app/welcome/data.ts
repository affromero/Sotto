/* data.ts — typed static content for the welcome onboarding flow */

export interface Language {
  code: string;
  name: string;
  native: string;
  hi: string;
}

export interface BaseLang {
  code: string;
  name: string;
}

export interface ProviderCli {
  label: string;
  bin: string;
  ver: string;
  path: string;
}

export interface Provider {
  id: string;
  name: string;
  meta: string;
  icon: GlyphName;
  rec?: boolean;
  cli?: ProviderCli;
  keyHint?: string;
  kind?: 'url';
  hint?: string;
}

export interface VoiceProvider {
  id: string;
  name: string;
  note: string;
  rec?: boolean;
  local?: boolean;
  keyHint?: string;
}

export interface Source {
  id: string;
  label: string;
  meta: string;
  sample: string;
}

export interface PlacementSentence {
  level: CefrLevel;
  text: string;
  gloss: string;
}

export interface ComposeLogLine {
  t: 'ctx' | 'ok' | 'plan' | 'done';
  text: string;
}

export interface Module {
  id: string;
  name: string;
  meta: string;
  glyph: GlyphName;
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type GlyphName =
  | 'arrow'
  | 'check'
  | 'key'
  | 'link'
  | 'plug'
  | 'gate'
  | 'book'
  | 'wave'
  | 'mic'
  | 'graph'
  | 'spark'
  | 'repo'
  | 'lock'
  | 'shield'
  | 'dot';


export const LANGUAGES: Language[] = [
  { code: 'it', name: 'Italian', native: 'Italiano', hi: 'ciao' },
  { code: 'ja', name: 'Japanese', native: '日本語', hi: 'こんにちは' },
  { code: 'fr', name: 'French', native: 'Français', hi: 'bonjour' },
  { code: 'es', name: 'Spanish', native: 'Español', hi: 'hola' },
  { code: 'de', name: 'German', native: 'Deutsch', hi: 'hallo' },
  { code: 'pt', name: 'Portuguese', native: 'Português', hi: 'olá' },
  { code: 'ko', name: 'Korean', native: '한국어', hi: '안녕' },
  { code: 'ar', name: 'Arabic', native: 'العربية', hi: 'مرحبا' },
];

export const BASE_LANGS: BaseLang[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'ar', name: 'العربية' },
];

export const PROVIDERS: Provider[] = [
  {
    id: 'claude',
    name: 'Claude',
    meta: 'Anthropic · CLI or API',
    icon: 'plug',
    rec: true,
    cli: { label: 'Claude Code', bin: 'claude', ver: '1.2.4', path: '/usr/local/bin/claude' },
    keyHint: 'sk-ant-…',
  },
  {
    id: 'codex',
    name: 'Codex',
    meta: 'OpenAI · CLI or API',
    icon: 'plug',
    cli: { label: 'Codex CLI', bin: 'codex', ver: '0.9.1', path: '/opt/homebrew/bin/codex' },
    keyHint: 'sk-…',
  },
  {
    id: 'local',
    name: 'Local',
    meta: 'Ollama · llama.cpp · LM Studio',
    icon: 'link',
    kind: 'url',
    hint: 'http://localhost:11434',
  },
  {
    id: 'custom',
    name: 'Custom',
    meta: 'Any OpenAI-compatible endpoint',
    icon: 'link',
    kind: 'url',
    hint: 'https://…/v1',
  },
];

export const TTS_PROVIDERS: VoiceProvider[] = [
  { id: 'elevenlabs', name: 'ElevenLabs', note: 'expressive multilingual voices', rec: true, keyHint: 'xi-api-key…' },
  { id: 'hume', name: 'Hume', note: 'emotionally-aware prosody', keyHint: 'hume_…' },
  { id: 'openai', name: 'OpenAI', note: 'natural, low cost', keyHint: 'sk-…' },
  { id: 'cartesia', name: 'Cartesia', note: 'low-latency Sonic voices', keyHint: 'sk_car_…' },
  { id: 'kokoro', name: 'Kokoro', note: 'runs on-device', local: true },
];

export const STT_PROVIDERS: VoiceProvider[] = [
  { id: 'whisper', name: 'Whisper', note: 'on-device, private', local: true, rec: true },
  { id: 'deepgram', name: 'Deepgram', note: 'word-level timing', keyHint: 'dg_…' },
  { id: 'elevenlabs', name: 'ElevenLabs Scribe', note: 'high accuracy', keyHint: 'xi-api-key…' },
  { id: 'assembly', name: 'AssemblyAI', note: 'phoneme-level scoring', keyHint: 'aai_…' },
  { id: 'openai', name: 'OpenAI', note: 'gpt-4o transcribe', keyHint: 'sk-…' },
];

export const SOURCES: Source[] = [
  { id: 'repos', label: 'Code & repos', meta: 'what you build', sample: 'deploy pipelines, Rust, k8s manifests' },
  { id: 'reading', label: 'Reading list', meta: 'what you follow', sample: 'papers on distributed systems, sci-fi' },
  { id: 'notes', label: 'Notes & docs', meta: 'what you think about', sample: 'design docs, daily journal' },
  { id: 'calendar', label: 'Calendar', meta: 'your week', sample: 'standups, a trip to Bologna in May' },
  { id: 'music', label: 'Listening history', meta: 'your ear', sample: 'jazz, lo-fi, Italian podcasts' },
  { id: 'manual', label: 'Topics, by hand', meta: 'tell it directly', sample: 'cooking, climbing, opera' },
];

export const PLACEMENT_BY_LANG: Record<string, PlacementSentence[]> = {
  it: [
    { level: 'A1', text: 'Mi chiamo Luca.', gloss: 'My name is Luca.' },
    { level: 'A2', text: 'Vorrei un caffè, per favore.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'Se avessi tempo, leggerei di più.', gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'Nonostante il ritardo, siamo arrivati.', gloss: 'Despite the delay, we arrived.' },
    { level: 'C1', text: 'Avrebbe dovuto avvisarci per tempo.', gloss: 'He should have warned us in time.' },
    { level: 'C2', text: 'Pur essendo restio, acconsentì all\'impresa.', gloss: 'Though reluctant, he consented to the venture.' },
  ],
  ja: [
    { level: 'A1', text: '私は学生です。', gloss: 'I am a student.' },
    { level: 'A2', text: 'コーヒーをください。', gloss: 'Coffee, please.' },
    { level: 'B1', text: '時間があれば、もっと本を読みます。', gloss: 'If I have time, I read more.' },
    { level: 'B2', text: '遅れたにもかかわらず、間に合いました。', gloss: 'Despite being late, we made it.' },
    { level: 'C1', text: 'もっと早く知らせてくれればよかったのに。', gloss: 'You should have told me sooner.' },
    { level: 'C2', text: '気が進まないながらも、彼はその計画に同意した。', gloss: 'Reluctant though he was, he agreed to the plan.' },
  ],
  fr: [
    { level: 'A1', text: "Je m'appelle Luc.", gloss: 'My name is Luc.' },
    { level: 'A2', text: "Je voudrais un café, s'il vous plaît.", gloss: "I'd like a coffee, please." },
    { level: 'B1', text: "Si j'avais le temps, je lirais davantage.", gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'Malgré le retard, nous sommes arrivés.', gloss: 'Despite the delay, we arrived.' },
    { level: 'C1', text: 'Il aurait dû nous prévenir à temps.', gloss: 'He should have warned us in time.' },
    { level: 'C2', text: "Quoique réticent, il consentit à l'entreprise.", gloss: 'Though reluctant, he consented to the venture.' },
  ],
  es: [
    { level: 'A1', text: 'Me llamo Lucas.', gloss: 'My name is Lucas.' },
    { level: 'A2', text: 'Quisiera un café, por favor.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'Si tuviera tiempo, leería más.', gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'A pesar del retraso, llegamos.', gloss: 'Despite the delay, we arrived.' },
    { level: 'C1', text: 'Debería habernos avisado a tiempo.', gloss: 'He should have warned us in time.' },
    { level: 'C2', text: 'Aun siendo reacio, accedió a la empresa.', gloss: 'Though reluctant, he agreed to the venture.' },
  ],
  de: [
    { level: 'A1', text: 'Ich heiße Lukas.', gloss: 'My name is Lukas.' },
    { level: 'A2', text: 'Ich hätte gern einen Kaffee, bitte.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'Wenn ich Zeit hätte, würde ich mehr lesen.', gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'Trotz der Verspätung sind wir angekommen.', gloss: 'Despite the delay, we arrived.' },
    { level: 'C1', text: 'Er hätte uns rechtzeitig warnen sollen.', gloss: 'He should have warned us in time.' },
    { level: 'C2', text: 'Wenngleich widerwillig, stimmte er dem Vorhaben zu.', gloss: 'Though reluctant, he agreed to the venture.' },
  ],
  pt: [
    { level: 'A1', text: 'Eu me chamo Lucas.', gloss: 'My name is Lucas.' },
    { level: 'A2', text: 'Eu queria um café, por favor.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'Se eu tivesse tempo, leria mais.', gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'Apesar do atraso, chegamos.', gloss: 'Despite the delay, we arrived.' },
    { level: 'C1', text: 'Ele deveria ter nos avisado a tempo.', gloss: 'He should have warned us in time.' },
    { level: 'C2', text: 'Embora relutante, ele consentiu no empreendimento.', gloss: 'Though reluctant, he consented to the venture.' },
  ],
  ko: [
    { level: 'A1', text: '저는 학생이에요.', gloss: 'I am a student.' },
    { level: 'A2', text: '커피 주세요.', gloss: 'Coffee, please.' },
    { level: 'B1', text: '시간이 있으면 책을 더 읽어요.', gloss: 'If I have time, I read more books.' },
    { level: 'B2', text: '늦었음에도 불구하고 우리는 도착했어요.', gloss: 'Despite being late, we arrived.' },
    { level: 'C1', text: '더 일찍 알려줬어야 했어요.', gloss: 'You should have told us sooner.' },
    { level: 'C2', text: '내키지 않았지만 그는 그 계획에 동의했다.', gloss: 'Though reluctant, he agreed to the plan.' },
  ],
  ar: [
    { level: 'A1', text: 'اسمي لوكاس.', gloss: 'My name is Lucas.' },
    { level: 'A2', text: 'أريد قهوة من فضلك.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'لو كان لديّ وقت، لقرأت أكثر.', gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'رغم التأخير، وصلنا.', gloss: 'Despite the delay, we arrived.' },
    { level: 'C1', text: 'كان ينبغي أن يحذّرنا في الوقت المناسب.', gloss: 'He should have warned us in time.' },
    { level: 'C2', text: 'مع أنه كان مترددًا، وافق على المشروع.', gloss: 'Though reluctant, he agreed to the venture.' },
  ],
};

export const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const COMPOSE_LOG: ComposeLogLine[] = [
  { t: 'ctx', text: 'reading granted context …' },
  { t: 'ctx', text: 'found 6 sources · 1,240 signals' },
  { t: 'ok', text: 'interests: distributed systems, jazz, cooking, Bologna' },
  { t: 'plan', text: 'anchoring syllabus to placement → {{LEVEL}}' },
  { t: 'plan', text: 'drafting {{LEVEL}} grammar gates (mastery-locked)' },
  { t: 'ok', text: 'grammar · 9 units · gate: ≥85% recall' },
  { t: 'plan', text: 'curating reading from your domains …' },
  { t: 'ok', text: 'reading · "Sistemi distribuiti, spiegati piano"' },
  { t: 'plan', text: 'synthesizing podcast ep.01 (adaptive, your pace)' },
  { t: 'ok', text: 'listening · 6 min · {{TTS}} voice · jazz cold-open ☕' },
  { t: 'plan', text: 'scripting speaking drills · phoneme targets' },
  { t: 'ok', text: 'speaking · 12 prompts · {{STT}} phoneme scoring' },
  { t: 'plan', text: 'seeding vocabulary memory graph (yours, exportable)' },
  { t: 'ok', text: 'vocab · 48 nodes · spaced-repetition live' },
  { t: 'done', text: 'course composed — sotto voce. buon viaggio.' },
];

export const MODULES: Module[] = [
  { id: 'grammar', name: 'Grammar', meta: '9 units · mastery-gated', glyph: 'gate' },
  { id: 'reading', name: 'Reading', meta: 'in your domains', glyph: 'book' },
  { id: 'listening', name: 'Listening', meta: 'adaptive podcast', glyph: 'wave' },
  { id: 'speaking', name: 'Speaking', meta: 'pronunciation scoring', glyph: 'mic' },
  { id: 'vocab', name: 'Vocab graph', meta: 'yours · exportable', glyph: 'graph' },
];

export const STEPS = ['Begin', 'Connect agent', 'Voice', 'Grant context', 'Placement', 'Compose', 'Ready'] as const;
export type StepName = (typeof STEPS)[number];

export const WHISPERS: string[] = [
  "Every course is a conversation. Let's begin yours.",
  'The best tutor teaches in the language of your work.',
  'A voice you choose — for the listening, and the speaking.',
  "Tell me what you love — we'll learn the language for it.",
  "I'll meet you a half-step beyond where you stand.",
  'Every lesson, shaped to the things you care about.',
  'Piano, piano. Softly, you\'ll be fluent.',
];

export function iconFor(id: string): GlyphName {
  const map: Record<string, GlyphName> = {
    repos: 'repo',
    reading: 'book',
    notes: 'book',
    calendar: 'dot',
    music: 'wave',
    manual: 'spark',
  };
  return map[id] ?? 'dot';
}

export function nextLevel(l: CefrLevel): CefrLevel {
  const i = LEVELS.indexOf(l);
  return LEVELS[Math.min(i + 1, LEVELS.length - 1)];
}

export function lessonTitle(code: string): string {
  const titles: Record<string, string> = {
    it: 'Ordinare al bar, mentre il deploy gira',
    ja: 'デプロイ中に、コーヒーを注文する',
    fr: 'Commander un café pendant le déploiement',
    es: 'Pedir un café mientras corre el deploy',
    de: 'Einen Kaffee bestellen, während das Deployment läuft',
    pt: 'Pedir um café enquanto o deploy roda',
    ko: '배포가 도는 동안 커피 주문하기',
    ar: 'طلب قهوة أثناء تشغيل النشر',
  };
  return titles[code] ?? 'Your first lesson';
}
