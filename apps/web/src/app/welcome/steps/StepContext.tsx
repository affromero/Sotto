'use client';

import {
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { SOURCES, iconFor } from '../data';
import { Glyph } from '../Glyph';
import type { ContextItem } from '../WelcomeFlow';
import t from '../theme.module.css';
import c from '../components.module.css';

interface Props {
  sources: Set<string>;
  toggle: (id: string) => void;
  contextItems: ContextItem[];
  setContextItems: Dispatch<SetStateAction<ContextItem[]>>;
  demoMode: boolean;
  onNext: () => void;
  onBack: () => void;
}

const MAX_FILE_CHARS = 1800;
const MAX_FILES_PER_PICK = 5;
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
    value: clipped ? `File: ${file.name}\n${clipped}${suffix}` : `Uploaded empty file: ${file.name}`,
  };
}

export function StepContext({
  sources,
  toggle,
  contextItems,
  setContextItems,
  demoMode,
  onNext,
  onBack,
}: Props) {
  const n = sources.size;
  const directCount = contextItems.length;
  const totalContext = n + directCount;
  const [entry, setEntry] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    if (isLikelyUrl(trimmed)) {
      const value = normalizeUrl(trimmed);
      addContextItems([{ kind: 'link', label: labelForLink(value), value }]);
    } else {
      addContextItems([{ kind: 'text', label: 'Note', value: trimmed }]);
    }
    setEntry('');
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    setUploading(true);
    setFileError(null);
    try {
      const selected = files.slice(0, MAX_FILES_PER_PICK);
      const items = await Promise.all(selected.map(contextItemFromFile));
      addContextItems(items);
      if (files.length > MAX_FILES_PER_PICK) {
        setFileError(`Added the first ${MAX_FILES_PER_PICK} files.`);
      }
    } catch {
      setFileError('Could not read that file.');
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
        <span className={t.eyebrowIdx}>03 ·</span> Grant context
      </div>
      <h1 className={t.title}>
        Teach it <em>what you care about</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'This is the part that makes Sotto yours. In the hosted demo, these are mock context signals so you can see how a course gets shaped without connecting anything.'
          : 'This is the part that makes Sotto yours. Choose what the agent may read — it draws every lesson, reading, and audio lesson from the context you share. Nothing leaves your machine.'}
      </p>

      <form className={c.contextBar} onSubmit={submitEntry}>
        <span className={c.contextBarIcon} aria-hidden="true">
          <Glyph name="link" size={18} />
        </span>
        <input
          className={c.contextInput}
          value={entry}
          onChange={(event) => setEntry(event.currentTarget.value)}
          aria-label="Add a link, note, or topic"
          placeholder="Paste a link, note, or topic"
        />
        <button className={c.contextAdd} type="submit" disabled={!entry.trim()}>
          Add
        </button>
        <button
          className={c.contextUpload}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Upload context file"
          title="Upload context file"
        >
          <Glyph name="upload" size={17} />
          {uploading ? 'Reading' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          className={c.fileInput}
          type="file"
          multiple
          accept=".csv,.html,.json,.log,.markdown,.md,.mdx,.rtf,.text,.tsv,.txt,.xml,.yaml,.yml,text/*"
          onChange={handleFileChange}
          aria-label="Choose context files"
        />
      </form>

      {contextItems.length > 0 ? (
        <div className={c.contextItems} aria-label="Added context">
          {contextItems.map((item) => (
            <div key={item.id} className={c.contextItem}>
              <span className={c.contextKind}>{item.kind}</span>
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

      <div className={c.sourceList}>
        {SOURCES.map((s) => {
          const on = sources.has(s.id);
          return (
            <button
              key={s.id}
              className={`${c.sourceRow} ${on ? c.sourceRowOn : ''}`}
              onClick={() => toggle(s.id)}
              role="switch"
              aria-checked={on}
              aria-label={`${s.label}: ${s.meta}`}
            >
              <span className={c.sico}>
                <Glyph name={iconFor(s.id)} size={20} />
              </span>
              <div>
                <div className={c.stop}>
                  <span className={c.slabel}>{s.label}</span>
                  <span className={c.smeta}>{s.meta}</span>
                </div>
                <div className={c.ssample}>e.g. {s.sample}</div>
              </div>
              <span className={c.switch} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className={c.ctxTally}>
        {totalContext === 0 ? (
          'Add at least one source, link, note, or file — the richer the context, the better your course.'
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
