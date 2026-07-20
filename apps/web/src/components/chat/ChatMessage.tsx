import styles from './ChatMessage.module.css';
import { ChatChips } from './ChatChips';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  chips?: string[];
  onChipSelect?: (chip: string) => void;
  timestamp?: string;
}

export function ChatMessage({ role, content, chips, onChipSelect, timestamp }: ChatMessageProps) {
  return (
    <div
      className={`${styles.root} ${styles[role]}`}
      role="log"
      aria-label={`${role === 'user' ? 'You' : 'Assistant'} said`}
    >
      <div className={styles.bubble}>{content}</div>
      {timestamp && <time className={styles.timestamp}>{timestamp}</time>}
      {role === 'assistant' && chips && chips.length > 0 && onChipSelect && (
        <div className={styles.chips}>
          <ChatChips chips={chips} onSelect={onChipSelect} />
        </div>
      )}
    </div>
  );
}
