'use client';

import { useEffect, useRef, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

// localStorage key + initial-state attribute have to stay in sync with the
// pre-paint script in layout.tsx — change them in both places at once.
const STORAGE_KEY = 'theme';

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {}
}

export function ThemeToggle() {
  // Hydration: the SSR `data-theme="system"` may have been promoted to
  // light/dark by the pre-paint script. Read what's actually on the html.
  const [theme, setTheme] = useState<Theme>('system');
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(readStored());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(next: Theme) {
    setTheme(next);
    applyTheme(next);
    setOpen(false);
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded border border-border-strong text-text-muted hover:border-accent hover:text-text"
        title={`Theme: ${theme}`}
      >
        <ThemeIcon theme={theme} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-40 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          <Option current={theme} value="light" onPick={pick}>
            <SunIcon /> Light
          </Option>
          <Option current={theme} value="dark" onPick={pick}>
            <MoonIcon /> Dark
          </Option>
          <Option current={theme} value="system" onPick={pick}>
            <SystemIcon /> System
          </Option>
        </div>
      )}
    </div>
  );
}

function Option({
  current,
  value,
  onPick,
  children,
}: {
  current: Theme;
  value: Theme;
  onPick: (t: Theme) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      type="button"
      onClick={() => onPick(value)}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 ${
        active ? 'text-accent' : 'text-text'
      }`}
    >
      {children}
      {active && <CheckIcon className="ml-auto" />}
    </button>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <SunIcon />;
  if (theme === 'dark') return <MoonIcon />;
  return <SystemIcon />;
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 22h8M12 18v4" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
