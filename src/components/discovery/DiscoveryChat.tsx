'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryMessage, DiscoveryMetadata } from '@/types/discovery';
import { SuggestionChips } from './SuggestionChips';
import styles from './DiscoveryChat.module.css';

interface DiscoveryChatProps {
  podcastId?: string;
  onComplete: (metadata: DiscoveryMetadata) => void;
}

export function DiscoveryChat({ podcastId, onComplete }: DiscoveryChatProps) {
  const [messages, setMessages] = useState<DiscoveryMessage[]>([]);
  const [metadata, setMetadata] = useState<DiscoveryMetadata | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Send initial greeting on mount
  useEffect(() => {
    const initChat = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            podcastId,
            messages: [],
          }),
        });

        if (!response.ok) throw new Error('Failed to start discovery');

        const data = await response.json();
        if (data.message) {
          setMessages([data.message]);
        }
        if (data.metadata) {
          setMetadata(data.metadata);
        }
      } catch {
        setMessages([
          {
            id: 'error-init',
            role: 'assistant',
            content:
              "Hi! I'm here to help you create the perfect podcast. What topic would you like to explore?",
            chips: [
              'AI & Technology',
              'Science',
              'History',
              'Business',
              'Philosophy',
            ],
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    initChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMessage: DiscoveryMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        chips: [],
        createdAt: new Date().toISOString(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInputValue('');
      setIsLoading(true);

      try {
        const response = await fetch('/api/discovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            podcastId,
            messages: updatedMessages,
          }),
        });

        if (!response.ok) throw new Error('Failed to send message');

        const data = await response.json();
        if (data.message) {
          setMessages((prev) => [...prev, data.message]);
        }
        if (data.metadata) {
          setMetadata(data.metadata);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content:
              "I'm sorry, something went wrong. Could you try saying that again?",
            chips: [],
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, messages, podcastId]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handleChipSelect = (chip: string) => {
    sendMessage(chip);
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
        {messages.map((message, index) => {
          const isUser = message.role === 'user';
          const isLastAssistant =
            message.role === 'assistant' &&
            (index === messages.length - 1 ||
              messages.slice(index + 1).every((m) => m.role === 'user'));

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

              {/* Chips after assistant messages */}
              {!isUser && message.chips.length > 0 && isLastAssistant && (
                <div className={styles.chipsRow}>
                  <SuggestionChips
                    chips={message.chips}
                    onSelect={handleChipSelect}
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
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your podcast idea..."
          disabled={isLoading}
          aria-label="Chat message input"
          autoComplete="off"
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
