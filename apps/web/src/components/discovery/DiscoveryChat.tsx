'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryMessage } from '@/types/discovery';
import type { DiscoveryMetadata } from '@/types/discovery';
import { useDiscovery } from '@/lib/hooks/useDiscovery';
import { SuggestionChips } from './SuggestionChips';
import { DiscoveryParamsCard } from './DiscoveryParamsCard';
import { LanguageBanner } from './LanguageBanner';
import { LlmModelDropdown } from '@/components/create/LlmModelDropdown';
import styles from './DiscoveryChat.module.css';

interface DiscoveryChatProps {
  podcastId?: string;
  onComplete: (metadata: DiscoveryMetadata) => void;
  initialTopic?: string;
  aiModel?: string;
  onAiModelChange?: (model: string | undefined) => void;
  isByokUser?: boolean;
  initialDraftId?: string;
  initialMessages?: DiscoveryMessage[];
  onDraftCreated?: (id: string) => void;
  maxDuration?: number;
}

const GREETING: DiscoveryMessage = {
  id: 'greeting',
  role: 'assistant',
  content:
    "Hi! I'm here to help you create the perfect podcast. What topic would you like to explore? You can also paste a URL — articles, YouTube videos, and more.",
  chips: ['AI & Technology', 'Science', 'History', 'Business', 'Philosophy'],
  createdAt: new Date(0).toISOString(),
};

export function DiscoveryChat({ podcastId, onComplete, initialTopic, aiModel, onAiModelChange, initialDraftId, initialMessages, onDraftCreated, maxDuration }: DiscoveryChatProps) {
  const { messages, metadata, isLoading, sendMessage, draftId, detectedLanguage, updateMetadata } = useDiscovery(initialDraftId, initialMessages, maxDuration);
  const prevDraftIdRef = useRef<string | null>(initialDraftId ?? null);
  const [inputValue, setInputValue] = useState('');
  const [languageBannerDismissed, setLanguageBannerDismissed] = useState(false);
  const initialTopicSentRef = useRef(false);
  const prevIsLoadingRef = useRef(isLoading);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayMessages = messages.length === 0 ? [GREETING] : [GREETING, ...messages];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Refocus input when response completes
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      inputRef.current?.focus();
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  // Notify parent when draft is created
  useEffect(() => {
    if (draftId && !prevDraftIdRef.current) {
      onDraftCreated?.(draftId);
    }
    prevDraftIdRef.current = draftId;
  }, [draftId, onDraftCreated]);

  // Auto-send initialTopic from Inspire Me or URL param
  useEffect(() => {
    if (initialTopic && !initialTopicSentRef.current) {
      initialTopicSentRef.current = true;
      sendMessage(initialTopic, podcastId, false, aiModel);
    }
  }, [initialTopic, sendMessage, podcastId, aiModel]);

  const handleSend = useCallback(
    (content: string, isChipBased = false) => {
      if (!content.trim() || isLoading) return;
      setInputValue('');
      sendMessage(content, podcastId, isChipBased, aiModel);
    },
    [isLoading, sendMessage, podcastId, aiModel]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputValue);
    }
  };

  const handleChipSelect = (chip: string) => {
    handleSend(chip, true);
  };

  const handleGenerate = () => {
    if (metadata?.ready) {
      onComplete(metadata);
    }
  };

  return (
    <div className={styles.root} role="region" aria-label="Discovery chat">
      {/* Messages area */}
      <div className={styles.messages} role="log" aria-live="polite">
        {displayMessages.map((message, index) => {
          const isUser = message.role === 'user';
          const isLastAssistant =
            message.role === 'assistant' &&
            (index === displayMessages.length - 1 ||
              displayMessages.slice(index + 1).every((m) => m.role === 'user'));

          // Skip empty assistant placeholders while loading — typing indicator handles this
          if (!isUser && !message.content && isLoading) return null;

          return (
            <div key={message.id} className={styles.messageGroup}>
              <div
                className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}
              >
                {!isUser && (
                  <div className={styles.avatarCol}>
                    <div className={styles.botAvatar} aria-hidden="true">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    </div>
                  </div>
                )}
                <div className={styles.bubbleContent}>
                  <p className={styles.messageText}>{message.content}</p>
                </div>
              </div>

              {/* Chips — only when not yet ready */}
              {!isUser && message.chips.length > 0 && isLastAssistant && !metadata?.ready && (
                <div className={styles.chipsRow}>
                  <SuggestionChips
                    chips={message.chips}
                    onSelect={handleChipSelect}
                    disabled={isLoading}
                  />
                </div>
              )}

              {/* Params card — shown when metadata is ready */}
              {!isUser && isLastAssistant && metadata?.ready && (
                <div className={styles.paramsRow}>
                  <DiscoveryParamsCard
                    metadata={metadata}
                    onUpdate={updateMetadata}
                    disabled={isLoading}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {isLoading && (
          <div className={styles.messageGroup}>
            <div className={`${styles.bubble} ${styles.assistantBubble}`}>
              <div className={styles.avatarCol}>
                <div className={styles.botAvatar} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
              </div>
              <div className={styles.bubbleContent}>
                <div className={styles.typing} aria-label="Sotto is thinking">
                  <span className={styles.typingBar} />
                  <span className={styles.typingBar} />
                  <span className={styles.typingBar} />
                  <span className={styles.typingBar} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Language detection banner */}
      {detectedLanguage && !languageBannerDismissed && (
        <LanguageBanner
          detectedLanguage={detectedLanguage}
          onDismiss={() => setLanguageBannerDismissed(true)}
        />
      )}

      {/* Generate CTA */}
      {metadata?.ready && (
        <div className={styles.generateBar}>
          <button
            type="button"
            className={styles.generateButton}
            onClick={handleGenerate}
            aria-label="Generate your podcast"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Generate Podcast
          </button>
        </div>
      )}

      {/* Input area */}
      <form className={styles.inputBar} onSubmit={handleSubmit}>
        {onAiModelChange && (
          <LlmModelDropdown value={aiModel} onChange={onAiModelChange} />
        )}
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a topic or paste a URL (articles, YouTube, videos)..."
          disabled={isLoading}
          aria-label="Chat message input"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={!inputValue.trim() || isLoading}
          aria-label="Send message"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
