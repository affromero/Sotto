/* data.ts — typed static content for the welcome onboarding flow */

export interface Language {
  code: string;
  name: string;
  native: string;
  hi: string;
  names?: Record<string, string>;
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
  apiUrl?: string;
  apiLabel?: string;
  cli?: ProviderCli;
  keyHint?: string;
  kind?: 'url' | 'key';
  hint?: string;
}

export interface VoiceProvider {
  id: string;
  name: string;
  note: string;
  apiUrl?: string;
  apiLabel?: string;
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
  glosses?: Record<string, string>;
}

export interface PlacementLevelGuide {
  title: string;
  comfortable: string[];
  course: string;
}

export interface PlacementLevelCopy {
  estimatedLevel: string;
  beginsNext: string;
  beginsTop: string;
  comfortableWith: string;
  courseFocus: string;
  verifyLater: string;
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

export const PLACEMENT_LEVEL_COPY: Record<string, PlacementLevelCopy> = {
  en: {
    estimatedLevel: 'Estimated level',
    beginsNext: 'Your course begins one rung higher.',
    beginsTop: 'Your course starts at the top rung.',
    comfortableWith: 'This usually means',
    courseFocus: 'Course focus',
    verifyLater: 'Compose now; the adaptive test can verify this later.',
  },
  es: {
    estimatedLevel: 'Nivel estimado',
    beginsNext: 'Tu curso comienza un peldaño más arriba.',
    beginsTop: 'Tu curso empieza en el nivel más alto.',
    comfortableWith: 'Esto suele significar',
    courseFocus: 'Enfoque del curso',
    verifyLater: 'Compón el curso ahora; la prueba adaptativa puede confirmarlo después.',
  },
  fr: {
    estimatedLevel: 'Niveau estimé',
    beginsNext: 'Votre cours commence un échelon plus haut.',
    beginsTop: 'Votre cours commence au niveau le plus élevé.',
    comfortableWith: 'Cela signifie souvent',
    courseFocus: 'Objectif du cours',
    verifyLater: 'Composez le cours maintenant; le test adaptatif pourra le vérifier plus tard.',
  },
  de: {
    estimatedLevel: 'Geschätztes Niveau',
    beginsNext: 'Dein Kurs beginnt eine Stufe höher.',
    beginsTop: 'Dein Kurs beginnt auf der höchsten Stufe.',
    comfortableWith: 'Das bedeutet meistens',
    courseFocus: 'Kursfokus',
    verifyLater: 'Erstelle den Kurs jetzt; der adaptive Test kann es später prüfen.',
  },
  pt: {
    estimatedLevel: 'Nível estimado',
    beginsNext: 'Seu curso começa um nível acima.',
    beginsTop: 'Seu curso começa no nível mais alto.',
    comfortableWith: 'Isso geralmente significa',
    courseFocus: 'Foco do curso',
    verifyLater: 'Monte o curso agora; o teste adaptativo pode confirmar depois.',
  },
  ja: {
    estimatedLevel: '推定レベル',
    beginsNext: 'コースは1段上から始まります。',
    beginsTop: 'コースは最上位の段から始まります。',
    comfortableWith: '通常はこの段階',
    courseFocus: 'コースの焦点',
    verifyLater: '今すぐコースを作成できます。適応型テストで後から確認できます。',
  },
  zh: {
    estimatedLevel: '估计水平',
    beginsNext: '你的课程会从高一级开始。',
    beginsTop: '你的课程会从最高级开始。',
    comfortableWith: '通常意味着',
    courseFocus: '课程重点',
    verifyLater: '现在可以生成课程；自适应测试之后可以确认。',
  },
  ar: {
    estimatedLevel: 'المستوى التقديري',
    beginsNext: 'تبدأ دورتك من درجة أعلى.',
    beginsTop: 'تبدأ دورتك من أعلى درجة.',
    comfortableWith: 'هذا يعني عادةً',
    courseFocus: 'تركيز الدورة',
    verifyLater: 'يمكنك إنشاء الدورة الآن؛ ويمكن للاختبار التكيفي تأكيد ذلك لاحقًا.',
  },
};

export const PLACEMENT_LEVEL_GUIDES: Record<string, Record<CefrLevel, PlacementLevelGuide>> = {
  en: {
    A1: {
      title: 'Brand-new beginner',
      comfortable: ['first greetings', 'names and basic sounds', 'slow guided examples'],
      course: 'Start from zero with pronunciation, core phrases, and clear structure.',
    },
    A2: {
      title: 'Everyday basics',
      comfortable: ['routine situations', 'short practical messages', 'familiar exchanges'],
      course: 'Connected sentences and practical listening.',
    },
    B1: {
      title: 'Independent foundation',
      comfortable: ['main points in clear speech', 'plans and opinions', 'short articles'],
      course: 'Longer scenes, opinions, and supported native material.',
    },
    B2: {
      title: 'Confident independence',
      comfortable: ['complex main ideas', 'abstract discussion', 'tone and intent'],
      course: 'Richer sources, speed, nuance, and accuracy.',
    },
    C1: {
      title: 'Advanced control',
      comfortable: ['long arguments', 'implied meaning', 'register shifts'],
      course: 'Authentic material and precision under pressure.',
    },
    C2: {
      title: 'Near-native range',
      comfortable: ['unscaffolded input', 'idiom and irony', 'style and exact wording'],
      course: 'Polish, speed, and subtlety at the top rung.',
    },
  },
  es: {
    A1: {
      title: 'Principiante desde cero',
      comfortable: ['primeros saludos', 'nombres y sonidos básicos', 'ejemplos lentos y guiados'],
      course: 'Empezar desde cero con pronunciación, frases base y estructura clara.',
    },
    A2: {
      title: 'Bases cotidianas',
      comfortable: [
        'situaciones rutinarias',
        'mensajes prácticos breves',
        'intercambios familiares',
      ],
      course: 'Oraciones conectadas y práctica auditiva útil.',
    },
    B1: {
      title: 'Base independiente',
      comfortable: ['ideas principales en habla clara', 'planes y opiniones', 'artículos breves'],
      course: 'Escenas más largas, opiniones y material nativo con apoyo.',
    },
    B2: {
      title: 'Independencia segura',
      comfortable: ['ideas complejas principales', 'discusión abstracta', 'tono e intención'],
      course: 'Fuentes más ricas, velocidad, matiz y precisión.',
    },
    C1: {
      title: 'Control avanzado',
      comfortable: ['argumentos largos', 'significado implícito', 'cambios de registro'],
      course: 'Material auténtico y precisión bajo presión.',
    },
    C2: {
      title: 'Rango casi nativo',
      comfortable: ['material sin apoyo', 'modismos e ironía', 'estilo y palabra exacta'],
      course: 'Pulido, velocidad y sutileza en el nivel más alto.',
    },
  },
  fr: {
    A1: {
      title: 'Début complet',
      comfortable: ['premières salutations', 'noms et sons de base', 'exemples lents et guidés'],
      course: 'Commencer de zéro avec prononciation, phrases de base et structure claire.',
    },
    A2: {
      title: 'Bases du quotidien',
      comfortable: ['situations routinières', 'messages pratiques courts', 'échanges familiers'],
      course: 'Phrases reliées et écoute pratique.',
    },
    B1: {
      title: 'Base autonome',
      comfortable: ['idées principales claires', 'projets et opinions', 'articles courts'],
      course: 'Scènes plus longues, opinions et documents natifs guidés.',
    },
    B2: {
      title: 'Autonomie solide',
      comfortable: ['idées complexes', 'discussion abstraite', 'ton et intention'],
      course: 'Sources plus riches, vitesse, nuance et précision.',
    },
    C1: {
      title: 'Maîtrise avancée',
      comfortable: ['arguments longs', 'sens implicite', 'changements de registre'],
      course: 'Documents authentiques et précision sous pression.',
    },
    C2: {
      title: 'Étendue quasi native',
      comfortable: ['input sans soutien', 'idiomes et ironie', 'style et mot juste'],
      course: 'Finition, vitesse et subtilité au plus haut niveau.',
    },
  },
  de: {
    A1: {
      title: 'Ganz neu anfangen',
      comfortable: ['erste Begrüßungen', 'Namen und Grundlaute', 'langsame geführte Beispiele'],
      course: 'Von null mit Aussprache, Grundsätzen und klarer Struktur beginnen.',
    },
    A2: {
      title: 'Alltagsgrundlagen',
      comfortable: ['Routinesituationen', 'kurze praktische Nachrichten', 'vertraute Gespräche'],
      course: 'Verbundene Sätze und praktisches Hörtraining.',
    },
    B1: {
      title: 'Selbstständige Basis',
      comfortable: ['Hauptpunkte in klarer Sprache', 'Pläne und Meinungen', 'kurze Artikel'],
      course: 'Längere Szenen, Meinungen und gestütztes authentisches Material.',
    },
    B2: {
      title: 'Sichere Selbstständigkeit',
      comfortable: ['komplexe Hauptideen', 'abstrakte Diskussionen', 'Ton und Absicht'],
      course: 'Reichere Quellen, Tempo, Nuance und Genauigkeit.',
    },
    C1: {
      title: 'Fortgeschrittene Kontrolle',
      comfortable: ['lange Argumente', 'implizite Bedeutung', 'Registerwechsel'],
      course: 'Authentisches Material und Präzision unter Druck.',
    },
    C2: {
      title: 'Fast muttersprachliche Bandbreite',
      comfortable: ['Material ohne Stütze', 'Redewendungen und Ironie', 'Stil und exakte Wortwahl'],
      course: 'Feinschliff, Tempo und Subtilität auf der höchsten Stufe.',
    },
  },
  pt: {
    A1: {
      title: 'Iniciante do zero',
      comfortable: ['primeiras saudações', 'nomes e sons básicos', 'exemplos lentos e guiados'],
      course: 'Começar do zero com pronúncia, frases básicas e estrutura clara.',
    },
    A2: {
      title: 'Bases do cotidiano',
      comfortable: ['situações rotineiras', 'mensagens práticas curtas', 'trocas familiares'],
      course: 'Frases conectadas e escuta prática.',
    },
    B1: {
      title: 'Base independente',
      comfortable: ['pontos principais em fala clara', 'planos e opiniões', 'artigos curtos'],
      course: 'Cenas mais longas, opiniões e material nativo com apoio.',
    },
    B2: {
      title: 'Independência confiante',
      comfortable: ['ideias complexas principais', 'discussão abstrata', 'tom e intenção'],
      course: 'Fontes mais ricas, velocidade, nuance e precisão.',
    },
    C1: {
      title: 'Controle avançado',
      comfortable: ['argumentos longos', 'sentido implícito', 'mudanças de registro'],
      course: 'Material autêntico e precisão sob pressão.',
    },
    C2: {
      title: 'Alcance quase nativo',
      comfortable: ['input sem apoio', 'expressões e ironia', 'estilo e palavra exata'],
      course: 'Polimento, velocidade e sutileza no nível mais alto.',
    },
  },
  ja: {
    A1: {
      title: 'まったくの初心者',
      comfortable: ['最初のあいさつ', '名前と基本音', 'ゆっくりしたガイド付き例'],
      course: '発音、基本フレーズ、明確な構造からゼロから始めます。',
    },
    A2: {
      title: '日常の基礎',
      comfortable: ['決まった場面', '短い実用メッセージ', '身近なやり取り'],
      course: 'つながった文と実用的なリスニング。',
    },
    B1: {
      title: '自立の土台',
      comfortable: ['明瞭な話の要点', '予定と意見', '短い記事'],
      course: '長めの場面、意見、支援付きの生素材。',
    },
    B2: {
      title: '安定した自立',
      comfortable: ['複雑な主旨', '抽象的な議論', '口調と意図'],
      course: 'より豊かな素材、速度、ニュアンス、正確さ。',
    },
    C1: {
      title: '高度な運用力',
      comfortable: ['長い論証', '含意された意味', 'レジスターの変化'],
      course: '生素材と負荷の中での精密さ。',
    },
    C2: {
      title: 'ほぼ母語話者の幅',
      comfortable: ['支援なしの入力', '慣用句と皮肉', '文体と正確な語選び'],
      course: '最上位での磨き込み、速度、繊細さ。',
    },
  },
  zh: {
    A1: {
      title: '从零开始',
      comfortable: ['最初问候', '姓名和基础发音', '缓慢引导示例'],
      course: '从发音、核心短语和清晰结构开始。',
    },
    A2: {
      title: '日常基础',
      comfortable: ['常规场景', '简短实用信息', '熟悉交流'],
      course: '连贯句子和实用听力。',
    },
    B1: {
      title: '独立基础',
      comfortable: ['清晰话语的要点', '计划和观点', '短文章'],
      course: '更长场景、观点表达和有支架的真实材料。',
    },
    B2: {
      title: '稳定独立',
      comfortable: ['复杂主旨', '抽象讨论', '语气和意图'],
      course: '更丰富的材料、速度、细微差别和准确度。',
    },
    C1: {
      title: '高级掌控',
      comfortable: ['长篇论证', '隐含意义', '语域转换'],
      course: '真实材料和压力下的精确表达。',
    },
    C2: {
      title: '接近母语范围',
      comfortable: ['无支架输入', '习语和反讽', '风格和精确用词'],
      course: '最高级的打磨、速度和微妙度。',
    },
  },
  ar: {
    A1: {
      title: 'مبتدئ من الصفر',
      comfortable: ['التحيات الأولى', 'الأسماء والأصوات الأساسية', 'أمثلة بطيئة وموجهة'],
      course: 'البدء من الصفر بالنطق والعبارات الأساسية والبنية الواضحة.',
    },
    A2: {
      title: 'أساسيات يومية',
      comfortable: ['مواقف روتينية', 'رسائل عملية قصيرة', 'تبادلات مألوفة'],
      course: 'جمل مترابطة وتدريب استماع عملي.',
    },
    B1: {
      title: 'أساس مستقل',
      comfortable: ['النقاط الرئيسية في كلام واضح', 'الخطط والآراء', 'مقالات قصيرة'],
      course: 'مشاهد أطول وآراء ومواد أصلية مدعومة.',
    },
    B2: {
      title: 'استقلال واثق',
      comfortable: ['أفكار معقدة رئيسية', 'نقاش مجرد', 'النبرة والقصد'],
      course: 'مصادر أغنى وسرعة وفروق دقيقة ودقة.',
    },
    C1: {
      title: 'تحكم متقدم',
      comfortable: ['حجج طويلة', 'معنى ضمني', 'تبدل السجل اللغوي'],
      course: 'مواد أصلية ودقة تحت الضغط.',
    },
    C2: {
      title: 'مدى شبه أصلي',
      comfortable: ['مدخلات بلا دعم', 'تعابير وسخرية', 'أسلوب واختيار دقيق للكلمات'],
      course: 'صقل وسرعة ودقة في أعلى مستوى.',
    },
  },
};

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
  | 'upload'
  | 'x'
  | 'repo'
  | 'lock'
  | 'shield'
  | 'dot';

export const LANGUAGES: Language[] = [
  {
    code: 'en',
    name: 'English',
    native: 'English',
    hi: 'hello',
    names: {
      en: 'English',
      es: 'Inglés',
      fr: 'Anglais',
      de: 'Englisch',
      pt: 'Inglês',
      ja: '英語',
      zh: '英语',
      ar: 'الإنجليزية',
    },
  },
  {
    code: 'it',
    name: 'Italian',
    native: 'Italiano',
    hi: 'ciao',
    names: {
      en: 'Italian',
      es: 'Italiano',
      fr: 'Italien',
      de: 'Italienisch',
      pt: 'Italiano',
      ja: 'イタリア語',
      zh: '意大利语',
      ar: 'الإيطالية',
    },
  },
  {
    code: 'ja',
    name: 'Japanese',
    native: '日本語',
    hi: 'こんにちは',
    names: {
      en: 'Japanese',
      es: 'Japonés',
      fr: 'Japonais',
      de: 'Japanisch',
      pt: 'Japonês',
      ja: '日本語',
      zh: '日语',
      ar: 'اليابانية',
    },
  },
  {
    code: 'fr',
    name: 'French',
    native: 'Français',
    hi: 'bonjour',
    names: {
      en: 'French',
      es: 'Francés',
      fr: 'Français',
      de: 'Französisch',
      pt: 'Francês',
      ja: 'フランス語',
      zh: '法语',
      ar: 'الفرنسية',
    },
  },
  {
    code: 'es',
    name: 'Spanish',
    native: 'Español',
    hi: 'hola',
    names: {
      en: 'Spanish',
      es: 'Español',
      fr: 'Espagnol',
      de: 'Spanisch',
      pt: 'Espanhol',
      ja: 'スペイン語',
      zh: '西班牙语',
      ar: 'الإسبانية',
    },
  },
  {
    code: 'de',
    name: 'German',
    native: 'Deutsch',
    hi: 'hallo',
    names: {
      en: 'German',
      es: 'Alemán',
      fr: 'Allemand',
      de: 'Deutsch',
      pt: 'Alemão',
      ja: 'ドイツ語',
      zh: '德语',
      ar: 'الألمانية',
    },
  },
  {
    code: 'pt',
    name: 'Portuguese',
    native: 'Português',
    hi: 'olá',
    names: {
      en: 'Portuguese',
      es: 'Portugués',
      fr: 'Portugais',
      de: 'Portugiesisch',
      pt: 'Português',
      ja: 'ポルトガル語',
      zh: '葡萄牙语',
      ar: 'البرتغالية',
    },
  },
  {
    code: 'ko',
    name: 'Korean',
    native: '한국어',
    hi: '안녕',
    names: {
      en: 'Korean',
      es: 'Coreano',
      fr: 'Coréen',
      de: 'Koreanisch',
      pt: 'Coreano',
      ja: '韓国語',
      zh: '韩语',
      ar: 'الكورية',
    },
  },
  {
    code: 'ar',
    name: 'Arabic',
    native: 'العربية',
    hi: 'مرحبا',
    names: {
      en: 'Arabic',
      es: 'Árabe',
      fr: 'Arabe',
      de: 'Arabisch',
      pt: 'Árabe',
      ja: 'アラビア語',
      zh: '阿拉伯语',
      ar: 'العربية',
    },
  },
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
    apiUrl: 'https://platform.claude.com/',
    apiLabel: 'API',
    cli: { label: 'Claude Code', bin: 'claude', ver: '1.2.4', path: '/usr/local/bin/claude' },
    keyHint: 'sk-ant-…',
  },
  {
    id: 'codex',
    name: 'Codex',
    meta: 'OpenAI · CLI or API',
    icon: 'plug',
    apiUrl: 'https://platform.openai.com/api-keys',
    apiLabel: 'API',
    cli: { label: 'Codex CLI', bin: 'codex', ver: '0.9.1', path: '/opt/homebrew/bin/codex' },
    keyHint: 'sk-…',
  },
  {
    id: 'local',
    name: 'Local',
    meta: 'Ollama · llama.cpp · LM Studio',
    icon: 'link',
    apiUrl: 'https://ollama.com/',
    apiLabel: 'Docs',
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
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    note: 'expressive multilingual voices',
    apiUrl: 'https://elevenlabs.io/app/settings/api-keys',
    apiLabel: 'API',
    keyHint: 'xi-api-key…',
  },
  {
    id: 'hume',
    name: 'Hume',
    note: 'emotionally-aware prosody',
    apiUrl: 'https://dev.hume.ai/docs/introduction/api-key',
    apiLabel: 'API',
    keyHint: 'hume_…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    note: 'natural, low cost',
    apiUrl: 'https://platform.openai.com/api-keys',
    apiLabel: 'API',
    keyHint: 'sk-…',
  },
  {
    id: 'cartesia',
    name: 'Cartesia',
    note: 'low-latency Sonic voices',
    apiUrl: 'https://play.cartesia.ai/keys',
    apiLabel: 'API',
    keyHint: 'sk_car_…',
  },
  {
    id: 'kokoro',
    name: 'Kokoro',
    note: 'runs on-device',
    apiUrl: 'https://github.com/hexgrad/kokoro',
    apiLabel: 'Docs',
    local: true,
  },
  {
    id: 'local',
    name: 'Local sidecar',
    note: 'any Sotto-compatible TTS server',
    apiUrl: '/docs/06-provider-extension-guide.md',
    apiLabel: 'Docs',
    local: true,
  },
];

export const STT_PROVIDERS: VoiceProvider[] = [
  {
    id: 'whisper',
    name: 'Whisper',
    note: 'on-device, private',
    apiUrl: 'https://github.com/openai/whisper',
    apiLabel: 'Docs',
    local: true,
  },
  {
    id: 'local',
    name: 'Local sidecar',
    note: 'any Sotto-compatible STT server',
    apiUrl: '/docs/06-provider-extension-guide.md',
    apiLabel: 'Docs',
    local: true,
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    note: 'word-level timing',
    apiUrl: 'https://developers.deepgram.com/docs/create-additional-api-keys',
    apiLabel: 'API',
    keyHint: 'dg_…',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs Scribe',
    note: 'high accuracy',
    apiUrl: 'https://elevenlabs.io/app/settings/api-keys',
    apiLabel: 'API',
    keyHint: 'xi-api-key…',
  },
  {
    id: 'assembly',
    name: 'AssemblyAI',
    note: 'phoneme-level scoring',
    apiUrl: 'https://www.assemblyai.com/dashboard/signup',
    apiLabel: 'API',
    keyHint: 'aai_…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    note: 'gpt-4o transcribe',
    apiUrl: 'https://platform.openai.com/api-keys',
    apiLabel: 'API',
    keyHint: 'sk-…',
  },
];

export const SOURCES: Source[] = [
  {
    id: 'repos',
    label: 'Code & repos',
    meta: 'project terms and docs',
    sample: 'pull requests, READMEs, deploy notes',
  },
  {
    id: 'reading',
    label: 'Reading list',
    meta: 'articles and saved links',
    sample: 'papers on distributed systems, sci-fi',
  },
  {
    id: 'notes',
    label: 'Notes & docs',
    meta: 'personal notes and drafts',
    sample: 'design docs, daily journal',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    meta: 'events and routines',
    sample: 'standups, a trip to Bologna in May',
  },
  {
    id: 'music',
    label: 'Listening history',
    meta: 'audio interests',
    sample: 'jazz, lo-fi, Italian lessons',
  },
  {
    id: 'manual',
    label: 'Topics, by hand',
    meta: 'manual interests',
    sample: 'cooking, climbing, opera',
  },
];

export const PLACEMENT_BY_LANG: Record<string, PlacementSentence[]> = {
  en: [
    {
      level: 'A1',
      text: 'My name is Luca.',
      gloss: 'Introducing yourself.',
      glosses: {
        es: 'Me llamo Luca.',
        fr: "Je m'appelle Luca.",
        de: 'Ich heiße Luca.',
        pt: 'Eu me chamo Luca.',
        ja: '私の名前はルカです。',
        zh: '我叫卢卡。',
        ar: 'اسمي لوكا.',
        en: 'Introducing yourself.',
      },
    },
    {
      level: 'A2',
      text: "I'd like a coffee, please.",
      gloss: 'Ordering politely.',
      glosses: {
        es: 'Quisiera un café, por favor.',
        fr: "Je voudrais un café, s'il vous plaît.",
        de: 'Ich hätte gern einen Kaffee, bitte.',
        pt: 'Eu queria um café, por favor.',
        ja: 'コーヒーをください。',
        zh: '请给我一杯咖啡。',
        ar: 'أريد قهوة من فضلك.',
        en: 'Ordering politely.',
      },
    },
    {
      level: 'B1',
      text: "If I had time, I'd read more.",
      gloss: 'The conditional mood.',
      glosses: {
        es: 'Si tuviera tiempo, leería más.',
        fr: "Si j'avais le temps, je lirais davantage.",
        de: 'Wenn ich Zeit hätte, würde ich mehr lesen.',
        pt: 'Se eu tivesse tempo, leria mais.',
        ja: '時間があれば、もっと本を読みます。',
        zh: '如果有时间，我会多读书。',
        ar: 'لو كان لديّ وقت، لقرأت أكثر.',
        en: 'The conditional mood.',
      },
    },
    {
      level: 'B2',
      text: 'Despite the delay, we arrived.',
      gloss: "Concession with 'despite'.",
      glosses: {
        es: 'A pesar del retraso, llegamos.',
        fr: 'Malgré le retard, nous sommes arrivés.',
        de: 'Trotz der Verspätung sind wir angekommen.',
        pt: 'Apesar do atraso, chegamos.',
        ja: '遅れたにもかかわらず、到着しました。',
        zh: '尽管延误了，我们还是到了。',
        ar: 'رغم التأخير، وصلنا.',
        en: "Concession with 'despite'.",
      },
    },
    {
      level: 'C1',
      text: 'He should have warned us in time.',
      gloss: 'Past modal regret.',
      glosses: {
        es: 'Debería habernos avisado a tiempo.',
        fr: 'Il aurait dû nous prévenir à temps.',
        de: 'Er hätte uns rechtzeitig warnen sollen.',
        pt: 'Ele deveria ter nos avisado a tempo.',
        ja: '彼は時間どおりに知らせるべきだった。',
        zh: '他本应及时提醒我们。',
        ar: 'كان عليه أن يحذّرنا في الوقت المناسب.',
        en: 'Past modal regret.',
      },
    },
    {
      level: 'C2',
      text: 'Though reluctant, he consented to the venture.',
      gloss: 'Formal register, fronted concession.',
      glosses: {
        es: 'Aunque reacio, accedió a la empresa.',
        fr: "Quoique réticent, il consentit à l'entreprise.",
        de: 'Wenngleich widerwillig, stimmte er dem Vorhaben zu.',
        pt: 'Embora relutante, ele consentiu no empreendimento.',
        ja: '気が進まないながらも、彼はその事業に同意した。',
        zh: '尽管不情愿，他还是同意了这项事业。',
        ar: 'مع أنه كان مترددًا، وافق على المشروع.',
        en: 'Formal register, fronted concession.',
      },
    },
  ],
  it: [
    { level: 'A1', text: 'Mi chiamo Luca.', gloss: 'My name is Luca.' },
    { level: 'A2', text: 'Vorrei un caffè, per favore.', gloss: "I'd like a coffee, please." },
    {
      level: 'B1',
      text: 'Se avessi tempo, leggerei di più.',
      gloss: "If I had time, I'd read more.",
    },
    {
      level: 'B2',
      text: 'Nonostante il ritardo, siamo arrivati.',
      gloss: 'Despite the delay, we arrived.',
    },
    {
      level: 'C1',
      text: 'Avrebbe dovuto avvisarci per tempo.',
      gloss: 'He should have warned us in time.',
    },
    {
      level: 'C2',
      text: "Pur essendo restio, acconsentì all'impresa.",
      gloss: 'Though reluctant, he consented to the venture.',
    },
  ],
  ja: [
    { level: 'A1', text: '私は学生です。', gloss: 'I am a student.' },
    { level: 'A2', text: 'コーヒーをください。', gloss: 'Coffee, please.' },
    {
      level: 'B1',
      text: '時間があれば、もっと本を読みます。',
      gloss: 'If I have time, I read more.',
    },
    {
      level: 'B2',
      text: '遅れたにもかかわらず、間に合いました。',
      gloss: 'Despite being late, we made it.',
    },
    {
      level: 'C1',
      text: 'もっと早く知らせてくれればよかったのに。',
      gloss: 'You should have told me sooner.',
    },
    {
      level: 'C2',
      text: '気が進まないながらも、彼はその計画に同意した。',
      gloss: 'Reluctant though he was, he agreed to the plan.',
    },
  ],
  fr: [
    { level: 'A1', text: "Je m'appelle Luc.", gloss: 'My name is Luc.' },
    {
      level: 'A2',
      text: "Je voudrais un café, s'il vous plaît.",
      gloss: "I'd like a coffee, please.",
    },
    {
      level: 'B1',
      text: "Si j'avais le temps, je lirais davantage.",
      gloss: "If I had time, I'd read more.",
    },
    {
      level: 'B2',
      text: 'Malgré le retard, nous sommes arrivés.',
      gloss: 'Despite the delay, we arrived.',
    },
    {
      level: 'C1',
      text: 'Il aurait dû nous prévenir à temps.',
      gloss: 'He should have warned us in time.',
    },
    {
      level: 'C2',
      text: "Quoique réticent, il consentit à l'entreprise.",
      gloss: 'Though reluctant, he consented to the venture.',
    },
  ],
  es: [
    { level: 'A1', text: 'Me llamo Lucas.', gloss: 'My name is Lucas.' },
    { level: 'A2', text: 'Quisiera un café, por favor.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'Si tuviera tiempo, leería más.', gloss: "If I had time, I'd read more." },
    {
      level: 'B2',
      text: 'A pesar del retraso, llegamos.',
      gloss: 'Despite the delay, we arrived.',
    },
    {
      level: 'C1',
      text: 'Debería habernos avisado a tiempo.',
      gloss: 'He should have warned us in time.',
    },
    {
      level: 'C2',
      text: 'Aun siendo reacio, accedió a la empresa.',
      gloss: 'Though reluctant, he agreed to the venture.',
    },
  ],
  de: [
    { level: 'A1', text: 'Ich heiße Lukas.', gloss: 'My name is Lukas.' },
    {
      level: 'A2',
      text: 'Ich hätte gern einen Kaffee, bitte.',
      gloss: "I'd like a coffee, please.",
    },
    {
      level: 'B1',
      text: 'Wenn ich Zeit hätte, würde ich mehr lesen.',
      gloss: "If I had time, I'd read more.",
    },
    {
      level: 'B2',
      text: 'Trotz der Verspätung sind wir angekommen.',
      gloss: 'Despite the delay, we arrived.',
    },
    {
      level: 'C1',
      text: 'Er hätte uns rechtzeitig warnen sollen.',
      gloss: 'He should have warned us in time.',
    },
    {
      level: 'C2',
      text: 'Wenngleich widerwillig, stimmte er dem Vorhaben zu.',
      gloss: 'Though reluctant, he agreed to the venture.',
    },
  ],
  pt: [
    { level: 'A1', text: 'Eu me chamo Lucas.', gloss: 'My name is Lucas.' },
    { level: 'A2', text: 'Eu queria um café, por favor.', gloss: "I'd like a coffee, please." },
    {
      level: 'B1',
      text: 'Se eu tivesse tempo, leria mais.',
      gloss: "If I had time, I'd read more.",
    },
    { level: 'B2', text: 'Apesar do atraso, chegamos.', gloss: 'Despite the delay, we arrived.' },
    {
      level: 'C1',
      text: 'Ele deveria ter nos avisado a tempo.',
      gloss: 'He should have warned us in time.',
    },
    {
      level: 'C2',
      text: 'Embora relutante, ele consentiu no empreendimento.',
      gloss: 'Though reluctant, he consented to the venture.',
    },
  ],
  ko: [
    { level: 'A1', text: '저는 학생이에요.', gloss: 'I am a student.' },
    { level: 'A2', text: '커피 주세요.', gloss: 'Coffee, please.' },
    {
      level: 'B1',
      text: '시간이 있으면 책을 더 읽어요.',
      gloss: 'If I have time, I read more books.',
    },
    {
      level: 'B2',
      text: '늦었음에도 불구하고 우리는 도착했어요.',
      gloss: 'Despite being late, we arrived.',
    },
    { level: 'C1', text: '더 일찍 알려줬어야 했어요.', gloss: 'You should have told us sooner.' },
    {
      level: 'C2',
      text: '내키지 않았지만 그는 그 계획에 동의했다.',
      gloss: 'Though reluctant, he agreed to the plan.',
    },
  ],
  ar: [
    { level: 'A1', text: 'اسمي لوكاس.', gloss: 'My name is Lucas.' },
    { level: 'A2', text: 'أريد قهوة من فضلك.', gloss: "I'd like a coffee, please." },
    { level: 'B1', text: 'لو كان لديّ وقت، لقرأت أكثر.', gloss: "If I had time, I'd read more." },
    { level: 'B2', text: 'رغم التأخير، وصلنا.', gloss: 'Despite the delay, we arrived.' },
    {
      level: 'C1',
      text: 'كان ينبغي أن يحذّرنا في الوقت المناسب.',
      gloss: 'He should have warned us in time.',
    },
    {
      level: 'C2',
      text: 'مع أنه كان مترددًا، وافق على المشروع.',
      gloss: 'Though reluctant, he agreed to the venture.',
    },
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
  { t: 'ok', text: 'reading · "Distributed systems, explained clearly"' },
  { t: 'plan', text: 'synthesizing listening lesson 01 (adaptive, your pace)' },
  { t: 'ok', text: 'listening · 6 min · {{TTS}} voice · jazz cold-open ☕' },
  { t: 'plan', text: 'scripting speaking drills · phoneme targets' },
  { t: 'ok', text: 'speaking · 12 prompts · {{STT}} phoneme scoring' },
  { t: 'plan', text: 'seeding vocabulary memory graph (yours, exportable)' },
  { t: 'ok', text: 'vocab · 48 nodes · spaced-repetition live' },
  { t: 'done', text: 'course composed - ready for the first lesson.' },
];

export const MODULES: Module[] = [
  { id: 'grammar', name: 'Grammar', meta: '9 units · mastery-gated', glyph: 'gate' },
  { id: 'reading', name: 'Reading', meta: 'in your domains', glyph: 'book' },
  { id: 'listening', name: 'Listening', meta: 'adaptive audio lesson', glyph: 'wave' },
  { id: 'speaking', name: 'Speaking', meta: 'pronunciation scoring', glyph: 'mic' },
  { id: 'vocab', name: 'Vocab graph', meta: 'yours · exportable', glyph: 'graph' },
];

export const STEPS = [
  'Begin',
  'Connect agent',
  'Voice',
  'Grant context',
  'Placement',
  'Compose',
  'Ready',
] as const;
export type StepName = (typeof STEPS)[number];

export const WHISPERS: string[] = [
  "Every course is a conversation. Let's begin yours.",
  'The best tutor teaches in the language of your work.',
  'A voice you choose — for the listening, and the speaking.',
  "Tell me what you love — we'll learn the language for it.",
  "I'll meet you a half-step beyond where you stand.",
  'Every lesson, shaped to the things you care about.',
  "Step by step, you'll build fluency.",
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
    en: 'Order a coffee while the deploy runs',
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
