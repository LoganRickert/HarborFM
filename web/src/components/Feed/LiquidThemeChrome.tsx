import {
  LiquidThemeChromeContext,
  type LiquidThemeChrome,
} from './liquidThemeChrome';

export function LiquidThemeChromeProvider({
  themeClassName,
  children,
}: LiquidThemeChrome & { children: React.ReactNode }) {
  return (
    <LiquidThemeChromeContext.Provider value={{ themeClassName }}>
      {children}
    </LiquidThemeChromeContext.Provider>
  );
}
