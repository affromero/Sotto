'use client';

import { useState } from 'react';
import styles from './ActionEditor.module.css';

type Action = Record<string, unknown>;

const ACTION_TYPES = [
  'navigate', 'click', 'type', 'wait', 'scroll', 'zoom', 'zoomReset',
  'hover', 'waitForSelector', 'intercept', 'clearIntercept', 'keypress', 'screenshot',
];

const ACTION_ICONS: Record<string, string> = {
  navigate: 'Go',
  click: 'Click',
  type: 'Type',
  wait: 'Wait',
  scroll: 'Scroll',
  zoom: 'Zoom',
  zoomReset: 'Reset',
  hover: 'Hover',
  waitForSelector: 'Await',
  intercept: 'Mock',
  clearIntercept: 'Unmock',
  keypress: 'Key',
  screenshot: 'Snap',
};

export function ActionEditor({
  actions,
  onChange,
}: {
  actions: Action[];
  onChange: (actions: Action[]) => void;
}) {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  if (jsonMode) {
    return (
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <button className={styles.toolBtn} onClick={() => setJsonMode(false)}>
            Visual Editor
          </button>
        </div>
        <textarea
          className={styles.jsonEditor}
          value={jsonText || JSON.stringify(actions, null, 2)}
          onChange={(e) => {
            setJsonText(e.target.value);
            setJsonError(null);
          }}
          rows={15}
        />
        {jsonError && <span className={styles.jsonError}>{jsonError}</span>}
        <button
          className={styles.applyBtn}
          onClick={() => {
            try {
              const parsed = JSON.parse(jsonText || JSON.stringify(actions, null, 2));
              if (!Array.isArray(parsed)) throw new Error('Must be an array');
              onChange(parsed);
              setJsonMode(false);
              setJsonText('');
            } catch (err) {
              setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
            }
          }}
        >
          Apply JSON
        </button>
      </div>
    );
  }

  const updateAction = (index: number, updates: Partial<Action>) => {
    const updated = [...actions];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const removeAction = (index: number) => {
    onChange(actions.filter((_, i) => i !== index));
  };

  const addAction = (type: string) => {
    const base: Action = { type };
    switch (type) {
      case 'navigate': base.url = '/'; break;
      case 'click': case 'hover': case 'waitForSelector': base.selector = ''; break;
      case 'type': base.selector = ''; base.text = ''; break;
      case 'wait': base.ms = 500; break;
      case 'scroll': base.distance = 400; break;
      case 'zoom': base.selector = ''; base.scale = 1.5; break;
      case 'keypress': base.key = 'Enter'; break;
      case 'intercept': base.name = ''; base.options = {}; break;
      case 'clearIntercept': base.name = ''; break;
    }
    onChange([...actions, base]);
  };

  const moveAction = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= actions.length) return;
    const updated = [...actions];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    onChange(updated);
  };

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button
          className={styles.toolBtn}
          onClick={() => {
            setJsonText(JSON.stringify(actions, null, 2));
            setJsonMode(true);
          }}
        >
          JSON Editor
        </button>
      </div>

      <div className={styles.actionList}>
        {actions.map((action, i) => (
          <div key={i} className={styles.actionCard}>
            <div className={styles.actionHeader}>
              <span className={styles.actionType}>
                {ACTION_ICONS[action.type as string] ?? action.type}
              </span>
              <div className={styles.actionControls}>
                <button className={styles.moveBtn} onClick={() => moveAction(i, -1)} disabled={i === 0}>
                  &uarr;
                </button>
                <button className={styles.moveBtn} onClick={() => moveAction(i, 1)} disabled={i === actions.length - 1}>
                  &darr;
                </button>
                <button className={styles.removeBtn} onClick={() => removeAction(i)}>
                  &times;
                </button>
              </div>
            </div>
            <div className={styles.actionParams}>
              {renderActionParams(action, (updates) => updateAction(i, updates))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.addRow}>
        <select
          className={styles.addSelect}
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) {
              addAction(e.target.value);
              e.target.value = '';
            }
          }}
        >
          <option value="" disabled>Add action...</option>
          {ACTION_TYPES.map((t) => (
            <option key={t} value={t}>{ACTION_ICONS[t] ?? t} ({t})</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function renderActionParams(
  action: Action,
  onChange: (updates: Partial<Action>) => void,
) {
  const type = action.type as string;

  switch (type) {
    case 'navigate':
      return (
        <input
          className={styles.paramInput}
          value={(action.url as string) ?? ''}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="/path"
        />
      );
    case 'click':
    case 'hover':
    case 'waitForSelector':
      return (
        <input
          className={styles.paramInput}
          value={(action.selector as string) ?? ''}
          onChange={(e) => onChange({ selector: e.target.value })}
          placeholder="CSS selector"
        />
      );
    case 'type':
      return (
        <>
          <input
            className={styles.paramInput}
            value={(action.selector as string) ?? ''}
            onChange={(e) => onChange({ selector: e.target.value })}
            placeholder="CSS selector"
          />
          <input
            className={styles.paramInput}
            value={(action.text as string) ?? ''}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Text to type"
          />
        </>
      );
    case 'wait':
      return (
        <input
          type="number"
          className={styles.paramInput}
          value={(action.ms as number) ?? 500}
          onChange={(e) => onChange({ ms: Number(e.target.value) })}
          placeholder="Milliseconds"
        />
      );
    case 'scroll':
      return (
        <input
          type="number"
          className={styles.paramInput}
          value={(action.distance as number) ?? 400}
          onChange={(e) => onChange({ distance: Number(e.target.value) })}
          placeholder="Distance (px)"
        />
      );
    case 'zoom':
      return (
        <>
          <input
            className={styles.paramInput}
            value={(action.selector as string) ?? ''}
            onChange={(e) => onChange({ selector: e.target.value })}
            placeholder="CSS selector"
          />
          <input
            type="number"
            className={styles.paramInput}
            value={(action.scale as number) ?? 1.5}
            onChange={(e) => onChange({ scale: Number(e.target.value) })}
            placeholder="Scale"
            step={0.1}
          />
        </>
      );
    case 'keypress':
      return (
        <input
          className={styles.paramInput}
          value={(action.key as string) ?? ''}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder="Key name (Enter, Tab, etc)"
        />
      );
    case 'intercept':
      return (
        <input
          className={styles.paramInput}
          value={(action.name as string) ?? ''}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Interceptor name (discovery, interact, library, scriptApprove)"
        />
      );
    case 'clearIntercept':
      return (
        <input
          className={styles.paramInput}
          value={(action.name as string) ?? ''}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Interceptor name"
        />
      );
    default:
      return <span className={styles.noParams}>No parameters</span>;
  }
}
