import { SettingsFormProps } from '../../types/settings';
import { SectionCard } from './SectionCard';
import styles from '../../pages/Settings.module.css';

const REVIEW_SUBTITLE = (
  <>
    Allow listeners to leave reviews on podcast and episode feed pages. Unverified reviews can be hidden until the reviewer confirms their email.
  </>
);

export function ReviewSettingsSection({ form, onFormChange }: SettingsFormProps) {
  return (
    <SectionCard
      title="Review Settings"
      subtitle={REVIEW_SUBTITLE}
    >
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.reviewsEnabled}
          onChange={(e) => onFormChange({ reviewsEnabled: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Enable Reviews</span>
      </label>
      <p className={styles.toggleHelp}>
        When on, the public feed shows a Reviews card and accepts new reviews (subject to podcast-level settings).
      </p>

      <label className="toggle">
        <input
          type="checkbox"
          checked={form.reviewsPublishNonVerified}
          onChange={(e) => onFormChange({ reviewsPublishNonVerified: e.target.checked })}
        />
        <span className="toggle__track" aria-hidden="true" />
        <span>Publish non-verified reviews</span>
      </label>
      <p className={styles.toggleHelp}>
        When on, approved reviews from users who have not verified their email are shown on the public feed.
      </p>

      {form.llmProvider !== 'none' && (
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.reviewsLlmSpamCheck}
              onChange={(e) => onFormChange({ reviewsLlmSpamCheck: e.target.checked })}
            />
            <span className="toggle__track" aria-hidden="true" />
            <span>Enable LLM spam check</span>
          </label>
          <p className={styles.toggleHelp}>
            When on, new reviews are checked by the configured LLM for spam. Fail-open: if the check fails, the review is not marked as spam.
          </p>
        </>
      )}
    </SectionCard>
  );
}
