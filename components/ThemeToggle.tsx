'use client'

import { useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'scrummer.theme_mode'

const applyThemeMode = (mode: ThemeMode): void => {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}

const getSystemThemeMode = (): ThemeMode =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

export default function ThemeToggle() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  useEffect(() => {
    const storedMode = window.localStorage.getItem(STORAGE_KEY)
    const nextMode: ThemeMode = storedMode === 'dark' || storedMode === 'light' ? storedMode : getSystemThemeMode()

    if (storedMode !== 'dark' && storedMode !== 'light') {
      window.localStorage.setItem(STORAGE_KEY, nextMode)
    }

    setThemeMode(nextMode)
    applyThemeMode(nextMode)
  }, [])

  const toggleThemeMode = (): void => {
    const nextMode: ThemeMode = themeMode === 'light' ? 'dark' : 'light'
    setThemeMode(nextMode)
    window.localStorage.setItem(STORAGE_KEY, nextMode)
    applyThemeMode(nextMode)
  }

  return (
    <button
      type="button"
      onClick={toggleThemeMode}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-accent-subtle)]"
      style={{ color: 'var(--color-text-secondary)' }}
      aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {themeMode === 'dark' ? (
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="4" />
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 10.5a7.5 7.5 0 01-10-10A7.5 7.5 0 1017.5 10.5z" />
        </svg>
      )}
    </button>
  )
}
