'use client'

import { useUser } from '@clerk/tanstack-react-start'
import { Link } from '@tanstack/react-router'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api.js'
import { Button, buttonVariants } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

type JiraSessionPrefs = {
  ticketPrefix: string
  quickFilterFieldIds: string
}

type JiraIssueResult = {
  groups?: Array<{
    issues?: unknown[]
  }>
}

const JIRA_SESSION_STORAGE_KEY = 'scrummr.jira_session_prefs'

const convexBackendUrl =
  import.meta.env.VITE_CONVEX_URL?.trim() ||
  import.meta.env.NEXT_PUBLIC_CONVEX_URL?.trim() ||
  ''

const createDefaultSessionPrefs = (): JiraSessionPrefs => ({
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
    if (normalized) {
      unique.add(normalized)
    }
  }
  return [...unique]
}

const normalizeQuickFilterFieldList = (value: string): string => parseQuickFilterFieldIds(value).join(', ')

const normalizeSessionPrefs = (value: JiraSessionPrefs): JiraSessionPrefs => ({
  ticketPrefix: normalizeTicketPrefix(value.ticketPrefix),
  quickFilterFieldIds: normalizeQuickFilterFieldList(value.quickFilterFieldIds),
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '')

const readStoredSessionPrefs = (): JiraSessionPrefs | null => {
  const raw = window.localStorage.getItem(JIRA_SESSION_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return null
    }

    const normalized = normalizeSessionPrefs({
      ticketPrefix: toStringOrEmpty(parsed.ticketPrefix),
      quickFilterFieldIds: toStringOrEmpty(parsed.quickFilterFieldIds),
    })
    if (!normalized.ticketPrefix && !normalized.quickFilterFieldIds) {
      return null
    }
    return normalized
  } catch {
    return null
  }
}

const saveSessionPrefs = (value: JiraSessionPrefs): void => {
  const normalized = normalizeSessionPrefs(value)
  if (!normalized.ticketPrefix && !normalized.quickFilterFieldIds) {
    window.localStorage.removeItem(JIRA_SESSION_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(JIRA_SESSION_STORAGE_KEY, JSON.stringify(normalized))
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

const toBackendActionErrorMessage = (error: unknown): string => {
  if (!convexBackendUrl) {
    return 'Set VITE_CONVEX_URL to connect to the Jira backend.'
  }

  if (error instanceof Error) {
    const message = error.message.trim()
    if (message) {
      if (/failed to fetch|networkerror|load failed/i.test(message)) {
        return 'Could not reach the Jira backend endpoint. Ensure Convex is running and reachable from VITE_CONVEX_URL.'
      }
      return `Jira backend request failed: ${message}`
    }
  }

  return 'Could not reach the Jira backend endpoint.'
}

export default function DashboardPage() {
  const loadJiraIssuesAction = useAction(api.jira.loadIssues)
  const beginOAuthAction = useAction(api.jiraAuth.beginOAuth)
  const disconnectJiraAction = useAction(api.jiraAuth.disconnect)
  const selectSiteMutation = useMutation(api.jiraAuth.selectSite)
  const connectionStatus = useQuery(api.jiraAuth.getConnectionStatus, {})
  const { isLoading: isConvexAuthLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth()
  const { user, isSignedIn } = useUser()

  const [sessionPrefs, setSessionPrefs] = useState<JiraSessionPrefs>(createDefaultSessionPrefs)
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [isConnectingJira, setIsConnectingJira] = useState(false)
  const [isDisconnectingJira, setIsDisconnectingJira] = useState(false)
  const [isSelectingSite, setIsSelectingSite] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [planningRoomUrl, setPlanningRoomUrl] = useState('')

  useEffect(() => {
    setPlanningRoomUrl(`${window.location.origin}/`)

    const stored = readStoredSessionPrefs()
    if (stored) {
      setSessionPrefs(stored)
    }

    const url = new URL(window.location.href)
    const jiraStatus = url.searchParams.get('jira')
    const jiraMessage = url.searchParams.get('jira_message')
    if (jiraStatus === 'connected') {
      setSuccessMessage('Jira connected. You can start planning sessions now.')
    } else if (jiraStatus === 'site_selection') {
      setSuccessMessage('Jira connected. Choose the Jira site to use for this facilitator account.')
    } else if (jiraStatus === 'error') {
      setErrorMessage(jiraMessage || 'Jira connection could not be completed.')
    }

    if (jiraStatus || jiraMessage) {
      url.searchParams.delete('jira')
      url.searchParams.delete('jira_message')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  const normalizedSessionPrefs = useMemo(() => normalizeSessionPrefs(sessionPrefs), [sessionPrefs])

  const isJiraConnected = connectionStatus?.status === 'connected'
  const needsSiteSelection = connectionStatus?.status === 'needs_site_selection'

  const startPlanningSession = async (): Promise<void> => {
    const normalized = normalizeSessionPrefs(sessionPrefs)
    setSessionPrefs(normalized)
    saveSessionPrefs(normalized)

    if (!normalized.ticketPrefix) {
      setErrorMessage('Add a Jira ticket prefix before starting a session.')
      setSuccessMessage('')
      return
    }

    if (!isJiraConnected) {
      setErrorMessage('Connect Jira and choose a Jira site before starting a session.')
      setSuccessMessage('')
      return
    }

    if (!convexBackendUrl) {
      setErrorMessage('Set VITE_CONVEX_URL to connect to the Jira backend.')
      setSuccessMessage('')
      return
    }

    if (isConvexAuthLoading) {
      setErrorMessage('Still establishing authenticated backend session. Try again in a moment.')
      setSuccessMessage('')
      return
    }

    if (!isConvexAuthenticated) {
      setErrorMessage(
        "Signed in to Clerk, but backend auth is not available. Activate Clerk's Convex integration and confirm CLERK_JWT_ISSUER_DOMAIN in Convex.",
      )
      setSuccessMessage('')
      return
    }

    setIsStartingSession(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await loadJiraIssuesAction({
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
    } catch (error: unknown) {
      setErrorMessage(toBackendActionErrorMessage(error))
    } finally {
      setIsStartingSession(false)
    }
  }

  const connectJira = async (): Promise<void> => {
    setIsConnectingJira(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await beginOAuthAction({
        returnTo: `${window.location.origin}/dashboard`,
      })

      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }

      window.location.assign(result.authorizeUrl)
    } catch (error) {
      setErrorMessage(toBackendActionErrorMessage(error))
    } finally {
      setIsConnectingJira(false)
    }
  }

  const disconnectJira = async (): Promise<void> => {
    setIsDisconnectingJira(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await disconnectJiraAction({})
      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }
      setSuccessMessage('Jira disconnected for this facilitator account.')
    } catch (error) {
      setErrorMessage(toBackendActionErrorMessage(error))
    } finally {
      setIsDisconnectingJira(false)
    }
  }

  const selectSite = async (siteId: string): Promise<void> => {
    setIsSelectingSite(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await selectSiteMutation({ siteId })
      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }
      setSuccessMessage('Jira site selected. You can start planning sessions now.')
    } catch (error) {
      setErrorMessage(toBackendActionErrorMessage(error))
    } finally {
      setIsSelectingSite(false)
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 py-10" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-lg">
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
              : 'Sign in to connect Jira and start a session.'}
          </p>
        </div>

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

        {isSignedIn ? (
          <div
            className="rounded-xl border"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div className="border-b p-6" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    Jira Connection
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {isJiraConnected
                      ? `Connected to ${connectionStatus?.siteName || 'your Jira site'}`
                      : needsSiteSelection
                        ? 'Choose which Jira site this facilitator account should use.'
                        : 'Connect your Atlassian account once. Scrummr keeps Jira tokens server-side.'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" onClick={() => void connectJira()} disabled={isConnectingJira || isDisconnectingJira}>
                    {isConnectingJira ? 'Redirecting...' : isJiraConnected || needsSiteSelection ? 'Reconnect Jira' : 'Connect Jira'}
                  </Button>
                  {(isJiraConnected || needsSiteSelection) ? (
                    <Button type="button" variant="ghost" onClick={() => void disconnectJira()} disabled={isConnectingJira || isDisconnectingJira}>
                      {isDisconnectingJira ? 'Disconnecting...' : 'Disconnect'}
                    </Button>
                  ) : null}
                </div>
              </div>

              {isJiraConnected ? (
                <div className="mt-4 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-elevated)' }}>
                  <div style={{ color: 'var(--color-text-primary)' }}>{connectionStatus?.siteName}</div>
                  <div style={{ color: 'var(--color-text-secondary)' }}>{connectionStatus?.siteUrl}</div>
                </div>
              ) : null}

              {needsSiteSelection && connectionStatus?.availableSites?.length ? (
                <div className="mt-4 space-y-2">
                  {connectionStatus.availableSites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      className="w-full rounded-lg border px-3 py-3 text-left transition-colors hover:bg-[var(--color-accent-subtle)]"
                      style={{ borderColor: 'var(--color-border)' }}
                      onClick={() => void selectSite(site.id)}
                      disabled={isSelectingSite}
                    >
                      <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{site.name}</div>
                      <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{site.url}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <form
              className="p-6"
              onSubmit={(event) => {
                event.preventDefault()
                void startPlanningSession()
              }}
            >
              <h2 className="mb-4 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Planning Session
              </h2>

              <div className="space-y-3">
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
                      value={sessionPrefs.ticketPrefix}
                      onChange={(event) => {
                        const nextPrefs = {
                          ...sessionPrefs,
                          ticketPrefix: normalizeTicketPrefix(event.currentTarget.value),
                        }
                        setSessionPrefs(nextPrefs)
                        saveSessionPrefs(nextPrefs)
                      }}
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
                      value={sessionPrefs.quickFilterFieldIds}
                      onChange={(event) => {
                        const nextPrefs = {
                          ...sessionPrefs,
                          quickFilterFieldIds: event.currentTarget.value,
                        }
                        setSessionPrefs(nextPrefs)
                        saveSessionPrefs(nextPrefs)
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <Button type="submit" disabled={isStartingSession || !isJiraConnected || !normalizedSessionPrefs.ticketPrefix} className="flex-1">
                  {isStartingSession ? 'Starting session...' : 'Start planning session'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const nextPrefs = createDefaultSessionPrefs()
                    setSessionPrefs(nextPrefs)
                    setErrorMessage('')
                    setSuccessMessage('')
                    saveSessionPrefs(nextPrefs)
                  }}
                >
                  Clear
                </Button>
              </div>
            </form>

            {connectionStatus?.lastError ? (
              <div className="mx-6 mb-4 rounded-lg border px-3 py-2.5 text-sm" style={{ background: 'var(--color-danger-subtle)', borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
                {connectionStatus.lastError}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mx-6 mb-4 rounded-lg border px-3 py-2.5 text-sm" style={{ background: 'var(--color-danger-subtle)', borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
                {errorMessage}
              </div>
            ) : null}
            {successMessage ? (
              <div className="mx-6 mb-4 rounded-lg border px-3 py-2.5 text-sm" style={{ background: 'var(--color-success-subtle)', borderColor: 'var(--color-success)', color: 'var(--color-success)' }}>
                {successMessage}
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
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
