import { ProviderToggleProps } from '../../types/settings';
import styles from './ProviderToggle.module.css';

export function ProviderToggle<T = string>({
  value,
  options,
  onChange,
  ariaLabel,
}: ProviderToggleProps<T>) {
  return (
    <div className={styles.toggle} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={value === option.value ? styles.btnActive : styles.btn}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
