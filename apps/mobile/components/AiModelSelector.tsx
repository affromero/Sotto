import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { BottomSheet } from './BottomSheet';
import { OptionPicker } from './OptionPicker';

const STORAGE_KEY = 'sotto:aiModel';
const AUTO_ID = '__auto__';

interface AiModelSelectorProps {
  value: string | undefined;
  onChange: (model: string | undefined) => void;
}

interface AiModel {
  id: string;
  displayName: string;
  provider: string;
  tier: string;
  requiredPlan: 'FREE' | 'PRO';
  isDefault: boolean;
}

interface AiModelsResponse {
  models: AiModel[];
  readOnly: boolean;
  userPlan?: 'FREE' | 'PRO';
  isByok?: boolean;
}

export function AiModelSelector({ value, onChange }: AiModelSelectorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = useQuery<AiModelsResponse>({
    queryKey: ['ai-models'],
    queryFn: async () => {
      const res = await api.get('/ai-models');
      return res.data;
    },
  });

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
      if (stored && stored !== AUTO_ID) {
        onChange(stored);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data?.models?.length) return null;

  const userPlan = data.userPlan ?? 'FREE';
  const isByok = data.isByok ?? false;
  const isLocked = (m: AiModel) =>
    m.requiredPlan === 'PRO' && userPlan === 'FREE' && !isByok;

  const options = [
    { id: AUTO_ID, label: 'Auto (recommended)' },
    ...data.models.map((m) => ({
      id: m.id,
      label: m.displayName,
      badge: isLocked(m) ? 'Pro' : m.tier,
      group: m.provider,
      disabled: isLocked(m),
    })),
  ];

  const selectedId = value ?? AUTO_ID;
  const selectedLabel =
    selectedId === AUTO_ID
      ? 'Auto'
      : data.models.find((m) => m.id === selectedId)?.displayName ?? 'Auto';

  function handleSelect(id: string | undefined) {
    const resolvedId = id ?? AUTO_ID;
    const modelValue = resolvedId === AUTO_ID ? undefined : resolvedId;
    onChange(modelValue);
    SecureStore.setItemAsync(STORAGE_KEY, resolvedId);
    setSheetOpen(false);
  }

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => {
          if (!data.readOnly) setSheetOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`AI Model: ${selectedLabel}`}
      >
        <Text style={styles.triggerText}>{selectedLabel}</Text>
        {!data.readOnly && <Text style={styles.chevron}>▾</Text>}
      </Pressable>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="AI Model"
      >
        <OptionPicker
          options={options}
          selectedId={selectedId}
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
