import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowSm } from '../../lib/shadows';
import { api } from '../../lib/api';
import { BottomSheet } from '../../components/BottomSheet';
import { OptionPicker } from '../../components/OptionPicker';

const DEPTH_OPTIONS = [
  { id: 'eli5', label: 'ELI5' },
  { id: 'quick_overview', label: 'Quick Overview' },
  { id: 'standard', label: 'Standard' },
  { id: 'deep_dive', label: 'Deep Dive' },
];

const TONE_OPTIONS = [
  { id: 'casual', label: 'Casual' },
  { id: 'professional', label: 'Professional' },
  { id: 'socratic', label: 'Socratic' },
  { id: 'comedic', label: 'Comedic' },
  { id: 'satirical', label: 'Satirical' },
  { id: 'storytelling', label: 'Storytelling' },
];

const AUDIENCE_OPTIONS = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'expert', label: 'Expert' },
];

const DURATION_OPTIONS = [
  { id: '3', label: '3 min' },
  { id: '6', label: '6 min' },
  { id: '10', label: '10 min' },
  { id: '15', label: '15 min' },
  { id: '20', label: '20 min' },
  { id: '30', label: '30 min' },
];

const VISIBILITY_OPTIONS = [
  { id: 'PRIVATE', label: 'Private' },
  { id: 'UNLISTED', label: 'Unlisted' },
  { id: 'PUBLIC', label: 'Public' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const VOICE_POOL_NAMES = [
  'Adam', 'Eric', 'Brian', 'Will', 'Roger', 'Charlie', 'George', 'Callum',
  'Aria', 'Rachel', 'Jessica', 'Laura', 'Matilda', 'Alice', 'Charlotte', 'Grace',
];

interface UserBriefingFields {
  briefingTime: string | null;
  briefingTimezone: string | null;
  briefingDays: number;
  briefingVisibility: string;
  briefingAiModel: string | null;
  briefingTtsProvider: string | null;
  briefingTtsModel: string | null;
  briefingHostVoiceId: string | null;
  briefingExpertVoiceId: string | null;
  briefingDepth: string | null;
  briefingTone: string | null;
  briefingAudienceLevel: string | null;
  briefingDuration: number | null;
  briefingPrompt: string | null;
  briefingUseByokKeys: boolean;
}

function patchUser(data: Record<string, unknown>) {
  return api.patch('/users/me', data);
}

export default function BriefingSettingsScreen() {
  const { data: user } = useQuery<UserBriefingFields>({
    queryKey: ['user', 'me', 'briefings'],
    queryFn: async () => {
      const res = await api.get('/users/me');
      return res.data;
    },
  });

  const { data: aiModels } = useQuery<Array<{ id: string; displayName: string; tier: string; group?: string }>>({
    queryKey: ['ai-models'],
    queryFn: async () => {
      const res = await api.get('/ai-models');
      return res.data.models ?? res.data;
    },
  });

  const { data: ttsOptions } = useQuery<Array<{ id: string; displayName: string; badge?: string; group?: string }>>({
    queryKey: ['tts-options'],
    queryFn: async () => {
      const res = await api.get('/tts-options');
      return res.data.options ?? res.data;
    },
  });

  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState(0);
  const [visibility, setVisibility] = useState('PRIVATE');
  const [aiModel, setAiModel] = useState<string | undefined>();
  const [ttsOption, setTtsOption] = useState<string | undefined>();
  const [hostVoice, setHostVoice] = useState<string | undefined>();
  const [expertVoice, setExpertVoice] = useState<string | undefined>();
  const [depth, setDepth] = useState<string | undefined>();
  const [tone, setTone] = useState<string | undefined>();
  const [audienceLevel, setAudienceLevel] = useState<string | undefined>();
  const [duration, setDuration] = useState<string | undefined>();
  const [prompt, setPrompt] = useState('');
  const [useByokKeys, setUseByokKeys] = useState(false);
  // Picker sheet state
  const [activePicker, setActivePicker] = useState<string | null>(null);

  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when user data loads
  useEffect(() => {
    if (!user) return;
    setTime(user.briefingTime ?? '08:00');
    setDays(user.briefingDays ?? 0);
    setVisibility(user.briefingVisibility ?? 'PRIVATE');
    setAiModel(user.briefingAiModel ?? undefined);
    setTtsOption(
      user.briefingTtsProvider
        ? user.briefingTtsModel
          ? `${user.briefingTtsProvider}:${user.briefingTtsModel}`
          : user.briefingTtsProvider
        : undefined
    );
    setHostVoice(user.briefingHostVoiceId ?? undefined);
    setExpertVoice(user.briefingExpertVoiceId ?? undefined);
    setDepth(user.briefingDepth ?? undefined);
    setTone(user.briefingTone ?? undefined);
    setAudienceLevel(user.briefingAudienceLevel ?? undefined);
    setDuration(user.briefingDuration?.toString() ?? undefined);
    setPrompt(user.briefingPrompt ?? '');
    setUseByokKeys(user.briefingUseByokKeys ?? false);
  }, [user]);

  useEffect(() => {
    return () => {
      if (promptTimer.current) clearTimeout(promptTimer.current);
    };
  }, []);

  function handlePromptChange(value: string) {
    setPrompt(value);
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = setTimeout(() => {
      patchUser({ briefingPrompt: value || null });
    }, 800);
  }

  function toggleDay(index: number) {
    const bit = index === 6 ? 64 : (1 << index);
    const newDays = days ^ bit;
    setDays(newDays);
    patchUser({ briefingDays: newDays });
  }

  const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return [
      { id: `${hour}:00`, label: `${hour}:00` },
      { id: `${hour}:30`, label: `${hour}:30` },
    ];
  }).flat();

  const voiceOptions = VOICE_POOL_NAMES.map((name) => ({ id: name, label: name }));

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Daily Briefings' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Schedule */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <View style={styles.card}>
            <PickerButton label="Delivery Time" value={time} onPress={() => setActivePicker('time')} fullWidth />
            <Text style={styles.fieldLabelSmall}>Days</Text>
            <View style={styles.dayChips}>
              {DAY_LABELS.map((day, i) => {
                const bit = i === 6 ? 64 : (1 << i);
                const active = (days & bit) !== 0;
                return (
                  <Pressable
                    key={day}
                    style={[styles.dayChip, active && styles.dayChipActive]}
                    onPress={() => toggleDay(i)}
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle ${day}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* Content */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Content</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Custom Instructions</Text>
            <TextInput
              style={styles.textArea}
              value={prompt}
              onChangeText={handlePromptChange}
              placeholder="e.g. Focus on AI research and TypeScript ecosystem news"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={2000}
              accessibilityLabel="Briefing custom instructions"
            />
            {prompt.length > 0 && (
              <Text style={styles.charCount}>{prompt.length}/2000</Text>
            )}

            <View style={styles.pickerRow}>
              <PickerButton label="Depth" value={DEPTH_OPTIONS.find((o) => o.id === depth)?.label ?? 'Default'} onPress={() => setActivePicker('depth')} />
              <PickerButton label="Tone" value={TONE_OPTIONS.find((o) => o.id === tone)?.label ?? 'Default'} onPress={() => setActivePicker('tone')} />
            </View>
            <View style={styles.pickerRow}>
              <PickerButton label="Audience" value={AUDIENCE_OPTIONS.find((o) => o.id === audienceLevel)?.label ?? 'Default'} onPress={() => setActivePicker('audience')} />
              <PickerButton label="Duration" value={DURATION_OPTIONS.find((o) => o.id === duration)?.label ?? 'Default'} onPress={() => setActivePicker('duration')} />
            </View>
          </View>
        </View>

        {/* Audio */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audio</Text>
          <View style={styles.card}>
            <PickerButton
              label="AI Model"
              value={aiModels?.find((m) => m.id === aiModel)?.displayName ?? 'Use my default'}
              onPress={() => setActivePicker('aiModel')}
              fullWidth
            />
            <PickerButton
              label="Voice Provider"
              value={ttsOptions?.find((o) => o.id === ttsOption)?.displayName ?? 'Use my default'}
              onPress={() => setActivePicker('ttsOption')}
              fullWidth
            />
            <View style={styles.pickerRow}>
              <PickerButton label="Host Voice" value={hostVoice ?? 'Auto'} onPress={() => setActivePicker('hostVoice')} />
              <PickerButton label="Expert Voice" value={expertVoice ?? 'Auto'} onPress={() => setActivePicker('expertVoice')} />
            </View>
          </View>
        </View>

        {/* Advanced */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Advanced</Text>
          <View style={styles.card}>
            <PickerButton
              label="Visibility"
              value={VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label ?? 'Private'}
              onPress={() => setActivePicker('visibility')}
              fullWidth
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Use my own API keys</Text>
              <Switch
                value={useByokKeys}
                onValueChange={(val) => {
                  setUseByokKeys(val);
                  patchUser({ briefingUseByokKeys: val });
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Bottom sheet pickers */}
      <BottomSheet visible={activePicker === 'time'} onClose={() => setActivePicker(null)} title="Delivery Time">
        <OptionPicker options={TIME_OPTIONS} selectedId={time} onSelect={(id) => {
          if (id) {
            setTime(id);
            patchUser({ briefingTime: id, briefingTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
          }
          setActivePicker(null);
        }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'depth'} onClose={() => setActivePicker(null)} title="Depth">
        <OptionPicker options={DEPTH_OPTIONS} selectedId={depth} onSelect={(id) => { setDepth(id); patchUser({ briefingDepth: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'tone'} onClose={() => setActivePicker(null)} title="Tone">
        <OptionPicker options={TONE_OPTIONS} selectedId={tone} onSelect={(id) => { setTone(id); patchUser({ briefingTone: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'audience'} onClose={() => setActivePicker(null)} title="Audience Level">
        <OptionPicker options={AUDIENCE_OPTIONS} selectedId={audienceLevel} onSelect={(id) => { setAudienceLevel(id); patchUser({ briefingAudienceLevel: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'duration'} onClose={() => setActivePicker(null)} title="Duration">
        <OptionPicker options={DURATION_OPTIONS} selectedId={duration} onSelect={(id) => { setDuration(id); patchUser({ briefingDuration: id ? parseInt(id, 10) : null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'visibility'} onClose={() => setActivePicker(null)} title="Visibility">
        <OptionPicker options={VISIBILITY_OPTIONS} selectedId={visibility} onSelect={(id) => { if (id) { setVisibility(id); patchUser({ briefingVisibility: id }); } setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'aiModel'} onClose={() => setActivePicker(null)} title="AI Model">
        <OptionPicker options={aiModels?.map((m) => ({ id: m.id, label: m.displayName, badge: m.tier === 'pro' ? 'Pro' : undefined, group: m.group })) ?? []} selectedId={aiModel} onSelect={(id) => { setAiModel(id); patchUser({ briefingAiModel: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'ttsOption'} onClose={() => setActivePicker(null)} title="Voice Provider">
        <OptionPicker options={ttsOptions?.map((o) => ({ id: o.id, label: o.displayName, badge: o.badge, group: o.group })) ?? []} selectedId={ttsOption} onSelect={(id) => {
          setTtsOption(id);
          if (id) {
            const [provider, ...modelParts] = id.split(':');
            const model = modelParts.join(':');
            patchUser({ briefingTtsProvider: provider, briefingTtsModel: model || null });
          } else {
            patchUser({ briefingTtsProvider: null, briefingTtsModel: null });
          }
          setActivePicker(null);
        }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'hostVoice'} onClose={() => setActivePicker(null)} title="Host Voice">
        <OptionPicker options={voiceOptions} selectedId={hostVoice} onSelect={(id) => { setHostVoice(id); patchUser({ briefingHostVoiceId: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'expertVoice'} onClose={() => setActivePicker(null)} title="Expert Voice">
        <OptionPicker options={voiceOptions} selectedId={expertVoice} onSelect={(id) => { setExpertVoice(id); patchUser({ briefingExpertVoiceId: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
    </View>
  );
}

function PickerButton({ label, value, onPress, fullWidth }: { label: string; value: string; onPress: () => void; fullWidth?: boolean }) {
  return (
    <Pressable
      style={[styles.pickerButton, fullWidth && styles.pickerButtonFull]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.pickerLabel}>{label}</Text>
      <View style={styles.pickerValueRow}>
        <Text style={styles.pickerValue} numberOfLines={1}>{value}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingVertical: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadowSm,
  },
  fieldLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  fieldLabelSmall: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  dayChips: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  dayChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minWidth: 44,
    alignItems: 'center',
  },
  dayChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLighter,
  },
  dayChipText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  dayChipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  textArea: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.xs,
  },
  charCount: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pickerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  pickerButtonFull: {
    marginTop: spacing.sm,
  },
  pickerLabel: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  pickerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerValue: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  switchLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
});
