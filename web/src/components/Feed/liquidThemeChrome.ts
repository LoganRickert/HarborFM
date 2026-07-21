import { createContext, useContext } from 'react';

export type LiquidThemeChrome = {
  themeClassName: string;
};

export const LiquidThemeChromeContext = createContext<LiquidThemeChrome>({
  themeClassName: '',
});

export function useLiquidThemeChrome(): LiquidThemeChrome {
  return useContext(LiquidThemeChromeContext);
}

/** Merge theme class onto a dialog overlay/content className. */
export function withThemeClass(
  base: string | undefined,
  themeClassName: string | undefined,
): string | undefined {
  const parts = [base, themeClassName].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}
