import styles from './ChatContainer.module.css';

interface ChatContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function ChatContainer({ children, className }: ChatContainerProps) {
  return (
    <section
      className={`${styles.root} ${className || ''}`}
      aria-label="Chat conversation"
    >
      {children}
    </section>
  );
}
