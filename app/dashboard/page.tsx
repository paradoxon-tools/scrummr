'use client'

import { Show, SignInButton, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import { useEffect, useState } from 'react'

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
  const { user } = useUser()
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
      const response = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...normalized,
          quickFilterFieldIds: parseQuickFilterFieldIds(normalized.quickFilterFieldIds),
        }),
      })

      const payload = (await response.json().catch(() => null)) as unknown

      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'Failed to start planning session.'
        setErrorMessage(message)
        return
      }

      const ticketCount = parseIssueCount(payload)
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
    <main className="dashboard-shell">
      <Show when="signed-out">
        <section className="panel dashboard-panel">
          <p className="eyebrow">Facilitator Console</p>
          <h1>Planning Dashboard</h1>
          <p className="summary">Sign in with Clerk to configure Jira and start a planning session.</p>
          <SignInButton>
            <button type="button" className="primary">
              Sign in to continue
            </button>
          </SignInButton>
        </section>
      </Show>

      <Show when="signed-in">
        <section className="panel dashboard-panel">
          <p className="eyebrow">Facilitator Console</p>
          <h1>Planning Dashboard</h1>
          <p className="summary">
            Signed in as {user?.fullName || user?.primaryEmailAddress?.emailAddress || 'facilitator'}.
          </p>

          <form
            className="jira-form"
            onSubmit={(event) => {
              event.preventDefault()
              void startPlanningSession()
            }}
          >
            <label htmlFor="dashboard-jira-url">Jira URL</label>
            <input
              id="dashboard-jira-url"
              placeholder="your-team.atlassian.net"
              value={jiraConfig.baseUrl}
              onChange={(event) => setJiraConfig((current) => ({ ...current, baseUrl: event.currentTarget.value }))}
            />

            <label htmlFor="dashboard-jira-email">Jira account email</label>
            <input
              id="dashboard-jira-email"
              type="email"
              placeholder="team.member@company.com"
              value={jiraConfig.email}
              onChange={(event) => setJiraConfig((current) => ({ ...current, email: event.currentTarget.value }))}
            />

            <label htmlFor="dashboard-jira-token">Jira API token</label>
            <input
              id="dashboard-jira-token"
              type="password"
              placeholder="Paste API token"
              value={jiraConfig.apiToken}
              onChange={(event) => setJiraConfig((current) => ({ ...current, apiToken: event.currentTarget.value }))}
            />

            <label htmlFor="dashboard-jira-prefix">Ticket prefix</label>
            <input
              id="dashboard-jira-prefix"
              placeholder="TEAM"
              value={jiraConfig.ticketPrefix}
              onChange={(event) =>
                setJiraConfig((current) => ({ ...current, ticketPrefix: normalizeTicketPrefix(event.currentTarget.value) }))
              }
            />

            <label htmlFor="dashboard-quick-filter-fields">Quick filter field IDs</label>
            <input
              id="dashboard-quick-filter-fields"
              placeholder="customfield_12345, customfield_67890"
              value={jiraConfig.quickFilterFieldIds}
              onChange={(event) =>
                setJiraConfig((current) => ({
                  ...current,
                  quickFilterFieldIds: event.currentTarget.value,
                }))
              }
            />

            <div className="jira-actions">
              <button type="submit" className="primary" disabled={isStartingSession}>
                {isStartingSession ? 'Starting session...' : 'Start planning session'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setJiraConfig(createDefaultJiraConfig())
                  setErrorMessage('')
                  setSuccessMessage('')
                  window.localStorage.removeItem(JIRA_STORAGE_KEY)
                }}
              >
                Clear
              </button>
            </div>
          </form>

          {errorMessage ? <p className="jira-error">{errorMessage}</p> : null}
          {successMessage ? <p className="jira-message">{successMessage}</p> : null}

          <div className="dashboard-actions">
            <Link href="/" className="secondary button-link">
              Open planning room
            </Link>
          </div>

          <p className="jira-config-note">Share this URL with participants: {planningRoomUrl}</p>
        </section>
      </Show>
    </main>
  )
}
