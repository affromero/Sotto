'use client';

import { useState, useCallback, useRef } from 'react';
import { useTrack } from '@/components/providers/EventProvider';
import { DiscoveryMessage, DiscoveryMetadata, DiscoveryState } from '@/types/discovery';

interface UseDiscoveryReturn {
  messages: DiscoveryMessage[];
  metadata: DiscoveryMetadata | null;
  isLoading: boolean;
  isComplete: boolean;
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const track = useTrack();
  const messageIndexRef = useRef(0);

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
        const body: Record<string, string> = { content };
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
                type: string;
                content?: string;
                chips?: string[];
                metadata?: Partial<DiscoveryMetadata>;
              };

              if (parsed.type === 'content' && parsed.content) {
                setState((prev) => ({
                  ...prev,
                  messages: prev.messages.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: msg.content + parsed.content }
                      : msg
                  ),
                }));
              }

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

                  // Emit metadata complete event when discovery finishes
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
        setState((prev) => ({ ...prev, isLoading: false }));
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
  }, []);

  return {
    messages: state.messages,
    metadata: state.metadata,
    isLoading: state.isLoading,
    isComplete: state.isComplete,
    sendMessage,
    reset,
  };
}
