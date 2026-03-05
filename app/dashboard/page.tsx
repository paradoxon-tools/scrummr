'use client'

import { useUser } from '@clerk/tanstack-react-start'
import { Link } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api.js'
import { Button, buttonVariants } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

type JiraConfig = {
  baseUrl: string
  email: string
  apiToken: string
  ticketPrefix: string
  quickFilterFieldIds: string
}

type JiraIssueResult = {
  groups?: Array<{
    issues?: unknown[]
  }>
}

const JIRA_STORAGE_KEY = 'scrummer.jira_config'

const createDefaultJiraConfig = (): JiraConfig => ({
  baseUrl: '',
  email: '',
  apiToken: '',
  ticketPrefix: '',
  quickFilterFieldIds: '',
})

const normalizeTicketPrefix = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20)

const normalizeQuickFilterFieldId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 80)

const parseQuickFilterFieldIds = (value: string): string[] => {
  const unique = new Set<string>()
  for (const entry of value.split(',')) {
    const normalized = normalizeQuickFilterFieldId(entry)
    if (!normalized) {
      continue
    }
    unique.add(normalized)
  }
  return [...unique]
}

const normalizeQuickFilterFieldList = (value: string): string => parseQuickFilterFieldIds(value).join(', ')

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '')

const normalizeJiraConfig = (value: JiraConfig): JiraConfig => ({
  baseUrl: value.baseUrl.trim(),
  email: value.email.trim(),
  apiToken: value.apiToken.trim(),
  ticketPrefix: normalizeTicketPrefix(value.ticketPrefix),
  quickFilterFieldIds: normalizeQuickFilterFieldList(value.quickFilterFieldIds),
})

const readStoredJiraConfig = (): JiraConfig | null => {
  const raw = window.localStorage.getItem(JIRA_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return null
    }

    const normalized = normalizeJiraConfig({
      baseUrl: toStringOrEmpty(parsed.baseUrl),
      email: toStringOrEmpty(parsed.email),
      apiToken: toStringOrEmpty(parsed.apiToken),
      ticketPrefix: toStringOrEmpty(parsed.ticketPrefix),
      quickFilterFieldIds: toStringOrEmpty(parsed.quickFilterFieldIds),
    })

    if (!normalized.baseUrl || !normalized.email || !normalized.apiToken || !normalized.ticketPrefix) {
      return null
    }

    return normalized
  } catch {
    return null
  }
}

const saveJiraConfigLocally = (value: JiraConfig): void => {
  const normalized = normalizeJiraConfig(value)
  window.localStorage.setItem(JIRA_STORAGE_KEY, JSON.stringify(normalized))
}

const parseIssueCount = (payload: unknown): number => {
  if (!isRecord(payload) || !Array.isArray((payload as JiraIssueResult).groups)) {
    return 0
  }

  return (payload as JiraIssueResult).groups?.reduce((count, group) => {
    if (!group || !Array.isArray(group.issues)) {
      return count
    }
    return count + group.issues.length
  }, 0) ?? 0
}

export default function DashboardPage() {
  const loadJiraIssuesAction = useAction(api.jira.loadIssues)
  const { user, isSignedIn } = useUser()
  const [jiraConfig, setJiraConfig] = useState<JiraConfig>(createDefaultJiraConfig)
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [planningRoomUrl, setPlanningRoomUrl] = useState('')

  useEffect(() => {
    setPlanningRoomUrl(`${window.location.origin}/`)
    const stored = readStoredJiraConfig()
    if (stored) {
      setJiraConfig(stored)
    }
  }, [])

  const startPlanningSession = async (): Promise<void> => {
    const normalized = normalizeJiraConfig(jiraConfig)
    setJiraConfig(normalized)
    saveJiraConfigLocally(normalized)

    if (!normalized.baseUrl || !normalized.email || !normalized.apiToken || !normalized.ticketPrefix) {
      setErrorMessage('Add Jira URL, email, API token, and ticket prefix before starting a session.')
      setSuccessMessage('')
      return
    }

    setIsStartingSession(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await loadJiraIssuesAction({
        baseUrl: normalized.baseUrl,
        email: normalized.email,
        apiToken: normalized.apiToken,
        ticketPrefix: normalized.ticketPrefix,
        quickFilterFieldIds: parseQuickFilterFieldIds(normalized.quickFilterFieldIds),
      })

      if (!result.ok) {
        setErrorMessage(result.message || 'Failed to start planning session.')
        return
      }

      const ticketCount = parseIssueCount(result.jiraIssues)
      setSuccessMessage(
        ticketCount > 0
          ? `Session started with ${ticketCount} Jira tickets. Participants can now join the planning room.`
          : 'Session started. No Jira tickets matched your filters, but participants can now join.',
      )
    } catch {
      setErrorMessage('Could not reach the Jira backend endpoint.')
    } finally {
      setIsStartingSession(false)
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 py-10" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: 'var(--color-accent-subtle)' }}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ color: 'var(--color-accent)' }} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1" />
              <rect x="14" y="3" width="7" height="5" rx="1" />
              <rect x="14" y="12" width="7" height="9" rx="1" />
              <rect x="3" y="16" width="7" height="5" rx="1" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Planning Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {isSignedIn
              ? `Signed in as ${user?.fullName || user?.primaryEmailAddress?.emailAddress || 'facilitator'}`
              : 'Sign in to configure Jira and start a session.'}
          </p>
        </div>

        {/* Sign-in card */}
        {!isSignedIn ? (
          <div
            className="rounded-xl border p-8 text-center"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <p className="mb-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              You need to be signed in via Clerk to access the facilitator dashboard.
            </p>
            <Link to="/sign-in" className={buttonVariants()}>
              Sign in to continue
            </Link>
          </div>
        ) : null}

        {/* Config card */}
        {isSignedIn ? (
          <div
            className="rounded-xl border"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <form
              className="p-6"
              onSubmit={(event) => {
                event.preventDefault()
                void startPlanningSession()
              }}
            >
              <h2 className="mb-4 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Jira Connection
              </h2>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label
                    htmlFor="dashboard-jira-url"
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    Jira URL
                  </label>
                  <Input
                    id="dashboard-jira-url"
                    placeholder="your-team.atlassian.net"
                    value={jiraConfig.baseUrl}
                    onChange={(event) => setJiraConfig((current) => ({ ...current, baseUrl: event.currentTarget.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="dashboard-jira-email"
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    Account email
                  </label>
                  <Input
                    id="dashboard-jira-email"
                    type="email"
                    placeholder="team.member@company.com"
                    value={jiraConfig.email}
                    onChange={(event) => setJiraConfig((current) => ({ ...current, email: event.currentTarget.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="dashboard-jira-token"
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    API token
                  </label>
                  <Input
                    id="dashboard-jira-token"
                    type="password"
                    placeholder="Paste API token"
                    value={jiraConfig.apiToken}
                    onChange={(event) => setJiraConfig((current) => ({ ...current, apiToken: event.currentTarget.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="dashboard-jira-prefix"
                      className="text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      Ticket prefix
                    </label>
                    <Input
                      id="dashboard-jira-prefix"
                      placeholder="TEAM"
                      value={jiraConfig.ticketPrefix}
                      onChange={(event) =>
                        setJiraConfig((current) => ({ ...current, ticketPrefix: normalizeTicketPrefix(event.currentTarget.value) }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="dashboard-quick-filter-fields"
                      className="text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      Quick filter fields
                    </label>
                    <Input
                      id="dashboard-quick-filter-fields"
                      placeholder="customfield_12345"
                      value={jiraConfig.quickFilterFieldIds}
                      onChange={(event) =>
                        setJiraConfig((current) => ({
                          ...current,
                          quickFilterFieldIds: event.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 flex items-center gap-2">
                <Button type="submit" disabled={isStartingSession} className="flex-1">
                  {isStartingSession ? 'Starting session...' : 'Start planning session'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setJiraConfig(createDefaultJiraConfig())
                    setErrorMessage('')
                    setSuccessMessage('')
                    window.localStorage.removeItem(JIRA_STORAGE_KEY)
                  }}
                >
                  Clear
                </Button>
              </div>
            </form>

            {/* Messages */}
            {errorMessage ? (
              <div
                className="mx-6 mb-4 rounded-lg border px-3 py-2.5 text-sm"
                style={{
                  background: 'var(--color-danger-subtle)',
                  borderColor: 'var(--color-danger)',
                  color: 'var(--color-danger)',
                }}
              >
                {errorMessage}
              </div>
            ) : null}
            {successMessage ? (
              <div
                className="mx-6 mb-4 rounded-lg border px-3 py-2.5 text-sm"
                style={{
                  background: 'var(--color-success-subtle)',
                  borderColor: 'var(--color-success)',
                  color: 'var(--color-success)',
                }}
              >
                {successMessage}
              </div>
            ) : null}

            {/* Footer */}
            <div
              className="flex items-center justify-between border-t px-6 py-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:underline"
                style={{ color: 'var(--color-accent)' }}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 3L5 8l5 5" />
                </svg>
                Open planning room
              </Link>
              <p className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
                {planningRoomUrl}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
