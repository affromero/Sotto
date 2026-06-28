'use client';

import {
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import type { GlyphName } from '@/components/Glyph';
import { Glyph } from '../Glyph';
import type { ContextItem, ContextItemKind } from '../WelcomeFlow';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  contextItems: ContextItem[];
  setContextItems: Dispatch<SetStateAction<ContextItem[]>>;
  demoMode: boolean;
  onNext: () => void;
  onBack: () => void;
}

const MAX_FILE_CHARS = 1800;
const TEXT_FILE_EXTENSIONS = new Set([
  'csv',
  'html',
  'json',
  'log',
  'markdown',
  'md',
  'mdx',
  'rtf',
  'text',
  'tsv',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

type MaterialEntryKind = 'link' | 'book' | 'article' | 'music' | 'topic';

const MATERIAL_TYPES: Array<{
  id: MaterialEntryKind;
  label: string;
  hint: string;
  placeholder: string;
  icon: GlyphName;
}> = [
  {
    id: 'link',
    label: 'Web links',
    hint: 'one URL per line: articles, papers, videos, docs',
    placeholder: 'https://example.com/paper\nhttps://youtube.com/watch?v=...',
    icon: 'link',
  },
  {
    id: 'book',
    label: 'Books',
    hint: 'titles, authors, chapters, or pasted excerpts',
    placeholder: 'Invisible Cities by Italo Calvino\nThe Design of Everyday Things',
    icon: 'book',
  },
  {
    id: 'article',
    label: 'Articles & news',
    hint: 'publication names, article URLs, or newsletter topics',
    placeholder: 'The Economist: a story about public transit\nhttps://nytimes.com/...',
    icon: 'globe',
  },
  {
    id: 'music',
    label: 'Music & audio',
    hint: 'songs, artists, podcasts, speeches, interviews',
    placeholder: 'Caetano Veloso - Tigresa\nRadio Ambulante episodes about travel',
    icon: 'volume',
  },
  {
    id: 'topic',
    label: 'Topics',
    hint: 'work, hobbies, places, goals, people, situations',
    placeholder: 'Bolognese food markets\nDistributed systems at work\nOpera history',
    icon: 'spark',
  },
];

const CONTEXT_PROMPTS = [
  'Class notes, a syllabus, or the chapter you are studying now',
  'A paragraph you can partly read, plus words you keep missing',
  'Work, travel, family, school, or tutoring situations you want to rehearse',
  'Homework instructions, teacher feedback, or prompts for the next class',
  'Articles, videos, podcasts, songs, or books you actually want in lessons',
];

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isLikelyUrl(value: string) {
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) return false;
  try {
    const url = new URL(normalizeUrl(trimmed));
    return url.hostname.includes('.');
  } catch {
    return false;
  }
}

function labelForLink(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

function compactLabel(value: string) {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > 58 ? `${oneLine.slice(0, 55).trim()}...` : oneLine;
}

function labelForMaterial(kind: MaterialEntryKind, value: string) {
  if (kind === 'link') return isLikelyUrl(value) ? labelForLink(normalizeUrl(value)) : 'Web link';
  if (kind === 'article') {
    return isLikelyUrl(value) ? labelForLink(normalizeUrl(value)) : compactLabel(value);
  }
  return compactLabel(value);
}

function valueForMaterial(kind: MaterialEntryKind, value: string) {
  if ((kind === 'link' || kind === 'article') && isLikelyUrl(value)) {
    return normalizeUrl(value);
  }
  return value;
}

function displayKind(kind: ContextItemKind) {
  if (kind === 'article') return 'article/news';
  if (kind === 'music') return 'music/audio';
  if (kind === 'text') return 'note';
  return kind;
}

function preview(value: string) {
  return value.length > 140 ? `${value.slice(0, 137).trim()}...` : value;
}

function isTextFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type.startsWith('text/') || TEXT_FILE_EXTENSIONS.has(ext);
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}

async function contextItemFromFile(file: File): Promise<Omit<ContextItem, 'id'>> {
  if (!isTextFile(file)) {
    return {
      kind: 'file',
      label: file.name,
      value: `Uploaded file reference: ${file.name}`,
    };
  }

  const raw = (await readFileText(file)).trim();
  const clipped = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS).trim() : raw;
  const suffix = raw.length > MAX_FILE_CHARS ? '\n[Trimmed to the first 1800 characters.]' : '';

  return {
    kind: 'file',
    label: file.name,
    value: clipped
      ? `File: ${file.name}\n${clipped}${suffix}`
      : `Uploaded empty file: ${file.name}`,
  };
}

export function StepContext({ contextItems, setContextItems, demoMode, onNext, onBack }: Props) {
  const directCount = contextItems.length;
  const totalContext = directCount;
  const [entryKind, setEntryKind] = useState<MaterialEntryKind>('link');
  const [entry, setEntry] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedMaterial =
    MATERIAL_TYPES.find((type) => type.id === entryKind) ?? MATERIAL_TYPES[0];

  function addContextItems(items: Array<Omit<ContextItem, 'id'>>) {
    if (!items.length) return;

    const stamp = Date.now();
    setContextItems((prev) => [
      ...prev,
      ...items.map((item, index) => ({
        ...item,
        id: `ctx-${item.kind}-${stamp}-${prev.length + index}`,
      })),
    ]);
  }

  function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = entry.trim();
    if (!trimmed) return;

    const directItems: Array<Omit<ContextItem, 'id'>> = trimmed
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const value = valueForMaterial(entryKind, line);
        return { kind: entryKind, label: labelForMaterial(entryKind, line), value };
      });

    addContextItems(directItems);
    setEntry('');
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    setUploading(true);
    setFileError(null);
    try {
      const results = await Promise.allSettled(files.map(contextItemFromFile));
      const items = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      const failed = results.length - items.length;
      addContextItems(items);
      if (failed > 0) {
        setFileError(
          `Added ${items.length} file${items.length === 1 ? '' : 's'}; ${failed} could not be read.`
        );
      }
    } catch {
      setFileError('Could not read those files.');
    } finally {
      setUploading(false);
      input.value = '';
    }
  }

  function removeContextItem(id: string) {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>05 ·</span> Grant context
      </div>
      <h1 className={t.title}>
        Teach it <em>what you care about</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'Add at least one concrete source or topic. In the hosted demo, added material stays in the browser so you can see how a course gets shaped without connecting anything.'
          : 'Add at least one concrete source or topic. Specific notes, links, titles, excerpts, and situations give Sotto better examples, vocabulary, and lesson topics.'}
      </p>

      <section className={c.contextDirect} aria-labelledby="direct-context-title">
        <div className={c.contextDirectHead}>
          <div>
            <div id="direct-context-title" className={c.contextDirectLabel}>
              Course material
            </div>
            <p className={c.contextDirectCopy}>
              Start with one exact thing: a class note, a syllabus line, an article URL, a book, a
              song, a paragraph, homework feedback, or a situation you want to handle in the target
              language.
            </p>
          </div>
          <span className={c.contextDirectCount}>
            {directCount > 0 ? `${directCount} added` : 'Required'}
          </span>
        </div>

        <div className={c.contextGuide} aria-label="Good context examples">
          <span className={c.contextGuideLabel}>Good inputs</span>
          <ul className={c.contextGuideList}>
            {CONTEXT_PROMPTS.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
        </div>

        <div className={c.materialTypeGroup} role="radiogroup" aria-label="Material type">
          {MATERIAL_TYPES.map((type) => {
            const selected = entryKind === type.id;
            return (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`${c.materialType} ${selected ? c.materialTypeOn : ''}`}
                onClick={() => setEntryKind(type.id)}
              >
                <span className={c.materialTypeIcon} aria-hidden="true">
                  <Glyph name={type.icon} size={16} />
                </span>
                <span className={c.materialTypeText}>
                  <span className={c.materialTypeLabel}>{type.label}</span>
                  <span className={c.materialTypeHint}>{type.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        <form className={c.contextEntry} onSubmit={submitEntry}>
          <label className={c.contextTextLabel} htmlFor="context-entry">
            Material details
          </label>
          <div className={c.contextSelectedHint}>{selectedMaterial.hint}</div>
          <div className={c.contextEntryGrid}>
            <span className={c.contextBarIcon} aria-hidden="true">
              <Glyph name={selectedMaterial.icon} size={18} />
            </span>
            <textarea
              id="context-entry"
              className={c.contextInput}
              value={entry}
              onChange={(event) => setEntry(event.currentTarget.value)}
              placeholder={selectedMaterial.placeholder}
              rows={3}
            />
            <button className={c.contextAdd} type="submit" disabled={!entry.trim()}>
              Add material
            </button>
          </div>
        </form>

        <div className={c.contextUploadRow}>
          <button
            className={c.contextUpload}
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Upload context files"
            title="Upload context files"
          >
            <Glyph name="upload" size={17} />
            {uploading ? 'Reading files' : 'Upload files'}
          </button>
          <span className={c.contextUploadHint}>
            Text files are read locally; other files are kept as named references.
          </span>
        </div>

        <input
          ref={fileInputRef}
          className={c.fileInput}
          type="file"
          multiple
          accept=".csv,.html,.json,.log,.markdown,.md,.mdx,.rtf,.text,.tsv,.txt,.xml,.yaml,.yml,text/*"
          onChange={handleFileChange}
          aria-label="Choose context files"
        />
      </section>

      {contextItems.length > 0 ? (
        <div className={c.contextItems} aria-label="Added context">
          {contextItems.map((item) => (
            <div key={item.id} className={c.contextItem}>
              <span className={c.contextKind}>{displayKind(item.kind)}</span>
              <div className={c.contextItemText}>
                <span className={c.contextItemLabel}>{item.label}</span>
                <span className={c.contextItemPreview}>{preview(item.value)}</span>
              </div>
              <button
                type="button"
                className={c.contextRemove}
                onClick={() => removeContextItem(item.id)}
                aria-label={`Remove ${item.label}`}
              >
                <Glyph name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {fileError ? <div className={c.contextNotice}>{fileError}</div> : null}

      <div className={c.ctxTally}>
        {totalContext === 0 ? (
          'One context item is required. If you are unsure, add the textbook chapter, a URL, a homework prompt, or three situations you want to rehearse.'
        ) : (
          <>
            Sotto will weave your course from{' '}
            <b>
              {totalContext} context signal{totalContext > 1 ? 's' : ''}
            </b>
            .
          </>
        )}
      </div>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button
          className={`${t.btn} ${t.btnPrimary}`}
          disabled={totalContext === 0}
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
