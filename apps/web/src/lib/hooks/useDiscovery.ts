'use client';

import { useState, useCallback, useRef } from 'react';
import { useTrack } from '@/components/providers/EventProvider';
import { detectUrls } from '@/lib/detect-urls';
import { DiscoveryMessage, DiscoveryMetadata, DiscoveryState } from '@/types/discovery';

export interface LinkPreviewData {
  url: string;
  title: string | null;
  siteName: string | null;
  wordCount: number | null;
  isLoading: boolean;
}

interface UseDiscoveryReturn {
  messages: DiscoveryMessage[];
  metadata: DiscoveryMetadata | null;
  isLoading: boolean;
  isComplete: boolean;
  linkPreview: LinkPreviewData | null;
  sendMessage: (content: string, podcastId?: string, isChipBased?: boolean) => Promise<void>;
  reset: () => void;
}

const initialState: DiscoveryState = {
  messages: [],
  metadata: null,
  isLoading: false,
  isComplete: false,
};

export function useDiscovery(): UseDiscoveryReturn {
  const [state, setState] = useState<DiscoveryState>(initialState);
  const [linkPreview, setLinkPreview] = useState<LinkPreviewData | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const track = useTrack();
  const messageIndexRef = useRef(0);
  const messagesRef = useRef<DiscoveryMessage[]>([]);
  messagesRef.current = state.messages;

  const sendMessage = useCallback(
    async (content: string, podcastId?: string, isChipBased: boolean = false) => {
      const currentMessageIndex = messageIndexRef.current;
      messageIndexRef.current++;

      // Emit discovery message event
      track({
        eventType: 'discovery.message_sent',
        messageLength: content.length,
        messageIndex: currentMessageIndex,
        isChipBased,
      });

      // Add user message immediately
      const userMessage: DiscoveryMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        chips: [],
        createdAt: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isLoading: true,
      }));

      // Detect URLs and fetch preview
      const urls = detectUrls(content);
      if (urls.length > 0) {
        setLinkPreview({ url: urls[0], title: null, siteName: null, wordCount: null, isLoading: true });
        fetch('/api/discovery/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[0] }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) {
              setLinkPreview({
                url: urls[0],
                title: data.title,
                siteName: data.siteName,
                wordCount: data.wordCount,
                isLoading: false,
              });
            } else {
              setLinkPreview(null);
            }
          })
          .catch(() => setLinkPreview(null));
      }

      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Create a placeholder for the assistant message
      const assistantMessageId = `assistant-${Date.now()}`;
      const assistantMessage: DiscoveryMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        chips: [],
        createdAt: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      try {
        // Build conversation history from all prior messages (exclude the empty assistant placeholder)
        const history = messagesRef.current
          .filter((m) => m.id !== assistantMessageId && m.content)
          .map((m) => ({ role: m.role, content: m.content }));

        const body: Record<string, unknown> = { content, history };
        if (podcastId) {
          body.podcastId = podcastId;
        }

        const response = await fetch('/api/discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error('Failed to send discovery message');
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                text?: string;
                content?: string;
                chips?: string[];
                metadata?: Partial<DiscoveryMetadata>;
                done?: boolean;
                error?: string;
              };

              // Handle error events from the server
              if (parsed.error) {
                setState((prev) => ({
                  ...prev,
                  messages: prev.messages.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: parsed.error as string }
                      : msg
                  ),
                }));
                continue;
              }

              // Handle streaming text chunks
              const textChunk = parsed.text ?? parsed.content;
              if (textChunk && !parsed.done) {
                setState((prev) => ({
                  ...prev,
                  messages: prev.messages.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: msg.content + textChunk }
                      : msg
                  ),
                }));
              }

              // Handle completion with chips and metadata
              if (parsed.done) {
                if (parsed.chips) {
                  setState((prev) => ({
                    ...prev,
                    messages: prev.messages.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, chips: parsed.chips as string[] }
                        : msg
                    ),
                  }));
                }

                if (parsed.metadata) {
                  setState((prev) => {
                    const newMetadata = prev.metadata
                      ? { ...prev.metadata, ...parsed.metadata }
                      : ({
                          topic: '',
                          depth: 'standard',
                          audienceLevel: 'intermediate',
                          audience: 'general',
                          focusAreas: [],
                          tone: 'casual',
                          durationTarget: 10,
                          ready: false,
                          ...parsed.metadata,
                        } as DiscoveryMetadata);

                    const isComplete = parsed.metadata?.ready === true;

                    if (isComplete) {
                      track({
                        eventType: 'discovery.metadata_complete',
                        turnsCount: messageIndexRef.current,
                        topic: newMetadata.topic || '',
                        depth: newMetadata.depth || 'standard',
                        audience: newMetadata.audienceLevel || 'intermediate',
                        tone: newMetadata.tone || 'casual',
                        durationTarget: newMetadata.durationTarget || 10,
                      });
                    }

                    return {
                      ...prev,
                      metadata: newMetadata,
                      isComplete,
                    };
                  });
                }
              }

              // Legacy: handle type-based format
              if (parsed.type === 'chips' && parsed.chips) {
                setState((prev) => ({
                  ...prev,
                  messages: prev.messages.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, chips: parsed.chips as string[] }
                      : msg
                  ),
                }));
              }

              if (parsed.type === 'metadata' && parsed.metadata) {
                setState((prev) => {
                  const newMetadata = prev.metadata
                    ? { ...prev.metadata, ...parsed.metadata }
                    : ({
                        topic: '',
                        depth: 'standard',
                        audienceLevel: 'intermediate',
                        audience: 'general',
                        focusAreas: [],
                        tone: 'casual',
                        durationTarget: 10,
                        ready: false,
                        ...parsed.metadata,
                      } as DiscoveryMetadata);

                  const isComplete = parsed.metadata?.ready === true;

                  if (isComplete) {
                    track({
                      eventType: 'discovery.metadata_complete',
                      turnsCount: messageIndexRef.current,
                      topic: newMetadata.topic || '',
                      depth: newMetadata.depth || 'standard',
                      audience: newMetadata.audienceLevel || 'intermediate',
                      tone: newMetadata.tone || 'casual',
                      durationTarget: newMetadata.durationTarget || 10,
                    });
                  }

                  return {
                    ...prev,
                    metadata: newMetadata,
                    isComplete,
                  };
                });
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }

        // Remove the empty assistant message on error
        setState((prev) => ({
          ...prev,
          messages: prev.messages.filter((msg) => msg.id !== assistantMessageId),
        }));
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }

        // If streaming completed but assistant message is still empty, show fallback
        setState((prev) => {
          const assistantMsg = prev.messages.find((msg) => msg.id === assistantMessageId);
          if (assistantMsg && !assistantMsg.content) {
            return {
              ...prev,
              isLoading: false,
              messages: prev.messages.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: "I couldn't generate a response. Please try again." }
                  : msg
              ),
            };
          }
          return { ...prev, isLoading: false };
        });
      }
    },
    [track]
  );

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    messageIndexRef.current = 0;
    setState(initialState);
    setLinkPreview(null);
  }, []);

  return {
    messages: state.messages,
    metadata: state.metadata,
    isLoading: state.isLoading,
    isComplete: state.isComplete,
    linkPreview,
    sendMessage,
    reset,
  };
}
