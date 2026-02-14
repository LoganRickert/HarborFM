import { useRef, useEffect } from 'react';
import { MessageCircle, Minimize2, Maximize2, Send, X } from 'lucide-react';
import styles from './CallChatPanel.module.css';

export interface ChatMessage {
  participantId: string;
  participantName: string;
  text: string;
  /** Client-side timestamp (ms) when message was received. */
  timestamp?: number;
}

export interface CallChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  minimized: boolean;
  onMinimizeToggle: () => void;
  /** When provided, shows a close (X) button that calls this. */
  onClose?: () => void;
  title?: string;
  /** When true, only render body (messages + input) without header/panel chrome. */
  embedded?: boolean;
  /** When true, input and send are disabled (e.g. pre-join when not connected). */
  disabled?: boolean;
}

export function CallChatPanel({
  messages,
  onSend,
  minimized,
  onMinimizeToggle,
  onClose,
  title = 'Chat',
  embedded = false,
  disabled = false,
}: CallChatPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (listRef.current && !minimized) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, minimized]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (text) {
      onSend(text);
      input.value = '';
    }
  };

  if (embedded) {
    return (
      <div className={styles.body} data-testid="chat-panel">
        <ul className={styles.messageList} ref={listRef} data-testid="chat-message-list">
          {messages.length === 0 ? (
            <li className={styles.emptyHint}>No messages yet</li>
          ) : (
            messages.map((m, i) => (
              <li key={i} className={styles.messageItem}>
                <div className={styles.messageNameRow}>
                  <span className={styles.messageName} title={m.participantName}>{m.participantName}</span>
                  {m.timestamp != null && (
                    <span className={styles.messageTime}>
                      {new Date(m.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </span>
                  )}
                </div>
                <div className={styles.messageText}>{m.text}</div>
              </li>
            ))
          )}
        </ul>
        <form className={styles.inputRow} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder={disabled ? 'Join the call to chat' : 'Type a message...'}
            aria-label="Chat message"
            maxLength={2000}
            data-testid="chat-input"
            disabled={disabled}
          />
          <button type="submit" className={styles.sendBtn} aria-label="Send message" data-testid="chat-send" disabled={disabled}>
            <Send size={14} strokeWidth={2} aria-hidden />
            Send
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.panel} role="region" aria-label={title} data-minimized={minimized || undefined} data-testid="chat-panel">
      <div className={styles.header}>
        <MessageCircle size={18} strokeWidth={2} aria-hidden />
        <span className={styles.title}>{title}</span>
        <span className={styles.headerSpacer} />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMinimizeToggle}
          aria-label={minimized ? 'Maximize' : 'Minimize'}
          title={minimized ? 'Maximize' : 'Minimize'}
        >
          {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
        </button>
        {onClose && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close chat"
            title="Close chat"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
      <div className={styles.body}>
        <ul className={styles.messageList} ref={listRef} data-testid="chat-message-list">
          {messages.length === 0 ? (
            <li className={styles.emptyHint}>No messages yet</li>
          ) : (
            messages.map((m, i) => (
              <li key={i} className={styles.messageItem}>
                <div className={styles.messageNameRow}>
                  <span className={styles.messageName} title={m.participantName}>{m.participantName}</span>
                  {m.timestamp != null && (
                    <span className={styles.messageTime}>
                      {new Date(m.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })}
                    </span>
                  )}
                </div>
                <div className={styles.messageText}>{m.text}</div>
              </li>
            ))
          )}
        </ul>
        <form className={styles.inputRow} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder={disabled ? 'Join the call to chat' : 'Type a message...'}
            aria-label="Chat message"
            maxLength={2000}
            data-testid="chat-input"
            disabled={disabled}
          />
          <button type="submit" className={styles.sendBtn} aria-label="Send message" data-testid="chat-send" disabled={disabled}>
            <Send size={14} strokeWidth={2} aria-hidden />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
