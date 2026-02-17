import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { DiscoveryMetadata } from '@sotto/shared';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { api } from '../../lib/api';
import { SwipeQuiz } from '../../components/SwipeQuiz';

interface KeyStatus {
  provider: string;
  configured: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips: string[];
}

interface DiscoveryResponse {
  discoveryId: string;
  message: string;
  chips: string[];
  metadata: DiscoveryMetadata | null;
}

interface CreatePodcastResponse {
  id: string;
  title: string;
  status: string;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <View
      style={[
        styles.bubbleContainer,
        isUser ? styles.bubbleContainerUser : styles.bubbleContainerAssistant,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
          ]}
        >
          {message.content}
        </Text>
      </View>
    </View>
  );
}

export default function CreateScreen() {
  const router = useRouter();
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [latestChips, setLatestChips] = useState<string[]>([]);
  const [showQuiz, setShowQuiz] = useState(false);
  const topicHandled = useRef(false);

  const { data: aiKeys } = useQuery<{ keys: KeyStatus[] }>({
    queryKey: ['settings', 'ai-keys'],
    queryFn: async () => {
      const res = await api.get('/settings/ai-keys');
      return res.data;
    },
  });

  const { data: ttsKeys } = useQuery<{ keys: KeyStatus[] }>({
    queryKey: ['settings', 'byok'],
    queryFn: async () => {
      const res = await api.get('/settings/byok');
      return res.data;
    },
  });

  const hasAiKey = aiKeys?.keys?.some((k) => k.configured) ?? false;
  const hasTtsKey = ttsKeys?.keys?.some((k) => k.configured) ?? false;
  const missingKeys = !hasAiKey || !hasTtsKey;

  const discoveryMutation = useMutation<DiscoveryResponse, Error, string>({
    mutationFn: async (userMessage: string) => {
      const response = await api.post<DiscoveryResponse>('/discovery', {
        message: userMessage,
        discoveryId,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setDiscoveryId(data.discoveryId);
      setMetadata(data.metadata);
      setLatestChips(data.chips);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        chips: data.chips,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    },
  });

  const createMutation = useMutation<CreatePodcastResponse, Error>({
    mutationFn: async () => {
      const response = await api.post<CreatePodcastResponse>('/podcasts', {
        title: metadata?.topic ?? 'Untitled Podcast',
        topic: metadata?.topic ?? '',
        discoveryId,
      });
      return response.data;
    },
    onSuccess: (data) => {
      router.push(`/podcast/${data.id}`);
    },
  });

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || discoveryMutation.isPending) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        chips: [],
      };
      setMessages((prev) => [...prev, userMessage]);
      setInputText('');
      setLatestChips([]);
      discoveryMutation.mutate(trimmed);
    },
    [discoveryMutation],
  );

  useEffect(() => {
    if (topic && !topicHandled.current) {
      topicHandled.current = true;
      setShowQuiz(false);
      sendMessage(topic);
    }
  }, [topic, sendMessage]);

  const handleSend = useCallback(() => {
    sendMessage(inputText);
  }, [inputText, sendMessage]);

  const handleChipPress = useCallback(
    (chip: string) => {
      sendMessage(chip);
    },
    [sendMessage],
  );

  const handleCreate = useCallback(() => {
    if (!createMutation.isPending) {
      createMutation.mutate();
    }
  }, [createMutation]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => <MessageBubble message={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: ChatMessage) => item.id,
    [],
  );

  const isReady = metadata?.ready === true;
  const isDiscovering = discoveryMutation.isPending;
  const isCreating = createMutation.isPending;

  const inspirePulse = useSharedValue(0);

  useEffect(() => {
    inspirePulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [inspirePulse]);

  const inspireAnimatedStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.15 + inspirePulse.value * 0.25,
    shadowRadius: 4 + inspirePulse.value * 10,
    transform: [{ scale: 1 + inspirePulse.value * 0.02 }],
  }));

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      {messages.length === 0 && showQuiz ? (
        <View style={styles.quizContainer}>
          {missingKeys && (
            <Pressable
              style={styles.keyWarning}
              onPress={() => router.push('/settings/api-keys')}
            >
              <Text style={styles.keyWarningText}>
                {!hasAiKey && !hasTtsKey
                  ? 'Add AI and TTS API keys to create podcasts'
                  : !hasAiKey
                    ? 'Add an AI provider key to create podcasts'
                    : 'Add a TTS provider key to create podcasts'}
              </Text>
              <Text style={styles.keyWarningLink}>Add keys {'\u203A'}</Text>
            </Pressable>
          )}
          <SwipeQuiz
            onComplete={() => setShowQuiz(false)}
            onSelectTopic={(questionText) => {
              setShowQuiz(false);
              sendMessage(questionText);
            }}
          />
          <Pressable
            style={styles.skipButton}
            onPress={() => setShowQuiz(false)}
          >
            <Text style={styles.skipButtonText}>Skip to chat</Text>
          </Pressable>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.welcomeContainer}>
          {missingKeys && (
            <Pressable
              style={styles.keyWarning}
              onPress={() => router.push('/settings/api-keys')}
            >
              <Text style={styles.keyWarningText}>
                {!hasAiKey && !hasTtsKey
                  ? 'Add AI and TTS API keys to create podcasts'
                  : !hasAiKey
                    ? 'Add an AI provider key to create podcasts'
                    : 'Add a TTS provider key to create podcasts'}
              </Text>
              <Text style={styles.keyWarningLink}>Add keys {'\u203A'}</Text>
            </Pressable>
          )}
          <Text style={styles.welcomeTitle}>Create a Podcast</Text>
          <Text style={styles.welcomeSubtitle}>
            Tell me what you want to learn about. I will ask a few questions to
            understand your interests, then generate a conversational podcast
            just for you.
          </Text>
          <Animated.View style={[styles.inspireMeGlow, inspireAnimatedStyle]}>
            <Pressable
              style={({ pressed }) => [
                styles.inspireMeButton,
                pressed && styles.inspireMeButtonPressed,
              ]}
              onPress={() => setShowQuiz(true)}
            >
              <Text style={styles.inspireMeIcon}>{'\u2728'}</Text>
              <Text style={styles.inspireMeButtonText}>Inspire me</Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListFooterComponent={
            <>
              {isDiscovering ? (
                <View style={styles.typingIndicator}>
                  <View style={styles.typingDot} />
                  <View style={[styles.typingDot, styles.typingDotDelay1]} />
                  <View style={[styles.typingDot, styles.typingDotDelay2]} />
                </View>
              ) : null}

              {latestChips.length > 0 && !isDiscovering ? (
                <View style={styles.chipContainer}>
                  {latestChips.map((chip) => (
                    <Pressable
                      key={chip}
                      style={({ pressed }) => [
                        styles.chip,
                        pressed && styles.chipPressed,
                      ]}
                      onPress={() => handleChipPress(chip)}
                    >
                      <Text style={styles.chipText}>{chip}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {isReady && !isDiscovering ? (
                <View style={styles.readyContainer}>
                  <View style={styles.readyCard}>
                    <Text style={styles.readyTitle}>Ready to create</Text>
                    <Text style={styles.readySubtitle}>
                      {metadata?.topic ?? 'Your podcast'}
                    </Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.createButton,
                        pressed && !missingKeys && styles.createButtonPressed,
                        (isCreating || missingKeys) && styles.createButtonDisabled,
                      ]}
                      onPress={missingKeys ? () => router.push('/settings/api-keys') : handleCreate}
                      disabled={isCreating}
                    >
                      {isCreating ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.textInverse}
                        />
                      ) : missingKeys ? (
                        <Text style={styles.createButtonText}>
                          Add API Keys to Create
                        </Text>
                      ) : (
                        <Text style={styles.createButtonText}>
                          Create Podcast
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {discoveryMutation.isError ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>
                    {discoveryMutation.error.message ?? 'Something went wrong'}
                  </Text>
                  <Pressable
                    style={styles.retryLink}
                    onPress={() =>
                      discoveryMutation.mutate(
                        messages[messages.length - 1]?.content ?? '',
                      )
                    }
                  >
                    <Text style={styles.retryLinkText}>Tap to retry</Text>
                  </Pressable>
                </View>
              ) : null}

              {createMutation.isError ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>
                    Failed to create podcast.{' '}
                    {createMutation.error.message ?? ''}
                  </Text>
                  <Pressable style={styles.retryLink} onPress={handleCreate}>
                    <Text style={styles.retryLinkText}>Tap to retry</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          }
        />
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="Describe what you want to learn..."
          placeholderTextColor={colors.textTertiary}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!isDiscovering && !isCreating}
          multiline
          maxLength={1000}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.sendButtonPressed,
            (!inputText.trim() || isDiscovering) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!inputText.trim() || isDiscovering}
        >
          <Text style={styles.sendButtonIcon}>&#8593;</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  quizContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  skipButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  keyWarning: {
    backgroundColor: colors.warningLighter,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  keyWarningText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.warning,
    flex: 1,
    lineHeight: 18,
  },
  keyWarningLink: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  welcomeTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 32,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  welcomeSubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  inspireMeGlow: {
    alignSelf: 'flex-start',
    borderRadius: borderRadius.full,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
  },
  inspireMeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  inspireMeButtonPressed: {
    backgroundColor: colors.primaryLighter,
  },
  inspireMeIcon: {
    fontSize: 16,
  },
  inspireMeButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  messageList: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  bubbleContainer: {
    marginBottom: spacing.sm + 2,
    maxWidth: '80%',
  },
  bubbleContainerUser: {
    alignSelf: 'flex-end',
  },
  bubbleContainerAssistant: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: borderRadius.sm,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bubbleText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: colors.textInverse,
  },
  bubbleTextAssistant: {
    color: colors.textPrimary,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    gap: 6,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
    opacity: 0.4,
  },
  typingDotDelay1: {
    opacity: 0.6,
  },
  typingDotDelay2: {
    opacity: 0.8,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chip: {
    backgroundColor: colors.primaryLighter,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  chipPressed: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  readyContainer: {
    paddingVertical: spacing.md,
  },
  readyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
  },
  readyTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  readySubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    minWidth: 180,
    alignItems: 'center',
  },
  createButtonPressed: {
    backgroundColor: colors.primaryHover,
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  errorContainer: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
  },
  retryLink: {
    marginTop: spacing.xs,
    padding: spacing.xs,
  },
  retryLinkText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  textInput: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.sm + 4,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  sendButtonPressed: {
    backgroundColor: colors.primaryHover,
  },
  sendButtonDisabled: {
    backgroundColor: colors.textTertiary,
    opacity: 0.5,
  },
  sendButtonIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textInverse,
  },
});
