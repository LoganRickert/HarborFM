import { SectionCard } from './SectionCard';
import type { SystemStatsResponse } from '../../api/settings';
import { formatBytes } from '../../utils/format';
import styles from '../../pages/Settings.module.css';

export interface SystemSectionProps {
  version: string | null | undefined;
  commands: Record<string, boolean> | null | undefined;
  systemStats?: SystemStatsResponse | null;
}

export function SystemSection({ version, commands, systemStats }: SystemSectionProps) {
  return (
    <SectionCard
      title="System"
      subtitle="Server version, required commands, and system resources."
    >
      <div className={styles.systemSectionBlock}>
        {commands != null && Object.keys(commands).length > 0 && (
          <div className={styles.versionCommands}>
            {Object.entries(commands)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name]) => (
                <span
                  key={name}
                  className={styles.commandBadge}
                  title={commands[name] ? 'Present' : 'Not found'}
                >
                  <span
                    className={styles.commandDot}
                    style={{
                      background: commands[name] ? 'var(--accent)' : 'var(--error)',
                    }}
                    aria-hidden
                  />
                  <code className={styles.commandName}>{name}</code>
                </span>
              ))}
          </div>
        )}
        {version != null && version !== '' && (
          <div className={styles.versionBlock}>
            <span className={styles.versionLabel}>Version</span>
            <span className={styles.versionValue}>{version}</span>
          </div>
        )}
        {systemStats != null && (
          <div className={styles.systemStatsGrid}>
            <div className={styles.systemStatRow}>
              <span className={styles.systemStatLabel}>Memory</span>
              <span className={styles.systemStatValue}>
                {formatBytes(systemStats.memory.usedBytes)} / {formatBytes(systemStats.memory.totalBytes)}
              </span>
            </div>
            <div className={styles.systemStatRow}>
              <span className={styles.systemStatLabel}>CPU</span>
              <span className={styles.systemStatValue}>{systemStats.cpus} cores</span>
            </div>
            {systemStats.disk != null && (
              <div className={styles.systemStatRow}>
                <span className={styles.systemStatLabel}>Disk (data dir)</span>
                <span className={styles.systemStatValue}>
                  {formatBytes(systemStats.disk.usedBytes)} / {formatBytes(systemStats.disk.totalBytes)}
                </span>
              </div>
            )}
          </div>
        )}
        {systemStats == null && (
          <p className={styles.systemStatsPlaceholder}>
            System stats (disk, RAM, CPU) load from the server when available.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
