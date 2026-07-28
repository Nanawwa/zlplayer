import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'zlplay_theme';

function getStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* ignore */ }
  return 'system';
}

function resolveIsDark(t: Theme): boolean {
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', resolveIsDark(t));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStored);
  const [isDark, setIsDark] = useState(() => resolveIsDark(getStored()));

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
    applyTheme(t);
    setIsDark(resolveIsDark(t));
  }, []);

  const cycle = useCallback(() => {
    const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
    setTheme(next[theme]);
  }, [theme, setTheme]);

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { applyTheme('system'); setIsDark(mq.matches); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return { theme, setTheme, cycle, isDark } as const;
}
