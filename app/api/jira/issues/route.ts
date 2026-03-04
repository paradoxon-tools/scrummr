import { NextResponse } from 'next/server'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../convex/_generated/api.js'
import type { IssueSubtask, JiraIssue, JiraIssueGroup, JiraIssueResult, JiraSprint } from '../../../../src/lib/protocol'

type JiraConfigPayload = {
  baseUrl?: string
  email?: string
  apiToken?: string
  ticketPrefix?: string
}

type JiraIssueWithSprint = JiraIssue & {
  sprint: JiraSprint | null
  subtasks: IssueSubtask[]
}

type JiraLoadResult = {
  jiraIssues: JiraIssueResult
  jiraSubtasksByIssueId: Record<string, IssueSubtask[]>
}

const jiraPageSize = 100
const jiraMaxPages = 40
const jiraAllowedIssueTypes = new Set(['bug', 'story', 'task'])
const jiraAllowedIssueStatuses = new Set(['to do', 'in progress', 'for testing'])
const jiraToDoStatusCategoryNames = new Set(['new', 'todo', 'to do'])
const jiraInProgressStatusCategoryNames = new Set(['indeterminate', 'in progress'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const normalizeComparableText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ')

const normalizeIssueId = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, 80) : '')

const normalizeTicketPrefix = (value: unknown): string =>
  typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20) : ''

const normalizeJiraOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (!parsed.hostname) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

const toSafeString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value : fallback

const normalizeJiraStatus = (status: string, statusCategory: string): string => {
  const normalizedStatus = normalizeComparableText(status)
  const normalizedStatusCategory = normalizeComparableText(statusCategory)

  if (normalizedStatus === 'for testing') {
    return 'For Testing'
  }

  if (jiraToDoStatusCategoryNames.has(normalizedStatusCategory)) {
    return 'To Do'
  }

  if (jiraInProgressStatusCategoryNames.has(normalizedStatusCategory)) {
    return 'In Progress'
  }

  return status.trim() || 'Unknown'
}

const adfNodeToText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (!isRecord(value)) {
    return ''
  }

  if (value.type === 'hardBreak') {
    return '\n'
  }

  const nodeText = typeof value.text === 'string' ? value.text : ''
  const childText = Array.isArray(value.content) ? value.content.map(adfNodeToText).join('') : ''
  const combined = `${nodeText}${childText}`

  if (value.type === 'paragraph' || value.type === 'heading') {
    return `${combined}\n`
  }

  if (value.type === 'listItem') {
    return `- ${combined}\n`
  }

  return combined
}

const toJiraDescriptionText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').slice(0, 16000)
  }

  if (!isRecord(value) || !Array.isArray(value.content)) {
    return ''
  }

  return value.content.map(adfNodeToText).join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, 16000)
}

const extractJiraFieldText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').slice(0, 16000)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractJiraFieldText(entry)).filter((entry) => entry !== '').join('\n').slice(0, 16000)
  }

  if (!isRecord(value)) {
    return ''
  }

  if (typeof value.displayName === 'string' && value.displayName.trim()) {
    return value.displayName
  }
  if (typeof value.name === 'string' && value.name.trim()) {
    return value.name
  }
  if (typeof value.value === 'string' && value.value.trim()) {
    return value.value
  }

  if (value.type === 'doc' && Array.isArray(value.content)) {
    return toJiraDescriptionText(value)
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, 16000)
  } catch {
    return ''
  }
}

const parseJiraSprint = (value: unknown): JiraSprint | null => {
  if (isRecord(value)) {
    const id = Number.parseInt(String(value.id ?? ''), 10)
    if (!Number.isFinite(id) || id <= 0) {
      return null
    }

    return {
      id,
      name: toSafeString(value.name, `Sprint ${id}`),
      state: typeof value.state === 'string' ? value.state.toLowerCase() : 'unknown',
      startDate: typeof value.startDate === 'string' ? value.startDate : null,
      endDate: typeof value.endDate === 'string' ? value.endDate : null,
      completeDate: typeof value.completeDate === 'string' ? value.completeDate : null,
    }
  }

  if (typeof value !== 'string') {
    return null
  }

  const readField = (fieldName: string): string | null => {
    const match = value.match(new RegExp(`\\b${fieldName}=([^,\\]]+)`))
    if (!match) {
      return null
    }
    const parsed = match[1].trim()
    if (!parsed || parsed === '<null>') {
      return null
    }
    return parsed
  }

  const rawId = readField('id')
  const id = rawId === null ? Number.NaN : Number.parseInt(rawId, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return null
  }

  return {
    id,
    name: readField('name') ?? `Sprint ${id}`,
    state: (readField('state') ?? 'unknown').toLowerCase(),
    startDate: readField('startDate'),
    endDate: readField('endDate'),
    completeDate: readField('completeDate'),
  }
}

const parseIssueSprint = (value: unknown): JiraSprint | null => {
  if (Array.isArray(value)) {
    const parsed = value.map(parseJiraSprint).filter((entry): entry is JiraSprint => entry !== null)
    if (parsed.length === 0) {
      return null
    }

    const active = parsed.find((entry) => entry.state === 'active')
    if (active) {
      return active
    }
    const future = parsed.find((entry) => entry.state === 'future')
    if (future) {
      return future
    }
    return parsed[parsed.length - 1]
  }

  return parseJiraSprint(value)
}

const normalizeJiraSubtaskStatusCategory = (value: unknown): string => {
  if (!isRecord(value)) {
    return ''
  }
  if (typeof value.key === 'string' && value.key.trim()) {
    return normalizeComparableText(value.key)
  }
  if (typeof value.name === 'string' && value.name.trim()) {
    return normalizeComparableText(value.name)
  }
  return ''
}

const parseJiraSubtasks = (jiraOrigin: string, value: unknown): IssueSubtask[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const subtasksById = new Map<string, IssueSubtask>()
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue
    }

    const subtaskId = normalizeIssueId(candidate.id)
    if (!subtaskId || subtasksById.has(subtaskId)) {
      continue
    }

    const fields = isRecord(candidate.fields) ? candidate.fields : {}
    const subtaskKey = typeof candidate.key === 'string' ? candidate.key.trim() : ''
    const fallbackTitle = subtaskKey || 'Subtask'
    const title = toSafeString(fields.summary, fallbackTitle).slice(0, 240)
    if (!title) {
      continue
    }

    const statusField = isRecord(fields.status) ? fields.status : {}
    const statusCategory = normalizeJiraSubtaskStatusCategory(statusField.statusCategory)
    subtasksById.set(subtaskId, {
      id: subtaskId,
      key: subtaskKey,
      url: subtaskKey ? `${jiraOrigin}/browse/${encodeURIComponent(subtaskKey)}` : null,
      title,
      description: toJiraDescriptionText(fields.description),
      done: statusCategory === 'done',
    })
  }

  return [...subtasksById.values()].slice(0, 100)
}

const buildIssueFields = (fields: Record<string, unknown>, normalizedStatus: string) => {
  const candidates: Array<{ id: string; label: string; value: unknown }> = [
    { id: 'summary', label: 'Summary', value: fields.summary },
    { id: 'description', label: 'Description', value: fields.description },
    { id: 'status', label: 'Status', value: normalizedStatus },
    { id: 'priority', label: 'Priority', value: fields.priority },
    { id: 'assignee', label: 'Assignee', value: fields.assignee },
    { id: 'issue_type', label: 'Issue Type', value: fields.issuetype },
    { id: 'reporter', label: 'Reporter', value: fields.reporter },
    { id: 'created', label: 'Created', value: fields.created },
    { id: 'updated', label: 'Updated', value: fields.updated },
  ]

  return candidates
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      value: extractJiraFieldText(entry.value),
    }))
    .filter((entry) => entry.value !== '' || entry.id === 'description')
}

const mapJiraIssues = (jiraOrigin: string, payload: unknown): JiraIssueWithSprint[] | null => {
  if (!isRecord(payload) || !Array.isArray(payload.issues)) {
    return null
  }

  return payload.issues
    .filter((issue): issue is Record<string, unknown> => isRecord(issue))
    .map((issue) => {
      const key = toSafeString(issue.key, 'UNKNOWN')
      const id = toSafeString(issue.id, key)
      const fields = isRecord(issue.fields) ? issue.fields : {}
      const statusField = isRecord(fields.status) ? fields.status : {}
      const statusCategoryField = isRecord(statusField.statusCategory) ? statusField.statusCategory : {}
      const assigneeField = isRecord(fields.assignee) ? fields.assignee : {}
      const priorityField = isRecord(fields.priority) ? fields.priority : {}
      const issueTypeField = isRecord(fields.issuetype) ? fields.issuetype : {}
      const reporterField = isRecord(fields.reporter) ? fields.reporter : {}
      const rawStatus = toSafeString(statusField.name, 'Unknown')
      const rawStatusCategory =
        typeof statusCategoryField.key === 'string'
          ? statusCategoryField.key
          : typeof statusCategoryField.name === 'string'
            ? statusCategoryField.name
            : ''
      const normalizedStatus = normalizeJiraStatus(rawStatus, rawStatusCategory)

      return {
        id,
        key,
        summary: toSafeString(fields.summary, '(no summary)'),
        description: toJiraDescriptionText(fields.description),
        status: normalizedStatus,
        assignee: typeof assigneeField.displayName === 'string' ? assigneeField.displayName : null,
        priority: typeof priorityField.name === 'string' ? priorityField.name : null,
        issueType: toSafeString(issueTypeField.name, 'Issue'),
        reporter: typeof reporterField.displayName === 'string' ? reporterField.displayName : null,
        createdAt: typeof fields.created === 'string' ? fields.created : null,
        updatedAt: typeof fields.updated === 'string' ? fields.updated : null,
        url: `${jiraOrigin}/browse/${encodeURIComponent(key)}`,
        isEstimated: false,
        fields: buildIssueFields(fields, normalizedStatus),
        sprint: parseIssueSprint(fields.sprint),
        subtasks: parseJiraSubtasks(jiraOrigin, fields.subtasks),
      }
    })
}

const jiraErrorMessage = (status: number, payload: unknown): string => {
  if (isRecord(payload)) {
    if (Array.isArray(payload.errorMessages) && typeof payload.errorMessages[0] === 'string') {
      return payload.errorMessages[0]
    }
    if (typeof payload.message === 'string') {
      return payload.message
    }
  }

  return `Jira returned HTTP ${status}.`
}

const jiraRequestHeaders = (authorization: string): Record<string, string> => ({
  Authorization: `Basic ${authorization}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
})

const toDateMs = (value: string | null): number => {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

const withoutSprint = (issue: JiraIssueWithSprint): JiraIssue => ({
  id: issue.id,
  key: issue.key,
  summary: issue.summary,
  description: issue.description,
  status: issue.status,
  assignee: issue.assignee,
  priority: issue.priority,
  issueType: issue.issueType,
  reporter: issue.reporter,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
  url: issue.url,
  isEstimated: issue.isEstimated,
  fields: issue.fields.map((field: JiraIssue['fields'][number]) => ({ ...field })),
})

const groupIssuesBySprint = (issues: JiraIssueWithSprint[], category: 'current' | 'future'): JiraIssueGroup[] => {
  const grouped = new Map<string, JiraIssueGroup>()

  for (const issue of issues) {
    const groupId = issue.sprint ? `${category}-${issue.sprint.id}` : `${category}-unspecified`
    const existing = grouped.get(groupId)
    if (existing) {
      existing.issues.push(withoutSprint(issue))
      continue
    }

    grouped.set(groupId, {
      id: groupId,
      name: issue.sprint?.name ?? (category === 'current' ? 'Current sprint' : 'Future sprint'),
      category,
      sprint: issue.sprint,
      issues: [withoutSprint(issue)],
    })
  }

  return [...grouped.values()].sort((a, b) => {
    const aStartDate = toDateMs(a.sprint?.startDate ?? null)
    const bStartDate = toDateMs(b.sprint?.startDate ?? null)
    if (aStartDate !== bStartDate) {
      return aStartDate - bStartDate
    }
    return a.name.localeCompare(b.name)
  })
}

const fetchAllSearchIssues = async (
  jiraOrigin: string,
  authorization: string,
  jql: string,
): Promise<JiraIssueWithSprint[] | NextResponse> => {
  let startAt = 0
  let page = 0
  const issues: JiraIssueWithSprint[] = []

  while (page < jiraMaxPages) {
    let response: Response
    let payload: unknown
    try {
      response = await fetch(`${jiraOrigin}/rest/api/3/search`, {
        method: 'POST',
        headers: jiraRequestHeaders(authorization),
        body: JSON.stringify({
          jql,
          startAt,
          maxResults: jiraPageSize,
          fields: ['*all'],
        }),
      })

      try {
        payload = await response.json()
      } catch {
        payload = null
      }
    } catch {
      return NextResponse.json({ message: 'Could not reach Jira while loading board issues.' }, { status: 502 })
    }

    if (!response.ok) {
      return NextResponse.json({ message: jiraErrorMessage(response.status, payload) }, { status: response.status })
    }

    const pageIssues = mapJiraIssues(jiraOrigin, payload)
    if (!pageIssues) {
      return NextResponse.json({ message: 'Unexpected Jira issue response format.' }, { status: 502 })
    }

    issues.push(...pageIssues)

    const total = isRecord(payload) && typeof payload.total === 'number' ? payload.total : null
    if (pageIssues.length === 0) {
      break
    }
    if (total !== null && startAt + jiraPageSize >= total) {
      break
    }
    if (total === null && pageIssues.length < jiraPageSize) {
      break
    }

    startAt += jiraPageSize
    page += 1
  }

  return issues
}

const isAllowedJiraIssueType = (issueType: string): boolean => jiraAllowedIssueTypes.has(issueType.trim().toLowerCase())
const isAllowedJiraIssueStatus = (status: string): boolean => jiraAllowedIssueStatuses.has(normalizeComparableText(status))

const fetchJiraIssues = async (body: JiraConfigPayload): Promise<JiraLoadResult | NextResponse> => {
  const jiraOrigin = normalizeJiraOrigin(body.baseUrl)
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : ''
  const ticketPrefix = normalizeTicketPrefix(body.ticketPrefix)

  if (!jiraOrigin || !email || !apiToken || !ticketPrefix) {
    return NextResponse.json({ message: 'Jira URL, email, API token, and ticket prefix are required.' }, { status: 400 })
  }

  const authorization = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const projectClause = `project = "${ticketPrefix}"`
  const currentSprintJql = `${projectClause} AND sprint in openSprints() ORDER BY Rank ASC, created ASC`
  const nextSprintJql = `${projectClause} AND sprint in futureSprints() ORDER BY Rank ASC, created ASC`
  const backlogJql = `${projectClause} AND sprint is EMPTY ORDER BY Rank ASC, created ASC`

  const [currentIssuesResult, nextIssuesResult, backlogIssuesResult] = await Promise.all([
    fetchAllSearchIssues(jiraOrigin, authorization, currentSprintJql),
    fetchAllSearchIssues(jiraOrigin, authorization, nextSprintJql),
    fetchAllSearchIssues(jiraOrigin, authorization, backlogJql),
  ])

  if (currentIssuesResult instanceof NextResponse) {
    return currentIssuesResult
  }
  if (nextIssuesResult instanceof NextResponse) {
    return nextIssuesResult
  }
  if (backlogIssuesResult instanceof NextResponse) {
    return backlogIssuesResult
  }

  const filteredCurrentIssues = currentIssuesResult.filter(
    (issue) => isAllowedJiraIssueType(issue.issueType) && isAllowedJiraIssueStatus(issue.status),
  )
  const filteredNextIssues = nextIssuesResult.filter(
    (issue) => isAllowedJiraIssueType(issue.issueType) && isAllowedJiraIssueStatus(issue.status),
  )
  const filteredBacklogIssues = backlogIssuesResult.filter(
    (issue) => isAllowedJiraIssueType(issue.issueType) && isAllowedJiraIssueStatus(issue.status),
  )

  const groups: JiraIssueGroup[] = [...groupIssuesBySprint(filteredCurrentIssues, 'current'), ...groupIssuesBySprint(filteredNextIssues, 'future')]
  if (filteredBacklogIssues.length > 0) {
    groups.push({
      id: 'backlog',
      name: 'Backlog / No sprint',
      category: 'backlog',
      sprint: null,
      issues: filteredBacklogIssues.map(withoutSprint),
    })
  }

  const jiraSubtasksByIssueId: Record<string, IssueSubtask[]> = {}
  const registerIssueSubtasks = (issue: JiraIssueWithSprint): void => {
    const issueId = normalizeIssueId(issue.id)
    if (!issueId) {
      return
    }

    jiraSubtasksByIssueId[issueId] = issue.subtasks.map((subtask: IssueSubtask) => ({ ...subtask })).slice(0, 100)
  }

  for (const issue of filteredCurrentIssues) {
    registerIssueSubtasks(issue)
  }
  for (const issue of filteredNextIssues) {
    registerIssueSubtasks(issue)
  }
  for (const issue of filteredBacklogIssues) {
    registerIssueSubtasks(issue)
  }

  return {
    jiraIssues: { groups },
    jiraSubtasksByIssueId,
  }
}

const resolveConvexUrl = (): string => {
  const fromServer = process.env.CONVEX_URL?.trim()
  const fromPublic = process.env.NEXT_PUBLIC_CONVEX_URL?.trim()
  return fromServer || fromPublic || ''
}

export async function POST(request: Request) {
  let body: JiraConfigPayload
  try {
    body = (await request.json()) as JiraConfigPayload
  } catch {
    return NextResponse.json({ message: 'Invalid JSON payload.' }, { status: 400 })
  }

  const jiraIssueFetchResult = await fetchJiraIssues(body)
  if (jiraIssueFetchResult instanceof NextResponse) {
    return jiraIssueFetchResult
  }

  const convexUrl = resolveConvexUrl()
  if (!convexUrl) {
    return NextResponse.json({ message: 'Convex URL is not configured.' }, { status: 500 })
  }

  const requesterId = request.headers.get('x-scrummer-participant-id')?.trim() ?? ''
  const convex = new ConvexHttpClient(convexUrl)
  const stored = await convex.mutation(api.room.setJiraIssues, {
    participantId: requesterId,
    jiraIssues: jiraIssueFetchResult.jiraIssues,
    jiraSubtasksByIssueId: jiraIssueFetchResult.jiraSubtasksByIssueId,
  })

  if (!stored || typeof stored !== 'object' || stored.ok !== true) {
    return NextResponse.json({ message: 'Failed to store Jira tickets in room state.' }, { status: 500 })
  }

  return NextResponse.json(jiraIssueFetchResult.jiraIssues)
}
