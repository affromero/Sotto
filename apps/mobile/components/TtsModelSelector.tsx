import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { BottomSheet } from './BottomSheet';
import { OptionPicker } from './OptionPicker';

const STORAGE_KEY = 'sotto:ttsOption';
const AUTO_ID = '__auto__';

interface TtsModelSelectorProps {
  ttsProvider: string | undefined;
  ttsModel: string | undefined;
  onChange: (provider: string | undefined, model: string | undefined) => void;
}

interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
}

interface TtsOptionsResponse {
  options: TtsOption[];
}

export function TtsModelSelector({ ttsProvider, ttsModel, onChange }: TtsModelSelectorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = useQuery<TtsOptionsResponse>({
    queryKey: ['tts-options'],
    queryFn: async () => {
      const res = await api.get('/tts-options');
      return res.data;
    },
  });

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
      if (stored && stored !== AUTO_ID && stored !== '') {
        const [provider, ...rest] = stored.split(':');
        const model = rest.join(':');
        if (provider && model) {
          onChange(provider, model);
        }
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data?.options?.length) return null;

  const options = [
    { id: AUTO_ID, label: 'Auto (recommended)' },
    ...data.options.map((o) => ({
      id: o.id,
      label: o.displayName,
      badge: o.badge,
      group: o.group,
    })),
  ];

  const currentId = ttsProvider && ttsModel ? `${ttsProvider}:${ttsModel}` : AUTO_ID;
  const selectedLabel =
    currentId === AUTO_ID
      ? 'Auto'
      : data.options.find((o) => o.id === currentId)?.displayName ?? 'Auto';

  function handleSelect(id: string | undefined) {
    const resolvedId = id ?? AUTO_ID;
    if (resolvedId === AUTO_ID) {
      onChange(undefined, undefined);
      SecureStore.setItemAsync(STORAGE_KEY, '').catch(() => {});
    } else {
      const [provider, ...rest] = resolvedId.split(':');
      const model = rest.join(':');
      onChange(provider, model);
      SecureStore.setItemAsync(STORAGE_KEY, resolvedId).catch(() => {});
    }
    setSheetOpen(false);
  }

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => setSheetOpen(true)}
        testID="tts-model-trigger"
        accessibilityRole="button"
        accessibilityLabel={`TTS Voice: ${selectedLabel}`}
      >
        <Text style={styles.triggerText}>{selectedLabel}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="TTS Voice"
      >
        <OptionPicker
          options={options}
          selectedId={currentId}
          onSelect={handleSelect}
        />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  triggerText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
  },
  chevron: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
