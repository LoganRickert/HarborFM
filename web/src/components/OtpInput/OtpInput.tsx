import { useId } from 'react';
import styles from './OtpInput.module.css';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  error?: boolean;
  label?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  inputMode?: 'numeric' | 'text';
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  error = false,
  label,
  autoComplete,
  autoFocus = false,
  ariaLabel,
  ariaDescribedBy,
  inputMode = 'numeric',
}: OtpInputProps) {
  const id = useId();

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const raw = e.currentTarget.value.replace(/\D/g, '');
    onChange(raw.slice(0, length));
  };

  return (
    <div className={styles.card}>
      {label ? (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        pattern="[0-9]*"
        maxLength={length}
        value={value}
        onInput={handleInput}
        disabled={disabled}
        autoComplete={autoComplete ?? 'one-time-code'}
        autoFocus={autoFocus}
        placeholder={'-'.repeat(length)}
        className={`${styles.input} ${error ? styles.inputError : ''}`}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error}
        aria-describedby={ariaDescribedBy}
      />
    </div>
  );
}
