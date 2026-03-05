'use client'

import { Link } from '@tanstack/react-router'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type JoinViewProps = {
  nameInput: string
  isConnecting: boolean
  isSocketConnected: boolean
  connectionMessage: string
  onNameChange: (value: string) => void
  onSubmit: () => void
}

export default function JoinView({
  nameInput,
  isConnecting,
  isSocketConnected,
  connectionMessage,
  onNameChange,
  onSubmit,
}: JoinViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-2xl border p-8"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--color-accent-subtle)' }}
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" style={{ color: 'var(--color-accent)' }} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Join planning room
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {isSocketConnected
              ? 'Session is not open yet. You will be joined automatically once it starts.'
              : 'Enter your display name to start estimating with your team.'}
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="join-display-name" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
              Display name
            </label>
            <Input
              id="join-display-name"
              maxLength={40}
              value={nameInput}
              placeholder="Enter your name..."
              autoComplete="name"
              onChange={(event) => onNameChange(event.currentTarget.value)}
            />
          </div>
          <Button type="submit" disabled={isConnecting} className="w-full">
            {isConnecting ? 'Connecting...' : isSocketConnected ? 'Waiting for session...' : 'Join room'}
          </Button>
        </form>

        {connectionMessage ? (
          <div
            className="mt-4 rounded-lg border px-3 py-2.5 text-sm"
            style={{
              background: 'var(--color-danger-subtle)',
              borderColor: 'var(--color-danger)',
              color: 'var(--color-danger)',
            }}
          >
            {connectionMessage}
          </div>
        ) : null}

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Facilitator? Open the{' '}
          <Link to="/dashboard" className="font-medium underline underline-offset-2" style={{ color: 'var(--color-accent)' }}>
            dashboard
          </Link>{' '}
          to connect Jira and start the session.
        </p>
      </div>
    </div>
  )
}
