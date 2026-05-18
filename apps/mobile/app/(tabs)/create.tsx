import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowPrimaryGlow } from '../../lib/shadows';
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
import { getApiBaseUrl } from '../../lib/config';
import { getToken } from '../../lib/auth';
import { InspireMe } from '../../components/InspireMe';
import { AiModelSelector } from '../../components/AiModelSelector';
import { TtsModelSelector } from '../../components/TtsModelSelector';
import { VoicePickerSheet } from '../../components/VoicePickerSheet';
import { DurationPicker } from '../../components/DurationPicker';
import { VisibilityPicker } from '../../components/VisibilityPicker';
import { GenerationProgress } from '../../components/GenerationProgress';
import { ScriptPreview } from '../../components/ScriptPreview';
import { DraftsList } from '../../components/DraftsList';
import { ScriptEditor } from '../../components/ScriptEditor';
import { DiscoveryParamsCard } from '../../components/DiscoveryParamsCard';
import { setItemAsync, getItemAsync, deleteItemAsync } from 'expo-secure-store';

type Step = 'discovery' | 'voice' | 'scripting' | 'script-preview' | 'generating';

const STEP_TITLES: Record<Step, string> = {
  discovery: 'Create',
  voice: 'Choose Voices',
  scripting: 'Generating Script',
  'script-preview': 'Review Script',
  generating: 'Generating Audio',
};

interface KeyStatus {
  provider: string;
  isValid: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips: string[];
}

interface CreatePodcastResponse {
  id: string;
  title: string;
  status: string;
}

interface PodcastStatusResponse {
  status: string;
}

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content:
    "Hi! I'm here to help you create the perfect podcast. What topic would you like to explore? You can also paste a URL — articles, YouTube videos, and more.",
  chips: ['AI & Technology', 'Science', 'History', 'Business', 'Philosophy'],
};

const API_BASE = getApiBaseUrl();

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <View
      style={[
        styles.bubbleContainer,
        isUser ? styles.bubbleContainerUser : styles.bubbleContainerAssistant,
      ]}
    >
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text
          style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}
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

  // Step state machine
  const [step, setStep] = useState<Step>('discovery');
  const [podcastId, setPodcastId] = useState<string | null>(null);
  const [scriptEditorVisible, setScriptEditorVisible] = useState(false);
  const [scriptTurns, setScriptTurns] = useState<
    { speaker: string; text: string; direction?: string }[]
  >([]);

  // Discovery state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [latestChips, setLatestChips] = useState<string[]>([]);
  const [showInspire, setShowInspire] = useState(false);
  const topicHandled = useRef(false);

  // Creation options state
  const [voiceSelection, setVoiceSelection] = useState<{
    voices?: Array<{ speaker: string; voiceId: string }>;
  }>({});
  const [ttsProvider, setTtsProvider] = useState<string | undefined>();
  const [ttsModel, setTtsModel] = useState<string | undefined>();
  const [aiModel, setAiModel] = useState<string | undefined>();
  const [durationTarget, setDurationTarget] = useState(10);
  const [visibility, setVisibility] = useState<'PUBLIC' | 'UNLISTED' | 'PRIVATE'>('PRIVATE');

  // User tier → maxSpeakers
  const { data: billingData } = useQuery<{ tier: string }>({
    queryKey: ['billing', 'usage'],
    queryFn: async () => {
      const res = await api.get('/billing/usage');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const maxSpeakers = billingData?.tier === 'PRO' ? 4 : 2;

  // Persist creation state to survive app background/kill
  const CREATION_STATE_KEY = 'sotto:creationState';

  useEffect(() => {
    if (step === 'discovery' || !podcastId) return;
    const state = JSON.stringify({ podcastId, step, topic: metadata?.topic });
    setItemAsync(CREATION_STATE_KEY, state).catch(() => {});
  }, [step, podcastId, metadata?.topic]);

  // On mount, check for pending creation
  useEffect(() => {
    (async () => {
      try {
        const saved = await getItemAsync(CREATION_STATE_KEY);
        if (!saved) return;
        const state = JSON.parse(saved) as { podcastId: string; step: Step; topic?: string };
        if (state.podcastId && (state.step === 'scripting' || state.step === 'generating')) {
          Alert.alert(
            'Resume creation?',
            `You have a podcast "${state.topic ?? 'Untitled'}" still generating. Resume?`,
            [
              {
                text: 'Discard',
                style: 'destructive',
                onPress: () => deleteItemAsync(CREATION_STATE_KEY).catch(() => {}),
              },
              {
                text: 'Resume',
                onPress: () => {
                  setPodcastId(state.podcastId);
                  setStep(state.step);
                },
              },
            ]
          );
        }
      } catch {
        // Silent fail
      }
    })();
  }, []);

  // Clear persisted state when creation completes
  useEffect(() => {
    if (step === 'discovery' && !podcastId) {
      deleteItemAsync(CREATION_STATE_KEY).catch(() => {});
    }
  }, [step, podcastId]);

  // Key status queries
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

  const hasAiKey = aiKeys?.keys?.some((k) => k.isValid) ?? false;
  const hasTtsKey = ttsKeys?.keys?.some((k) => k.isValid) ?? false;
  const missingKeys = !hasAiKey || !hasTtsKey;

  // Pipeline status polling
  const { data: pipelineStatus } = useQuery<PodcastStatusResponse>({
    queryKey: ['podcast-status', podcastId],
    queryFn: async () => {
      const res = await api.get(`/podcasts/${podcastId}`);
      return res.data;
    },
    enabled: !!podcastId && (step === 'scripting' || step === 'generating'),
    refetchInterval: 3000,
  });

  // Advance steps based on pipeline status
  useEffect(() => {
    if (!pipelineStatus) return;
    const status = pipelineStatus.status;

    if (step === 'scripting') {
      if (status === 'SCRIPT_READY') {
        setStep('script-preview');
      } else if (status === 'FAILED') {
        Alert.alert('Generation Failed', 'Script generation failed. Please try again.', [
          { text: 'Back', onPress: () => setStep('voice') },
        ]);
      }
    } else if (step === 'generating') {
      if (status === 'READY') {
        router.push(`/podcast/${podcastId}`);
      } else if (status === 'FAILED') {
        Alert.alert('Generation Failed', 'Audio generation failed. Please try again.', [
          { text: 'Back', onPress: () => setStep('script-preview') },
        ]);
      }
    }
  }, [pipelineStatus, step, podcastId, router]);

  // SSE-based discovery streaming
  const [isDiscoveringSSE, setIsDiscoveringSSE] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const streamDiscovery = useCallback(
    async (userMessage: string) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsDiscoveringSSE(true);
      setDiscoveryError(null);

      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', chips: [] },
      ]);

      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/discovery`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message: userMessage,
            history: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            model: aiModel,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Server error ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            try {
              const parsed = JSON.parse(json);

              if (parsed.error) {
                const errMsg = parsed.requestId
                  ? `${parsed.error} (${parsed.requestId})`
                  : parsed.error;
                setDiscoveryError(errMsg);
                break;
              }

              if (parsed.text) {
                accumulated += parsed.text;
                const text = accumulated;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))
                );
              }

              if (parsed.done) {
                if (parsed.metadata) setMetadata(parsed.metadata);
                const chips: string[] = parsed.chips ?? [];
                setLatestChips(chips);
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, chips } : m))
                );
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Intentional cancel — remove empty placeholder
          setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
          return;
        }
        setDiscoveryError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setIsDiscoveringSSE(false);
        abortRef.current = null;
      }
    },
    [messages, aiModel]
  );

  // Create mutation — full payload matching web
  const createMutation = useMutation<CreatePodcastResponse, Error>({
    mutationFn: async () => {
      const response = await api.post<CreatePodcastResponse>('/podcasts', {
        title: metadata?.topic ?? 'Untitled Podcast',
        topic: metadata?.topic ?? '',
        metadata: metadata
          ? {
              topic: metadata.topic ?? '',
              depth: metadata.depth,
              audienceLevel: metadata.audienceLevel,
              audience: metadata.audience,
              focusAreas: metadata.focusAreas,
              tone: metadata.tone,
              durationTarget,
            }
          : undefined,
        voices: voiceSelection.voices,
        ttsProvider,
        ttsModel,
        aiModel,
        visibility,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setPodcastId(data.id);
      setStep('scripting');
    },
    onError: (error: Error & { response?: { status: number } }) => {
      if (error.response?.status === 402) {
        Alert.alert(
          'Voice Payment Required',
          'This voice requires payment. Please use the web app to complete the purchase.',
          [{ text: 'OK' }]
        );
      }
    },
  });

  // Script approve mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/podcasts/${podcastId}/script/approve`);
    },
    onSuccess: () => {
      setStep('generating');
    },
    onError: () => {
      Alert.alert('Error', 'Could not approve script. Please try again.');
    },
  });

  // Script regenerate mutation
  const regenerateMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/podcasts/${podcastId}/script/regenerate`);
    },
    onSuccess: () => {
      setStep('scripting');
    },
    onError: () => {
      Alert.alert('Error', 'Could not regenerate script. Please try again.');
    },
  });

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isDiscoveringSSE) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        chips: [],
      };
      setMessages((prev) => [...prev, userMessage]);
      setInputText('');
      setLatestChips([]);
      streamDiscovery(trimmed);
    },
    [isDiscoveringSSE, streamDiscovery]
  );

  useEffect(() => {
    if (topic && !topicHandled.current) {
      topicHandled.current = true;
      setShowInspire(false);
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
    [sendMessage]
  );

  const handleNextToVoice = useCallback(() => {
    setStep('voice');
  }, []);

  const handleGenerateScript = useCallback(() => {
    if (!createMutation.isPending) {
      createMutation.mutate();
    }
  }, [createMutation]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => <MessageBubble message={item} />,
    []
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const isReady = metadata?.ready === true;
  const isDiscovering = isDiscoveringSSE;
  const displayMessages = messages.length === 0 ? [GREETING] : [GREETING, ...messages];

  const inspirePulse = useSharedValue(0);

  useEffect(() => {
    inspirePulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [inspirePulse]);

  const inspireAnimatedStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.15 + inspirePulse.value * 0.25,
    shadowRadius: 4 + inspirePulse.value * 10,
    transform: [{ scale: 1 + inspirePulse.value * 0.02 }],
  }));

  const handleBack = useCallback(() => {
    if (step === 'voice') setStep('discovery');
    else if (step === 'script-preview') setStep('voice');
  }, [step]);

  // Discovery step content
  function renderDiscoveryStep() {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={88}
      >
        {renderKeyWarning()}
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            messages.length === 0 ? (
              <>
                <DraftsList
                  onResume={async (draftId) => {
                    try {
                      const res = await api.get(`/drafts/${draftId}`);
                      const draft = res.data;
                      if (draft.discovery?.messages) {
                        setMessages(
                          draft.discovery.messages.map(
                            (m: { role: string; content: string; chips?: string[] }) => ({
                              id: m.role + Math.random(),
                              role: m.role as 'user' | 'assistant',
                              content: m.content,
                              chips: m.chips,
                            })
                          )
                        );
                      }
                      if (draft.discovery) {
                        setMetadata({
                          topic: draft.discovery.topic,
                          depth: draft.discovery.depth,
                          audienceLevel: draft.discovery.audienceLevel,
                          audience: draft.discovery.audience,
                          focusAreas: draft.discovery.focusAreas,
                          tone: draft.discovery.tone,
                          durationTarget: draft.discovery.durationTarget,
                          speakers: draft.discovery.speakers,
                        } as DiscoveryMetadata);
                      }
                      setPodcastId(draftId);
                    } catch {
                      Alert.alert('Error', 'Failed to load draft.');
                    }
                  }}
                />
                <View style={styles.greetingChipsContainer}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipScrollContent}
                  >
                    {GREETING.chips.map((chip) => (
                      <Pressable
                        key={chip}
                        testID={`create-chip-${chip}`}
                        style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                        onPress={() => handleChipPress(chip)}
                      >
                        <Text style={styles.chipText}>{chip}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Animated.View style={[styles.inspireMeGlow, inspireAnimatedStyle]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.inspireMeButton,
                        pressed && styles.inspireMeButtonPressed,
                      ]}
                      onPress={() => setShowInspire(true)}
                      testID="create-inspire-button"
                    >
                      <Ionicons name="sparkles" size={16} color={colors.primary} />
                      <Text style={styles.inspireMeButtonText}>Inspire me</Text>
                    </Pressable>
                  </Animated.View>
                </View>
              </>
            ) : null
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

              {latestChips.length > 0 && !isDiscovering && messages.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipScrollContent}
                  style={styles.chipScrollView}
                >
                  {latestChips.map((chip) => (
                    <Pressable
                      key={chip}
                      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                      onPress={() => handleChipPress(chip)}
                    >
                      <Text style={styles.chipText}>{chip}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}

              {isReady && !isDiscovering ? (
                <View style={styles.readyContainer}>
                  <View style={styles.readyCard} testID="create-ready-card">
                    <Text style={styles.readyTitle}>Ready to create</Text>
                    <Text style={styles.readySubtitle}>{metadata?.topic ?? 'Your podcast'}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.createButton,
                        pressed && !missingKeys && styles.createButtonPressed,
                        missingKeys && styles.createButtonDisabled,
                      ]}
                      onPress={
                        missingKeys ? () => router.push('/settings/api-keys') : handleNextToVoice
                      }
                      testID="create-next-voices-button"
                    >
                      <Text style={styles.createButtonText}>
                        {missingKeys ? 'Add API Keys to Create' : 'Next: Choose Voices'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {discoveryError ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{discoveryError}</Text>
                  <Pressable
                    style={styles.retryLink}
                    onPress={() => {
                      setDiscoveryError(null);
                      const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
                      if (lastUserMsg) streamDiscovery(lastUserMsg.content);
                    }}
                  >
                    <Text style={styles.retryLinkText}>Tap to retry</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          }
        />

        <View style={styles.inputContainer}>
          <AiModelSelector value={aiModel} onChange={setAiModel} />
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              placeholder="Describe what you want to hear..."
              placeholderTextColor={colors.textTertiary}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              editable={!isDiscovering}
              multiline
              maxLength={1000}
              testID="create-chat-input"
            />
            <Pressable
              style={({ pressed }) => [
                styles.sendButton,
                inputText.trim() && !isDiscovering && styles.sendButtonGlow,
                pressed && styles.sendButtonPressed,
                (!inputText.trim() || isDiscovering) && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={!inputText.trim() || isDiscovering}
              testID="create-send-button"
            >
              <Ionicons name="arrow-up" size={20} color={colors.textInverse} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Voice step content
  function renderVoiceStep() {
    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.voiceScrollView}
          contentContainerStyle={styles.voiceScrollContent}
        >
          <Text style={styles.sectionTitle}>{metadata?.topic ?? 'Your Podcast'}</Text>

          {metadata && (
            <View style={styles.voiceSection}>
              <DiscoveryParamsCard
                metadata={metadata}
                onUpdate={(patch) => setMetadata((prev) => (prev ? { ...prev, ...patch } : prev))}
              />
            </View>
          )}

          <View style={styles.voiceSection}>
            <VoicePickerSheet
              onSelectionChange={setVoiceSelection}
              suggestedFormat={metadata?.suggestedFormat}
              ttsProvider={ttsProvider}
              maxSpeakers={maxSpeakers}
            />
          </View>

          <View style={styles.voiceSection}>
            <Text style={styles.sectionLabel}>TTS Provider</Text>
            <TtsModelSelector
              ttsProvider={ttsProvider}
              ttsModel={ttsModel}
              onChange={(p, m) => {
                setTtsProvider(p);
                setTtsModel(m);
              }}
            />
          </View>

          <View style={styles.voiceSection}>
            <DurationPicker value={durationTarget} onChange={setDurationTarget} />
          </View>

          <View style={styles.voiceSection}>
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          </View>
        </ScrollView>

        <View style={styles.voiceFooter}>
          <Pressable
            style={styles.backButton}
            onPress={handleBack}
            testID="create-voice-back-button"
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.generateButton,
              pressed && styles.generateButtonPressed,
              createMutation.isPending && styles.generateButtonDisabled,
            ]}
            onPress={handleGenerateScript}
            disabled={createMutation.isPending}
            testID="create-generate-script-button"
          >
            {createMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.generateButtonText}>Generate Script</Text>
            )}
          </Pressable>
        </View>

        {createMutation.isError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              {createMutation.error.message ?? 'Failed to start generation'}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Scripting step content
  function renderScriptingStep() {
    return (
      <View style={styles.pipelineContainer}>
        <Text style={styles.pipelineTitle}>{metadata?.topic ?? 'Your Podcast'}</Text>
        <GenerationProgress
          status={pipelineStatus?.status ?? 'EXTRACTING'}
          topic={metadata?.topic}
        />
        <Text style={styles.pipelineHint}>
          This usually takes 1-2 minutes. You can leave this screen and come back.
        </Text>
      </View>
    );
  }

  // Script preview step content
  function renderScriptPreviewStep() {
    if (!podcastId) return null;
    return (
      <>
        <ScriptPreview
          podcastId={podcastId}
          onApprove={() => approveMutation.mutate()}
          onRegenerate={() => regenerateMutation.mutate()}
          onEdit={(turns) => {
            setScriptTurns(turns);
            setScriptEditorVisible(true);
          }}
        />
        <ScriptEditor
          visible={scriptEditorVisible}
          onClose={() => setScriptEditorVisible(false)}
          podcastId={podcastId}
          turns={scriptTurns}
        />
      </>
    );
  }

  // Generating step content
  function renderGeneratingStep() {
    return (
      <View style={styles.pipelineContainer}>
        <Text style={styles.pipelineTitle}>{metadata?.topic ?? 'Your Podcast'}</Text>
        <GenerationProgress
          status={pipelineStatus?.status ?? 'GENERATING_AUDIO'}
          topic={metadata?.topic}
        />
        <Text style={styles.pipelineHint}>Generating audio for each segment. Almost there!</Text>
      </View>
    );
  }

  function renderKeyWarning() {
    if (!missingKeys) return null;
    return (
      <Pressable style={styles.keyWarning} onPress={() => router.push('/settings/api-keys')}>
        <Text style={styles.keyWarningText}>
          {!hasAiKey && !hasTtsKey
            ? 'Add AI and TTS API keys to create podcasts'
            : !hasAiKey
              ? 'Add an AI provider key to create podcasts'
              : 'Add a TTS provider key to create podcasts'}
        </Text>
        <View style={styles.keyWarningLinkRow}>
          <Text style={styles.keyWarningLink}>Add keys</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </View>
      </Pressable>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: STEP_TITLES[step],
          headerLeft:
            step === 'voice' || step === 'script-preview'
              ? () => (
                  <Pressable
                    onPress={handleBack}
                    style={styles.headerBack}
                    accessibilityLabel="Go back"
                  >
                    <Ionicons name="chevron-back" size={24} color={colors.primary} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      {step === 'discovery' && renderDiscoveryStep()}
      {step === 'voice' && renderVoiceStep()}
      {step === 'scripting' && renderScriptingStep()}
      {step === 'script-preview' && renderScriptPreviewStep()}
      {step === 'generating' && renderGeneratingStep()}
      <InspireMe
        visible={showInspire}
        onClose={() => setShowInspire(false)}
        onSelectTopic={(topic) => {
          setShowInspire(false);
          sendMessage(topic);
        }}
      />
    </>
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
  greetingChipsContainer: {
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  keyWarning: {
    backgroundColor: colors.warningLighter,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
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
  keyWarningLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  keyWarningLink: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  inspireMeGlow: {
    alignSelf: 'center',
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
  chipScrollView: {
    marginBottom: spacing.sm,
  },
  chipScrollContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
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
  sendButtonGlow: {
    ...shadowPrimaryGlow,
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
  // Voice step styles
  voiceScrollView: {
    flex: 1,
  },
  voiceScrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
  },
  sectionLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  voiceSection: {
    gap: spacing.xs,
  },
  voiceFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  backButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  backButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  generateButton: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  generateButtonPressed: {
    backgroundColor: colors.primaryHover,
  },
  generateButtonDisabled: {
    opacity: 0.7,
  },
  generateButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
  errorBanner: {
    backgroundColor: colors.errorLighter,
    padding: spacing.md,
  },
  errorBannerText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
  // Pipeline step styles
  pipelineContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pipelineTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  pipelineHint: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  // Header back button
  headerBack: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerBackText: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: '300',
  },
});
