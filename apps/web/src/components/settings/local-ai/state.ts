export interface LocalAiConfig {
  baseUrl: string;
  model: string;
}

interface LocalAiState {
  saved: LocalAiConfig;
  draft: LocalAiConfig;
  saving: boolean;
  message: string;
  error: string;
  key: { editing: boolean; value: string; needsRebind: boolean };
}

type Action =
  | { type: 'configure'; field: keyof LocalAiConfig; value: string }
  | { type: 'saving' }
  | { type: 'configured'; config: LocalAiConfig; hasKey: boolean }
  | { type: 'failed'; message: string }
  | { type: 'edit-key' }
  | { type: 'key-value'; value: string }
  | { type: 'key-dispatched' }
  | { type: 'close-key'; confirmed?: boolean };

export function initialLocalAiState(config: LocalAiConfig): LocalAiState {
  return {
    saved: { ...config },
    draft: { ...config },
    saving: false,
    message: '',
    error: '',
    key: { editing: false, value: '', needsRebind: false },
  };
}

export function localAiReducer(state: LocalAiState, action: Action): LocalAiState {
  switch (action.type) {
    case 'configure':
      return {
        ...state,
        draft: { ...state.draft, [action.field]: action.value },
        message: '',
        error: '',
        key: { ...state.key, editing: false, value: '' },
      };
    case 'saving':
      return { ...state, saving: true, error: '', message: '' };
    case 'configured':
      return {
        ...state,
        saved: action.config,
        draft: { ...action.config },
        saving: false,
        message: 'AI server settings saved.',
        key: {
          ...state.key,
          needsRebind:
            state.key.needsRebind ||
            (action.hasKey && state.saved.baseUrl !== action.config.baseUrl),
        },
      };
    case 'failed':
      return { ...state, saving: false, error: action.message, message: '' };
    case 'edit-key':
      return { ...state, key: { ...state.key, editing: true, value: '' } };
    case 'key-value':
      return { ...state, key: { ...state.key, value: action.value } };
    case 'key-dispatched':
      return { ...state, key: { ...state.key, value: '' } };
    case 'close-key':
      return {
        ...state,
        key: {
          editing: false,
          value: '',
          needsRebind: action.confirmed ? false : state.key.needsRebind,
        },
      };
  }
}
