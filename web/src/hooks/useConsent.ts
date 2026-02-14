import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPublicConfig } from '../api/public';

const CONSENT_STORAGE_KEY = 'harborfm_consent';
type ConsentValue = 'accepted' | 'rejected';

function getStoredConsent(): ConsentValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (v === 'accepted' || v === 'rejected') return v;
    return null;
  } catch {
    return null;
  }
}

/** Returns true if browser signals GPC (Global Privacy Control) - treat as opt-out. */
function hasGpcSignal(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true;
}

export function useConsent() {
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const { data: publicConfig } = useQuery({
    queryKey: ['publicConfig', host],
    queryFn: getPublicConfig,
    retry: false,
    staleTime: 10_000,
  });

  const [consentGiven, setConsentGivenState] = useState<boolean | null>(() => {
    if (hasGpcSignal()) return false;
    const stored = getStoredConsent();
    if (stored === 'accepted') return true;
    if (stored === 'rejected') return false;
    return null;
  });

  useEffect(() => {
    const stored = getStoredConsent();
    if (stored === 'accepted') setConsentGivenState(true);
    else if (stored === 'rejected') setConsentGivenState(false);
    else if (hasGpcSignal()) setConsentGivenState(false);
  }, []);

  const accept = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted');
      setConsentGivenState(true);
    } catch {
      setConsentGivenState(true);
    }
  }, []);

  const reject = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, 'rejected');
      setConsentGivenState(false);
    } catch {
      setConsentGivenState(false);
    }
  }, []);

  const bannerEnabled = Boolean(publicConfig?.gdpr_consent_banner_enabled);
  const showBanner =
    bannerEnabled &&
    consentGiven === null &&
    !hasGpcSignal();

  return { consentGiven, showBanner, accept, reject };
}
