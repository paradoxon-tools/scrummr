'use client'

import { useEffect, useState } from 'react'
import { Button } from './ui/button'

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
    <Button type="button" variant="ghost" size="sm" className="theme-toggle" onClick={toggleThemeMode}>
      {themeMode === 'dark' ? 'Use light mode' : 'Use dark mode'}
    </Button>
  )
}
