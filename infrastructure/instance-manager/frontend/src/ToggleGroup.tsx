import styles from "./ToggleGroup.module.css";

interface Option<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface ToggleGroupProps<T extends string> {
  label?: string;
  value: T;
  options: readonly Option<T>[] | readonly T[];
  onChange: (value: T) => void;
}

export function ToggleGroup<T extends string>({ label, value, options, onChange }: ToggleGroupProps<T>) {
  const opts = options as readonly (Option<T> | T)[];
  const normalized = opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) as Option<T>[];

  return (
    <div className={styles.wrap}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.buttonGroup}>
        {normalized.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={value === opt.value ? styles.btnActive : styles.btn}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
