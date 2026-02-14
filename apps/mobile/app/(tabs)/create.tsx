import { useState, useRef, useCallback } from 'react';
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
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { DiscoveryMetadata } from '@sotto/shared';
import { api } from '../../lib/api';

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
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [latestChips, setLatestChips] = useState<string[]>([]);

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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      {messages.length === 0 ? (
        <View style={styles.welcomeContainer}>
          <Text style={styles.welcomeTitle}>Create a Podcast</Text>
          <Text style={styles.welcomeSubtitle}>
            Tell me what you want to learn about. I will ask a few questions to
            understand your interests, then generate a conversational podcast
            just for you.
          </Text>
          <View style={styles.welcomeChips}>
            {[
              'Quantum computing explained simply',
              'The history of jazz music',
              'How does the stock market work?',
              'Space exploration in 2025',
            ].map((suggestion) => (
              <Pressable
                key={suggestion}
                style={({ pressed }) => [
                  styles.welcomeChip,
                  pressed && styles.welcomeChipPressed,
                ]}
                onPress={() => sendMessage(suggestion)}
              >
                <Text style={styles.welcomeChipText}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
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
                        pressed && styles.createButtonPressed,
                        isCreating && styles.createButtonDisabled,
                      ]}
                      onPress={handleCreate}
                      disabled={isCreating}
                    >
                      {isCreating ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.textInverse}
                        />
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
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
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
  welcomeChips: {
    gap: spacing.sm,
  },
  welcomeChip: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  welcomeChipPressed: {
    backgroundColor: colors.primaryLighter,
    borderColor: colors.primary,
  },
  welcomeChipText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
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
