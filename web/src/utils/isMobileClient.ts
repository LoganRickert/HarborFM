/**
 * True for phone/tablet clients where browsers often suspend mic capture when
 * the tab is backgrounded. Desktop tab switches should not tear down producers.
 */
export function isMobileClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  if (typeof uaData?.mobile === "boolean") return uaData.mobile;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  // iPadOS "desktop" UA: still a touch tablet that backgrounds media aggressively.
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse) and (hover: none)").matches
  ) {
    return true;
  }
  return false;
}
