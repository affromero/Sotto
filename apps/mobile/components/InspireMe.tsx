import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  colors,
  spacing,
  typography,
  borderRadius,
  INSPIRE_SECTION_LABELS,
} from '@sotto/shared';
import type { TasteQuestion, PodcastSummary, InspireSection } from '@sotto/shared';
import { api } from '../lib/api';
import { PillGroup } from './PillGroup';
import { InspireSwipeQuiz } from './InspireSwipeQuiz';
import { InspireTrendingList } from './InspireTrendingList';

interface InspireMeProps {
  visible: boolean;
  onClose: () => void;
  onSelectTopic: (topic: string) => void;
}

const SECTION_OPTIONS = (Object.keys(INSPIRE_SECTION_LABELS) as InspireSection[]).map((key) => ({
  value: key,
  label: INSPIRE_SECTION_LABELS[key],
}));


export function InspireMe({ visible, onClose, onSelectTopic }: InspireMeProps) {
  const [activeSection, setActiveSection] = useState<InspireSection>('forYou');
  const [topicInput, setTopicInput] = useState('');
  const [activeTopic, setActiveTopic] = useState<string | undefined>();
  const queryClient = useQueryClient();
  const topicInputRef = useRef<TextInput>(null);

  const forYouQuery = useQuery<TasteQuestion[]>({
    queryKey: ['inspire', 'forYou', activeTopic],
    queryFn: async () => {
      const params: Record<string, string> = { section: 'forYou' };
      if (activeTopic) params.topic = activeTopic;
      const res = await api.get('/inspire/all', { params });
      return res.data.forYou ?? [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: visible && activeSection === 'forYou',
  });

  const trendingQuery = useQuery<PodcastSummary[]>({
    queryKey: ['inspire', 'trending'],
    queryFn: async () => {
      const res = await api.get('/inspire/all', { params: { section: 'trending' } });
      return res.data.trending ?? [];
    },
    staleTime: 2 * 60 * 1000,
    enabled: visible && activeSection === 'trending',
  });

  const curiosityQuery = useQuery<TasteQuestion[]>({
    queryKey: ['inspire', 'curiosity', activeTopic],
    queryFn: async () => {
      const params: Record<string, string> = { section: 'curiosity' };
      if (activeTopic) params.topic = activeTopic;
      const res = await api.get('/inspire/all', { params });
      return res.data.curiosity ?? [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: visible && activeSection === 'curiosity',
  });

  const handleTopicSubmit = useCallback(() => {
    const trimmed = topicInput.trim() || undefined;
    setActiveTopic(trimmed);
    topicInputRef.current?.blur();
  }, [topicInput]);

  const handleTopicClear = useCallback(() => {
    setTopicInput('');
    setActiveTopic(undefined);
  }, []);

  const handleLoadMore = useCallback(
    (section: InspireSection) => {
      queryClient.invalidateQueries({ queryKey: ['inspire', section] });
    },
    [queryClient],
  );

  const handleSelectTopic = useCallback(
    (topic: string) => {
      onSelectTopic(topic);
    },
    [onSelectTopic],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.panel}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Title row */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>Inspire Me</Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityLabel="Close"
            >
              <Text style={styles.closeIcon}>{'\u2715'}</Text>
            </Pressable>
          </View>

          {/* Section tabs */}
          <View style={styles.pillRow}>
            <PillGroup
              options={SECTION_OPTIONS}
              selected={activeSection}
              onChange={(val) => setActiveSection(val as InspireSection)}
            />
          </View>

          {/* Topic filter */}
          <View style={styles.topicRow}>
            <TextInput
              ref={topicInputRef}
              style={styles.topicInput}
              placeholder="Focus on a topic..."
              placeholderTextColor={colors.textTertiary}
              value={topicInput}
              onChangeText={setTopicInput}
              onSubmitEditing={handleTopicSubmit}
              returnKeyType="search"
              maxLength={50}
            />
            {activeTopic ? (
              <Pressable onPress={handleTopicClear} style={styles.topicClear}>
                <Text style={styles.topicClearText}>{'\u2715'}</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Content */}
          <View style={styles.content}>
            {activeSection === 'forYou' ? (
              <InspireSwipeQuiz
                questions={forYouQuery.data ?? []}
                isLoading={forYouQuery.isLoading}
                onSelectTopic={handleSelectTopic}
                onLoadMore={() => handleLoadMore('forYou')}
              />
            ) : activeSection === 'trending' ? (
              <InspireTrendingList
                podcasts={trendingQuery.data ?? []}
                isLoading={trendingQuery.isLoading}
                onSelectTopic={handleSelectTopic}
              />
            ) : (
              <InspireSwipeQuiz
                questions={curiosityQuery.data ?? []}
                isLoading={curiosityQuery.isLoading}
                onSelectTopic={handleSelectTopic}
                onLoadMore={() => handleLoadMore('curiosity')}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  panel: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    flex: 1,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  title: {
    flex: 1,
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceHover,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pillRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  topicInput: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  topicClear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryLighter,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  topicClearText: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
});
