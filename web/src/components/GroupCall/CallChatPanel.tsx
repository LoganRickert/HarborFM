import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, MessageCircle, Minimize2, Maximize2, Send, X } from 'lucide-react';
import { resizeCallChatImage } from '../../utils/resizeCallChatImage';
import styles from './CallChatPanel.module.css';

export interface ChatMessage {
  participantId: string;
  participantName: string;
  text?: string;
  imageUrl?: string | null;
  /** Client-side timestamp (ms) when message was received. */
  timestamp?: number;
}

export type ChatSendPayload = {
  text: string;
  imageFile?: File | null;
};

export interface CallChatPanelProps {
  messages: ChatMessage[];
  onSend: (payload: ChatSendPayload) => void | Promise<void>;
  minimized: boolean;
  onMinimizeToggle: () => void;
  /** When provided, shows a close (X) button that calls this. */
  onClose?: () => void;
  title?: string;
  /** When true, only render body (messages + input) without header/panel chrome. */
  embedded?: boolean;
  /** When true, input and send are disabled (e.g. pre-join when not connected). */
  disabled?: boolean;
  /** Called when the user interacts with the panel (click, focus) to clear unread indicator. */
  onInteract?: () => void;
  /** When true, shows yellow styling on the header message icon (e.g. new messages when minimized). */
  unread?: boolean;
}

/** Match http(s) URLs; stops at whitespace or common trailing punctuation. */
const CHAT_URL_RE = /https?:\/\/[^\s<>"']+/gi;

function trimTrailingUrlPunctuation(url: string): { href: string; trailing: string } {
  let href = url;
  let trailing = '';
  while (href.length > 0 && /[),.;:!?]/.test(href[href.length - 1]!)) {
    const next = href[href.length - 1]!;
    // Keep balanced closing paren if an opening paren is in the URL.
    if (next === ')' && (href.match(/\(/g) || []).length > (href.match(/\)/g) || []).length - 1) {
      break;
    }
    trailing = next + trailing;
    href = href.slice(0, -1);
  }
  return { href, trailing };
}

function renderChatText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(CHAT_URL_RE.source, CHAT_URL_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    const { href, trailing } = trimTrailingUrlPunctuation(match[0]);
    if (/^https?:\/\//i.test(href)) {
      nodes.push(
        <a
          key={`link-${start}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.messageLink}
        >
          {href}
        </a>,
      );
    } else {
      nodes.push(match[0]);
    }
    if (trailing) nodes.push(trailing);
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length > 0 ? nodes : [text];
}

function MessageList({
  messages,
  listRef,
}: {
  messages: ChatMessage[];
  listRef: React.RefObject<HTMLUListElement | null>;
}) {
  return (
    <ul className={styles.messageList} ref={listRef} data-testid="chat-message-list">
      {messages.length === 0 ? (
        <li className={styles.emptyHint}>No messages yet</li>
      ) : (
        messages.map((m, i) => (
          <li key={i} className={styles.messageItem}>
            <div className={styles.messageNameRow}>
              <span className={styles.messageName} title={m.participantName}>
                {m.participantName}
              </span>
              {m.timestamp != null && (
                <span className={styles.messageTime}>
                  {new Date(m.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </span>
              )}
            </div>
            {m.imageUrl ? (
              <img
                src={m.imageUrl}
                alt=""
                className={styles.messageImage}
                loading="lazy"
                data-testid="chat-message-image"
              />
            ) : null}
            {m.text?.trim() ? (
              <div className={styles.messageText}>{renderChatText(m.text)}</div>
            ) : null}
          </li>
        ))
      )}
    </ul>
  );
}

function fileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file?.type.startsWith('image/')) return file;
    }
  }
  return null;
}

function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (payload: ChatSendPayload) => void | Promise<void>;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingImage) {
      setPendingPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingImage);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingImage]);

  const attachImageFile = async (file: File) => {
    setComposeError(null);
    try {
      const resized = await resizeCallChatImage(file);
      setPendingImage(resized);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setPendingImage(null);
      setComposeError(
        err instanceof Error ? err.message : 'Could not process image',
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (disabled || sending) return;
    const file = fileFromClipboard(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    void attachImageFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || sending) return;
    const text = inputRef.current?.value.trim() ?? '';
    if (!text && !pendingImage) return;
    setComposeError(null);
    setSending(true);
    try {
      await onSend({ text, imageFile: pendingImage });
      if (inputRef.current) inputRef.current.value = '';
      setPendingImage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className={styles.composer}
      onSubmit={handleSubmit}
      onPaste={handlePaste}
    >
      {pendingPreview ? (
        <div className={styles.imagePreviewRow}>
          <img src={pendingPreview} alt="" className={styles.imagePreviewThumb} />
          <button
            type="button"
            className={styles.clearImageBtn}
            onClick={() => {
              setPendingImage(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            disabled={disabled || sending}
            aria-label="Remove image"
          >
            <X size={14} aria-hidden />
            Remove
          </button>
        </div>
      ) : null}
      {composeError ? (
        <p className={styles.composeError} role="alert">
          {composeError}
        </p>
      ) : null}
      <div className={styles.inputRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.fileInputHidden}
          disabled={disabled || sending}
          data-testid="chat-image-input"
          onChange={async (e) => {
            const file = e.target.files?.[0] ?? null;
            if (!file) {
              setPendingImage(null);
              return;
            }
            await attachImageFile(file);
          }}
        />
        <button
          type="button"
          className={styles.attachBtn}
          aria-label="Add image"
          title="Add image"
          data-testid="chat-image-btn"
          disabled={disabled || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} strokeWidth={2} aria-hidden />
        </button>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder={
            disabled
              ? 'Join the call to chat'
              : 'Type a message or paste an image...'
          }
          aria-label="Chat message"
          maxLength={2000}
          data-testid="chat-input"
          disabled={disabled || sending}
          onPaste={handlePaste}
        />
        <button
          type="submit"
          className={styles.sendBtn}
          aria-label="Send message"
          data-testid="chat-send"
          disabled={disabled || sending}
        >
          <Send size={14} strokeWidth={2} aria-hidden />
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  );
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
  onInteract,
  unread = false,
}: CallChatPanelProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (listRef.current && !minimized) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, minimized]);

  const interactProps = onInteract
    ? { onClick: onInteract, onFocusCapture: onInteract }
    : {};

  if (embedded) {
    return (
      <div className={styles.body} data-testid="chat-panel" {...interactProps}>
        <MessageList messages={messages} listRef={listRef} />
        <ChatComposer onSend={onSend} disabled={disabled} />
      </div>
    );
  }

  return (
    <div
      className={styles.panel}
      role="region"
      aria-label={title}
      data-minimized={minimized || undefined}
      data-testid="chat-panel"
      {...interactProps}
    >
      <div className={styles.header}>
        <MessageCircle
          size={18}
          strokeWidth={2}
          aria-hidden
          className={unread ? styles.headerIconUnread : undefined}
        />
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
        <MessageList messages={messages} listRef={listRef} />
        <ChatComposer onSend={onSend} disabled={disabled} />
      </div>
    </div>
  );
}
