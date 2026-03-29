import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowSm } from '../../lib/shadows';
import { api } from '../../lib/api';
import { BottomSheet } from '../../components/BottomSheet';
import { OptionPicker } from '../../components/OptionPicker';

const MAX_BRIEFINGS = 5;
const MAX_ENABLED = 3;

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

interface BriefingData {
  id: string;
  name: string;
  enabled: boolean;
  time: string;
  timezone: string;
  days: number;
  prompt: string | null;
  depth: string | null;
  tone: string | null;
  audienceLevel: string | null;
  duration: number | null;
  format: number;
  aiModel: string | null;
  ttsProvider: string | null;
  ttsModel: string | null;
  hostVoiceId: string | null;
  expertVoiceId: string | null;
  visibility: string;
  useByokKeys: boolean;
  lastGeneratedAt: string | null;
}

function patchBriefing(id: string, data: Record<string, unknown>) {
  return api.patch(`/briefings/${id}`, data);
}

function formatDays(bitmask: number): string {
  if (bitmask === 127) return 'Every day';
  if (bitmask === 31) return 'Weekdays';
  if (bitmask === 96) return 'Weekends';
  const active: string[] = [];
  for (let i = 0; i < 7; i++) {
    const bit = i === 6 ? 64 : (1 << i);
    if ((bitmask & bit) !== 0) active.push(DAY_LABELS[i]);
  }
  return active.join(', ');
}

export default function BriefingSettingsScreen() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ briefings: BriefingData[] }>({
    queryKey: ['briefings'],
    queryFn: async () => {
      const res = await api.get('/briefings');
      return res.data;
    },
  });

  const briefings = data?.briefings ?? [];
  const enabledCount = briefings.filter((b) => b.enabled).length;

  const refresh = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['briefings'] });
  }, [refetch, queryClient]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Daily Briefings' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Counter */}
        <View style={styles.counterRow}>
          <Text style={styles.counterText}>
            {briefings.length} of {MAX_BRIEFINGS} briefings
          </Text>
          {enabledCount >= MAX_ENABLED && (
            <Text style={styles.counterHighlight}>
              {enabledCount}/{MAX_ENABLED} enabled
            </Text>
          )}
        </View>

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* Empty state */}
        {!isLoading && briefings.length === 0 && !showCreate && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No briefings yet. Create one to get a personalized podcast every morning.
            </Text>
          </View>
        )}

        {/* Briefing cards */}
        {briefings.map((b) => (
          <BriefingCard
            key={b.id}
            briefing={b}
            expanded={expandedId === b.id}
            onToggleExpand={() => setExpandedId(expandedId === b.id ? null : b.id)}
            onRefresh={refresh}
          />
        ))}

        {/* Create form */}
        {showCreate ? (
          <CreateBriefingForm
            onCreated={() => { setShowCreate(false); refresh(); }}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <Pressable
            style={[styles.addBtn, briefings.length >= MAX_BRIEFINGS && styles.addBtnDisabled]}
            onPress={() => setShowCreate(true)}
            disabled={briefings.length >= MAX_BRIEFINGS}
            accessibilityRole="button"
            accessibilityLabel="Add briefing"
          >
            <Text style={[styles.addBtnText, briefings.length >= MAX_BRIEFINGS && styles.addBtnTextDisabled]}>
              {briefings.length >= MAX_BRIEFINGS ? `Limit reached (${MAX_BRIEFINGS} max)` : '+ Add Briefing'}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Briefing Card ─────────────────────────────────────────────

function BriefingCard({
  briefing,
  expanded,
  onToggleExpand,
  onRefresh,
}: {
  briefing: BriefingData;
  expanded: boolean;
  onToggleExpand: () => void;
  onRefresh: () => void;
}) {
  const [enabled, setEnabled] = useState(briefing.enabled);
  const [generating, setGenerating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const depthLabel = DEPTH_OPTIONS.find((o) => o.id === briefing.depth)?.label ?? 'Quick Overview';
  const durationLabel = DURATION_OPTIONS.find((o) => o.id === briefing.duration?.toString())?.label ?? '6 min';

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await patchBriefing(briefing.id, { enabled: next });
      onRefresh();
    } catch {
      setEnabled(!next);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await api.post(`/briefings/${briefing.id}/generate`);
      onRefresh();
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/briefings/${briefing.id}`);
      onRefresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={[styles.card, enabled && styles.cardEnabled]}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.indicator, enabled && styles.indicatorActive]} />
          <Text style={styles.cardName} numberOfLines={1}>{briefing.name}</Text>
        </View>
        <Pressable
          onPress={toggleEnabled}
          style={styles.toggleChip}
          accessibilityRole="button"
          accessibilityLabel={enabled ? 'Disable briefing' : 'Enable briefing'}
        >
          <Text style={styles.toggleChipText}>{enabled ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText} numberOfLines={1}>
          {formatDays(briefing.days)} at {briefing.time} · {depthLabel} · {durationLabel}
        </Text>
        <Pressable onPress={onToggleExpand} accessibilityRole="button" style={styles.editBtn}>
          <Text style={styles.editBtnText}>{expanded ? 'Close' : 'Edit'}</Text>
        </Pressable>
      </View>

      {/* Expanded form */}
      {expanded && (
        <BriefingEditForm briefing={briefing} onRefresh={onRefresh} />
      )}

      {/* Actions */}
      {expanded && (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={handleGenerate}
            disabled={generating}
            style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.generateBtnText}>
              {generating ? 'Generating...' : 'Generate Now'}
            </Text>
          </Pressable>

          {!confirmDelete ? (
            <Pressable onPress={() => setConfirmDelete(true)} accessibilityRole="button" style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>Delete</Text>
            </Pressable>
          ) : (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmText}>Delete?</Text>
              <Pressable onPress={handleDelete} disabled={deleting} accessibilityRole="button" style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>{deleting ? '...' : 'Yes'}</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmDelete(false)} accessibilityRole="button" style={styles.editBtn}>
                <Text style={styles.editBtnText}>No</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Edit Form ──────────────────────────────────────────────────

function BriefingEditForm({ briefing, onRefresh }: { briefing: BriefingData; onRefresh: () => void }) {
  const [activePicker, setActivePicker] = useState<string | null>(null);
  const [time, setTime] = useState(briefing.time);
  const [days, setDays] = useState(briefing.days);
  const [prompt, setPrompt] = useState(briefing.prompt ?? '');
  const [depth, setDepth] = useState(briefing.depth ?? undefined);
  const [tone, setTone] = useState(briefing.tone ?? undefined);
  const [audienceLevel, setAudienceLevel] = useState(briefing.audienceLevel ?? undefined);
  const [duration, setDuration] = useState(briefing.duration?.toString() ?? undefined);
  const [aiModel, setAiModel] = useState(briefing.aiModel ?? undefined);
  const [ttsOption, setTtsOption] = useState(
    briefing.ttsProvider
      ? briefing.ttsModel ? `${briefing.ttsProvider}:${briefing.ttsModel}` : briefing.ttsProvider
      : undefined,
  );
  const [hostVoice, setHostVoice] = useState(briefing.hostVoiceId ?? undefined);
  const [expertVoice, setExpertVoice] = useState(briefing.expertVoiceId ?? undefined);
  const [visibility, setVisibility] = useState(briefing.visibility);
  const [useByokKeys, setUseByokKeys] = useState(briefing.useByokKeys);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch AI models and TTS options from registry
  const { data: aiModels } = useQuery<Array<{ id: string; displayName: string; group?: string }>>({
    queryKey: ['ai-models'],
    queryFn: async () => {
      const res = await api.get('/ai-models');
      return res.data.models ?? [];
    },
  });

  const { data: ttsModels } = useQuery<Array<{ id: string; displayName: string; badge?: string; group?: string }>>({
    queryKey: ['tts-options'],
    queryFn: async () => {
      const res = await api.get('/tts-options');
      return (res.data.options ?? []).filter((o: { id: string }) => o.id !== 'auto');
    },
  });

  // Build grouped options for pickers (provider → models)
  const aiModelOptions = (aiModels ?? []).map((m) => ({
    id: m.id,
    label: m.displayName,
    group: m.group,
  }));

  const ttsOptionsList = (ttsModels ?? []).map((o) => ({
    id: o.id,
    label: `${o.displayName}${o.badge ? ` (${o.badge})` : ''}`,
    group: o.group,
  }));

  // Fetch voices dynamically based on selected TTS provider
  const ttsProvider = ttsOption ? ttsOption.split(':')[0] : null;
  const { data: voiceData } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['voices', ttsProvider],
    queryFn: async () => {
      if (!ttsProvider) return [];
      const res = await api.get(`/voices?provider=${encodeURIComponent(ttsProvider)}`);
      return res.data?.poolVoices ?? [];
    },
    enabled: !!ttsProvider,
  });
  const voiceOptions = (voiceData ?? []).map((v) => ({ id: v.id, label: v.name }));

  useEffect(() => {
    return () => { if (promptTimer.current) clearTimeout(promptTimer.current); };
  }, []);

  function handlePromptChange(value: string) {
    setPrompt(value);
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = setTimeout(() => {
      patchBriefing(briefing.id, { prompt: value || null });
    }, 800);
  }

  function toggleDay(index: number) {
    const bit = index === 6 ? 64 : (1 << index);
    const newDays = days ^ bit;
    setDays(newDays);
    patchBriefing(briefing.id, { days: newDays });
  }

  const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return [
      { id: `${hour}:00`, label: `${hour}:00` },
      { id: `${hour}:30`, label: `${hour}:30` },
    ];
  }).flat();

  return (
    <View style={styles.editSection}>
      {/* Schedule */}
      <Text style={styles.editGroupTitle}>Schedule</Text>
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
              <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{day}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Content */}
      <Text style={[styles.editGroupTitle, { marginTop: spacing.md }]}>Content</Text>
      <TextInput
        style={styles.textArea}
        value={prompt}
        onChangeText={handlePromptChange}
        placeholder="e.g. Focus on AI research and TypeScript ecosystem news"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={2000}
        accessibilityLabel="Custom instructions"
      />
      <View style={styles.pickerRow}>
        <PickerButton label="Depth" value={DEPTH_OPTIONS.find((o) => o.id === depth)?.label ?? 'Default'} onPress={() => setActivePicker('depth')} />
        <PickerButton label="Tone" value={TONE_OPTIONS.find((o) => o.id === tone)?.label ?? 'Default'} onPress={() => setActivePicker('tone')} />
      </View>
      <View style={styles.pickerRow}>
        <PickerButton label="Audience" value={AUDIENCE_OPTIONS.find((o) => o.id === audienceLevel)?.label ?? 'Default'} onPress={() => setActivePicker('audience')} />
        <PickerButton label="Duration" value={DURATION_OPTIONS.find((o) => o.id === duration)?.label ?? 'Default'} onPress={() => setActivePicker('duration')} />
      </View>

      {/* Audio */}
      <Text style={[styles.editGroupTitle, { marginTop: spacing.md }]}>Audio</Text>
      <PickerButton
        label="AI Model"
        value={aiModelOptions.find((m) => m.id === aiModel)?.label ?? 'Use my default'}
        onPress={() => setActivePicker('aiModel')}
        fullWidth
      />
      <PickerButton
        label="Voice Provider"
        value={ttsOptionsList.find((o) => o.id === ttsOption)?.label ?? 'Use my default'}
        onPress={() => setActivePicker('ttsOption')}
        fullWidth
      />
      <View style={styles.pickerRow}>
        <PickerButton label="Host Voice" value={hostVoice ?? 'Auto'} onPress={() => setActivePicker('hostVoice')} />
        <PickerButton label="Expert Voice" value={expertVoice ?? 'Auto'} onPress={() => setActivePicker('expertVoice')} />
      </View>

      {/* Advanced */}
      <Text style={[styles.editGroupTitle, { marginTop: spacing.md }]}>Advanced</Text>
      <PickerButton label="Visibility" value={VISIBILITY_OPTIONS.find((o) => o.id === visibility)?.label ?? 'Private'} onPress={() => setActivePicker('visibility')} fullWidth />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Use my own API keys</Text>
        <Switch
          value={useByokKeys}
          onValueChange={(val) => { setUseByokKeys(val); patchBriefing(briefing.id, { useByokKeys: val }); }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>

      {/* Pickers */}
      <BottomSheet visible={activePicker === 'time'} onClose={() => setActivePicker(null)} title="Delivery Time">
        <OptionPicker options={TIME_OPTIONS} selectedId={time} onSelect={(id) => {
          if (id) { setTime(id); patchBriefing(briefing.id, { time: id }); }
          setActivePicker(null);
        }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'depth'} onClose={() => setActivePicker(null)} title="Depth">
        <OptionPicker options={DEPTH_OPTIONS} selectedId={depth} onSelect={(id) => { setDepth(id); patchBriefing(briefing.id, { depth: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'tone'} onClose={() => setActivePicker(null)} title="Tone">
        <OptionPicker options={TONE_OPTIONS} selectedId={tone} onSelect={(id) => { setTone(id); patchBriefing(briefing.id, { tone: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'audience'} onClose={() => setActivePicker(null)} title="Audience Level">
        <OptionPicker options={AUDIENCE_OPTIONS} selectedId={audienceLevel} onSelect={(id) => { setAudienceLevel(id); patchBriefing(briefing.id, { audienceLevel: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'duration'} onClose={() => setActivePicker(null)} title="Duration">
        <OptionPicker options={DURATION_OPTIONS} selectedId={duration} onSelect={(id) => { setDuration(id); patchBriefing(briefing.id, { duration: id ? parseInt(id, 10) : null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'visibility'} onClose={() => setActivePicker(null)} title="Visibility">
        <OptionPicker options={VISIBILITY_OPTIONS} selectedId={visibility} onSelect={(id) => { if (id) { setVisibility(id); patchBriefing(briefing.id, { visibility: id }); } setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'aiModel'} onClose={() => setActivePicker(null)} title="AI Model">
        <OptionPicker options={aiModelOptions} selectedId={aiModel} onSelect={(id) => { setAiModel(id); patchBriefing(briefing.id, { aiModel: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'ttsOption'} onClose={() => setActivePicker(null)} title="Voice Provider">
        <OptionPicker options={ttsOptionsList} selectedId={ttsOption} onSelect={(id) => {
          setTtsOption(id);
          setHostVoice(undefined);
          setExpertVoice(undefined);
          if (id) {
            const [provider, ...modelParts] = id.split(':');
            const model = modelParts.join(':');
            patchBriefing(briefing.id, { ttsProvider: provider, ttsModel: model || null, hostVoiceId: null, expertVoiceId: null });
          } else {
            patchBriefing(briefing.id, { ttsProvider: null, ttsModel: null, hostVoiceId: null, expertVoiceId: null });
          }
          setActivePicker(null);
        }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'hostVoice'} onClose={() => setActivePicker(null)} title="Host Voice">
        <OptionPicker options={voiceOptions} selectedId={hostVoice} onSelect={(id) => { setHostVoice(id); patchBriefing(briefing.id, { hostVoiceId: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
      <BottomSheet visible={activePicker === 'expertVoice'} onClose={() => setActivePicker(null)} title="Expert Voice">
        <OptionPicker options={voiceOptions} selectedId={expertVoice} onSelect={(id) => { setExpertVoice(id); patchBriefing(briefing.id, { expertVoiceId: id ?? null }); setActivePicker(null); }} />
      </BottomSheet>
    </View>
  );
}

// ─── Create Form ────────────────────────────────────────────────

function CreateBriefingForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (generateNow: boolean) => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await api.post('/briefings', {
        name: name.trim(),
        time: '08:00',
        timezone: tz,
      });
      if (generateNow && res.data?.id) {
        api.post(`/briefings/${res.data.id}/generate`).catch(() => {});
      }
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.createCard}>
      <Text style={styles.editGroupTitle}>New Briefing</Text>
      <TextInput
        style={styles.nameInput}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Morning Tech News"
        placeholderTextColor={colors.textTertiary}
        maxLength={100}
        autoFocus
        accessibilityLabel="Briefing name"
      />
      <View style={styles.createActions}>
        <Pressable
          onPress={() => handleCreate(true)}
          disabled={creating || !name.trim()}
          style={[styles.generateBtn, (creating || !name.trim()) && styles.generateBtnDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.generateBtnText}>{creating ? 'Creating...' : 'Generate now & schedule'}</Text>
        </Pressable>
        <Pressable
          onPress={() => handleCreate(false)}
          disabled={creating || !name.trim()}
          style={styles.editBtn}
          accessibilityRole="button"
        >
          <Text style={styles.editBtnText}>Just schedule</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.editBtn} accessibilityRole="button">
          <Text style={styles.editBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Picker Button ──────────────────────────────────────────────

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

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  counterText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  counterHighlight: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowSm,
  },
  cardEnabled: {
    borderColor: colors.primaryLighter,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
  },
  indicatorActive: {
    backgroundColor: '#22c55e',
  },
  cardName: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  toggleChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    minWidth: 44,
    alignItems: 'center',
  },
  toggleChipText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  summaryText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  editBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
  // Edit section
  editSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  editGroupTitle: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  // Actions
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  generateBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.surface,
  },
  deleteBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: '#ef4444',
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  confirmText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
  },
  // Create
  createCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryLighter,
    ...shadowSm,
  },
  nameInput: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  createActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  addBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  addBtnTextDisabled: {
    color: colors.textTertiary,
  },
  // Shared form styles
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
