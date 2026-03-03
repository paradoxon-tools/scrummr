import {
  ESTIMATE_OPTIONS,
  type ClientEvent,
  type EstimateOption,
  type IssueDraftSnapshot,
  type IssueEditorField,
  type IssuePresenceSnapshot,
  type JiraIssue,
  type JiraIssueGroup,
  type JiraIssueResult,
  type JiraSprint,
  type RoomStateSnapshot,
  type ServerEvent,
} from './src/lib/protocol'

type UserState = {
  name: string
  colorHue: number
  vote: EstimateOption | null
}

type SocketData = {
  id: string
}

type JiraIssueWithSprint = JiraIssue & {
  sprint: JiraSprint | null
}

const port = Number(Bun.env.WS_PORT ?? 3001)
const allowedVotes = new Set<string>(ESTIMATE_OPTIONS)
const users = new Map<string, UserState>()
const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>()
const decoder = new TextDecoder()
const jiraPageSize = 100
const jiraMaxPages = 40
const jiraBaseIssueFields = ['summary', 'description', 'status', 'assignee', 'priority', 'issuetype', 'reporter', 'created', 'updated']
const jiraAllowedIssueTypes = new Set(['bug', 'story'])
const jiraCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const issueFieldMaxLength = 16000
const issueFieldLabelMaxLength = 80
const issueFieldIdMaxLength = 80
const issueKeyMaxLength = 40
const issueUrlMaxLength = 600
const subtaskTitleMaxLength = 240
const subtaskDescriptionMaxLength = 16000
const maxSubtasksPerIssue = 100
const maxIssueFieldsPerDraft = 64
const issuePresenceTargetIdMaxLength = 120

let revealed = false
let selectedIssueId: string | null = null

const issueDrafts = new Map<string, IssueDraftSnapshot>()
const issuePresenceByIssue = new Map<string, Map<string, Set<string>>>()
let sharedJiraIssues: JiraIssueResult | null = null

const hueDistance = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

const pickDistinctHue = (excludeUserId?: string, avoidHue?: number): number => {
  const usedHues = [...users.entries()]
    .filter(([id]) => id !== excludeUserId)
    .map(([, user]) => user.colorHue)

  if (usedHues.length === 0) {
    const randomHue = Math.floor(Math.random() * 360)
    if (avoidHue === undefined || randomHue !== avoidHue) {
      return randomHue
    }

    return (randomHue + 137) % 360
  }

  let bestHue = Math.floor(Math.random() * 360)
  let bestScore = -1

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const candidate = Math.floor(Math.random() * 360)
    let closestDistance = 180

    for (const usedHue of usedHues) {
      closestDistance = Math.min(closestDistance, hueDistance(candidate, usedHue))
    }

    const score = avoidHue !== undefined && candidate === avoidHue ? closestDistance - 360 : closestDistance

    if (score > bestScore) {
      bestHue = candidate
      bestScore = score
    }
  }

  if (avoidHue !== undefined && bestHue === avoidHue) {
    return (bestHue + 137) % 360
  }

  return bestHue
}

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').slice(0, 40)

const normalizeIssueId = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, issueFieldIdMaxLength) : ''

const normalizeIssueKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase().slice(0, issueKeyMaxLength) : ''

const normalizeIssueUrl = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, issueUrlMaxLength) : '')

const normalizeIssueText = (value: unknown, maxLength = issueFieldMaxLength): string =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').slice(0, maxLength) : ''

const normalizeFieldId = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, issueFieldIdMaxLength)
}

const normalizeIssuePresenceTargetId = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, '_')
    .slice(0, issuePresenceTargetIdMaxLength)
}

const normalizeFieldLabel = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback.slice(0, issueFieldLabelMaxLength)
  }

  const normalized = value.trim().slice(0, issueFieldLabelMaxLength)
  return normalized || fallback.slice(0, issueFieldLabelMaxLength)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const jsonResponse = (status: number, payload: Record<string, unknown>): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...jiraCorsHeaders,
      'Content-Type': 'application/json',
    },
  })

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

const normalizeTicketPrefix = (value: unknown): string =>
  typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20) : ''

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
    return normalizeIssueText(value)
  }

  if (!isRecord(value) || !Array.isArray(value.content)) {
    return ''
  }

  return normalizeIssueText(value.content.map(adfNodeToText).join('').replace(/\n{3,}/g, '\n\n').trim())
}

const toNormalizedSprintState = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'unknown'

const toNullableDate = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

const parseJiraSprint = (value: unknown): JiraSprint | null => {
  if (isRecord(value)) {
    const id = Number.parseInt(String(value.id ?? ''), 10)
    if (!Number.isFinite(id) || id <= 0) {
      return null
    }

    return {
      id,
      name: toSafeString(value.name, `Sprint ${id}`),
      state: toNormalizedSprintState(value.state),
      startDate: toNullableDate(value.startDate),
      endDate: toNullableDate(value.endDate),
      completeDate: toNullableDate(value.completeDate),
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
    state: toNormalizedSprintState(readField('state')),
    startDate: readField('startDate'),
    endDate: readField('endDate'),
    completeDate: readField('completeDate'),
  }
}

const pickPreferredSprint = (
  candidates: JiraSprint[],
  preferredState: 'active' | 'future' | null,
): JiraSprint | null => {
  if (candidates.length === 0) {
    return null
  }

  if (preferredState) {
    const preferred = candidates.find((sprint) => sprint.state === preferredState)
    if (preferred) {
      return preferred
    }
  }

  const active = candidates.find((sprint) => sprint.state === 'active')
  if (active) {
    return active
  }

  const future = candidates.find((sprint) => sprint.state === 'future')
  if (future) {
    return future
  }

  return candidates[candidates.length - 1]
}

const parseIssueSprint = (value: unknown, preferredState: 'active' | 'future' | null): JiraSprint | null => {
  if (Array.isArray(value)) {
    const parsedSprints = value.map(parseJiraSprint).filter((sprint): sprint is JiraSprint => sprint !== null)
    return pickPreferredSprint(parsedSprints, preferredState)
  }

  return parseJiraSprint(value)
}

const normalizeIssueEditorField = (value: unknown): IssueEditorField | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = normalizeFieldId(value.id)
  if (!id) {
    return null
  }

  return {
    id,
    label: normalizeFieldLabel(value.label, id),
    value: normalizeIssueText(value.value),
  }
}

const normalizeIssueEditorFields = (value: unknown): IssueEditorField[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const uniqueFields = new Map<string, IssueEditorField>()
  for (const fieldCandidate of value) {
    const field = normalizeIssueEditorField(fieldCandidate)
    if (!field) {
      continue
    }

    if (uniqueFields.size >= maxIssueFieldsPerDraft && !uniqueFields.has(field.id)) {
      continue
    }

    uniqueFields.set(field.id, field)
  }

  return [...uniqueFields.values()]
}

const cloneIssueDraft = (draft: IssueDraftSnapshot): IssueDraftSnapshot => ({
  issueId: draft.issueId,
  issueKey: draft.issueKey,
  issueUrl: draft.issueUrl,
  fields: draft.fields.map((field) => ({ ...field })),
  subtasks: draft.subtasks.map((subtask) => ({ ...subtask })),
  updatedBy: draft.updatedBy,
  updatedAt: draft.updatedAt,
})

const cloneJiraIssueResult = (result: JiraIssueResult): JiraIssueResult => ({
  groups: result.groups.map((group) => ({
    id: group.id,
    name: group.name,
    category: group.category,
    sprint: group.sprint ? { ...group.sprint } : null,
    issues: group.issues.map((issue) => ({ ...issue })),
  })),
})

const touchIssueDraft = (draft: IssueDraftSnapshot, updatedBy: string | null): void => {
  draft.updatedBy = updatedBy
  draft.updatedAt = new Date().toISOString()
}

const ensureIssueDraft = (
  issueId: string,
  issueKey: string,
  issueUrl: string,
  seedFields: IssueEditorField[],
  updatedBy: string | null,
): IssueDraftSnapshot => {
  const existing = issueDrafts.get(issueId)
  if (existing) {
    if (issueKey) {
      existing.issueKey = issueKey
    }
    if (issueUrl) {
      existing.issueUrl = issueUrl
    }

    if (seedFields.length > 0) {
      const existingFieldIds = new Set(existing.fields.map((field) => field.id))
      for (const seedField of seedFields) {
        if (existing.fields.length >= maxIssueFieldsPerDraft) {
          break
        }

        if (existingFieldIds.has(seedField.id)) {
          continue
        }

        existing.fields.push(seedField)
        existingFieldIds.add(seedField.id)
      }
    }

    touchIssueDraft(existing, updatedBy)
    return existing
  }

  const fields = seedFields.length > 0 ? seedFields : [{ id: 'description', label: 'Description', value: '' }]
  const draft: IssueDraftSnapshot = {
    issueId,
    issueKey,
    issueUrl,
    fields,
    subtasks: [],
    updatedBy,
    updatedAt: new Date().toISOString(),
  }

  issueDrafts.set(issueId, draft)
  return draft
}

const setIssuePresenceState = (clientId: string, issueId: string, targetId: string, active: boolean): boolean => {
  const normalizedIssueId = normalizeIssueId(issueId)
  const normalizedTargetId = normalizeIssuePresenceTargetId(targetId)
  if (!normalizedIssueId || !normalizedTargetId) {
    return false
  }

  if (active) {
    let issueTargets = issuePresenceByIssue.get(normalizedIssueId)
    if (!issueTargets) {
      issueTargets = new Map<string, Set<string>>()
      issuePresenceByIssue.set(normalizedIssueId, issueTargets)
    }

    let participants = issueTargets.get(normalizedTargetId)
    if (!participants) {
      participants = new Set<string>()
      issueTargets.set(normalizedTargetId, participants)
    }

    const previousSize = participants.size
    participants.add(clientId)
    return participants.size !== previousSize
  }

  const issueTargets = issuePresenceByIssue.get(normalizedIssueId)
  if (!issueTargets) {
    return false
  }

  const participants = issueTargets.get(normalizedTargetId)
  if (!participants) {
    return false
  }

  const changed = participants.delete(clientId)
  if (participants.size === 0) {
    issueTargets.delete(normalizedTargetId)
  }
  if (issueTargets.size === 0) {
    issuePresenceByIssue.delete(normalizedIssueId)
  }

  return changed
}

const clearClientIssuePresence = (clientId: string): boolean => {
  let changed = false
  for (const [issueId, issueTargets] of issuePresenceByIssue.entries()) {
    for (const [targetId, participants] of issueTargets.entries()) {
      const removed = participants.delete(clientId)
      changed = changed || removed
      if (participants.size === 0) {
        issueTargets.delete(targetId)
      }
    }

    if (issueTargets.size === 0) {
      issuePresenceByIssue.delete(issueId)
    }
  }

  return changed
}

const clearIssuePresenceByPrefix = (issueId: string, targetPrefix: string): boolean => {
  const normalizedIssueId = normalizeIssueId(issueId)
  const normalizedTargetPrefix = normalizeIssuePresenceTargetId(targetPrefix)
  if (!normalizedIssueId || !normalizedTargetPrefix) {
    return false
  }

  const issueTargets = issuePresenceByIssue.get(normalizedIssueId)
  if (!issueTargets) {
    return false
  }

  let changed = false
  for (const targetId of [...issueTargets.keys()]) {
    if (!targetId.startsWith(normalizedTargetPrefix)) {
      continue
    }

    issueTargets.delete(targetId)
    changed = true
  }

  if (issueTargets.size === 0) {
    issuePresenceByIssue.delete(normalizedIssueId)
  }

  return changed
}

const toIssuePresenceSnapshot = (): IssuePresenceSnapshot[] => {
  const snapshots: IssuePresenceSnapshot[] = []

  for (const [issueId, issueTargets] of issuePresenceByIssue.entries()) {
    for (const [targetId, participants] of issueTargets.entries()) {
      const participantIds = [...participants].filter((participantId) => users.has(participantId))
      if (participantIds.length === 0) {
        continue
      }

      participantIds.sort((a, b) => {
        const nameA = users.get(a)?.name ?? a
        const nameB = users.get(b)?.name ?? b
        return nameA.localeCompare(nameB)
      })

      snapshots.push({
        issueId,
        targetId,
        participantIds,
      })
    }
  }

  return snapshots.sort((a, b) => {
    if (a.issueId !== b.issueId) {
      return a.issueId.localeCompare(b.issueId)
    }

    return a.targetId.localeCompare(b.targetId)
  })
}

const toWorkspaceSnapshot = (): RoomStateSnapshot['issueWorkspace'] => ({
  selectedIssueId,
  drafts: [...issueDrafts.values()]
    .sort((a, b) => a.issueKey.localeCompare(b.issueKey))
    .map((draft) => cloneIssueDraft(draft)),
  presence: toIssuePresenceSnapshot(),
})

const normalizeSubtaskTitle = (value: unknown): string => normalizeIssueText(value, subtaskTitleMaxLength).trim()

const normalizeSubtaskDescription = (value: unknown): string => normalizeIssueText(value, subtaskDescriptionMaxLength)

const mapJiraIssues = (
  jiraOrigin: string,
  payload: unknown,
  sprintFieldId: string | null,
  preferredSprintState: 'active' | 'future' | null,
): JiraIssueWithSprint[] | null => {
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
      const assigneeField = isRecord(fields.assignee) ? fields.assignee : {}
      const priorityField = isRecord(fields.priority) ? fields.priority : {}
      const issueTypeField = isRecord(fields.issuetype) ? fields.issuetype : {}
      const reporterField = isRecord(fields.reporter) ? fields.reporter : {}
      const sprintField = sprintFieldId && fields[sprintFieldId] !== undefined ? fields[sprintFieldId] : fields.sprint

      return {
        id,
        key,
        summary: toSafeString(fields.summary, '(no summary)'),
        description: toJiraDescriptionText(fields.description),
        status: toSafeString(statusField.name, 'Unknown'),
        assignee: typeof assigneeField.displayName === 'string' ? assigneeField.displayName : null,
        priority: typeof priorityField.name === 'string' ? priorityField.name : null,
        issueType: toSafeString(issueTypeField.name, 'Issue'),
        reporter: typeof reporterField.displayName === 'string' ? reporterField.displayName : null,
        createdAt: typeof fields.created === 'string' ? fields.created : null,
        updatedAt: typeof fields.updated === 'string' ? fields.updated : null,
        url: `${jiraOrigin}/browse/${encodeURIComponent(key)}`,
        sprint: parseIssueSprint(sprintField, preferredSprintState),
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

const fetchSprintFieldId = async (jiraOrigin: string, authorization: string): Promise<string | null> => {
  let response: Response
  let payload: unknown

  try {
    response = await fetch(`${jiraOrigin}/rest/api/3/field`, {
      method: 'GET',
      headers: jiraRequestHeaders(authorization),
    })

    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  } catch {
    return null
  }

  if (!response.ok || !Array.isArray(payload)) {
    return null
  }

  for (const field of payload) {
    if (!isRecord(field) || typeof field.id !== 'string') {
      continue
    }

    const schema = isRecord(field.schema) ? field.schema : null
    const customSchema = schema && typeof schema.custom === 'string' ? schema.custom.toLowerCase() : ''
    const fieldName = typeof field.name === 'string' ? field.name.trim().toLowerCase() : ''

    if (customSchema.includes('gh-sprint') || fieldName === 'sprint') {
      return field.id
    }
  }

  return null
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
})

const toDateMs = (value: string | null): number => {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

const isAllowedJiraIssueType = (issueType: string): boolean => jiraAllowedIssueTypes.has(issueType.trim().toLowerCase())

const groupIssuesBySprint = (
  issues: JiraIssueWithSprint[],
  category: 'current' | 'future',
): JiraIssueGroup[] => {
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
  issueFields: string[],
  sprintFieldId: string | null,
  preferredSprintState: 'active' | 'future' | null,
): Promise<JiraIssueWithSprint[] | Response> => {
  let startAt = 0
  let nextPageToken: string | null = null
  let useLegacyEndpoint = false
  let page = 0
  const issues: JiraIssueWithSprint[] = []

  while (page < jiraMaxPages) {
    let response: Response
    let payload: unknown
    try {
      if (useLegacyEndpoint) {
        response = await fetch(`${jiraOrigin}/rest/api/3/search`, {
          method: 'POST',
          headers: jiraRequestHeaders(authorization),
          body: JSON.stringify({
            jql,
            startAt,
            maxResults: jiraPageSize,
            fields: issueFields,
          }),
        })
      } else {
        response = await fetch(`${jiraOrigin}/rest/api/3/search/jql`, {
          method: 'POST',
          headers: jiraRequestHeaders(authorization),
          body: JSON.stringify({
            jql,
            nextPageToken: nextPageToken ?? undefined,
            maxResults: jiraPageSize,
            fields: issueFields,
          }),
        })

        if (response.status === 404) {
          useLegacyEndpoint = true
          continue
        }
      }

      try {
        payload = await response.json()
      } catch {
        payload = null
      }
    } catch {
      return jsonResponse(502, { message: 'Could not reach Jira while loading board issues.' })
    }

    if (!response.ok) {
      return jsonResponse(response.status, { message: jiraErrorMessage(response.status, payload) })
    }

    const pageIssues = mapJiraIssues(jiraOrigin, payload, sprintFieldId, preferredSprintState)
    if (!pageIssues) {
      return jsonResponse(502, { message: 'Unexpected Jira issue response format.' })
    }

    issues.push(...pageIssues)

    if (useLegacyEndpoint) {
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
    } else {
      const payloadRecord = isRecord(payload) ? payload : null
      const hasMore =
        payloadRecord !== null &&
        typeof payloadRecord.nextPageToken === 'string' &&
        payloadRecord.nextPageToken.length > 0 &&
        payloadRecord.isLast !== true

      if (!hasMore || pageIssues.length === 0) {
        break
      }

      nextPageToken = payloadRecord.nextPageToken as string
    }

    page += 1
  }

  return issues
}

const fetchJiraIssues = async (request: Request): Promise<JiraIssueResult | Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON payload.' })
  }

  if (!isRecord(body)) {
    return jsonResponse(400, { message: 'Payload must be an object.' })
  }

  const jiraOrigin = normalizeJiraOrigin(body.baseUrl)
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : ''
  const ticketPrefix = normalizeTicketPrefix(body.ticketPrefix)

  if (!jiraOrigin || !email || !apiToken || !ticketPrefix) {
    return jsonResponse(400, { message: 'Jira URL, email, API token, and ticket prefix are required.' })
  }

  const authorization = Buffer.from(`${email}:${apiToken}`).toString('base64')
  const sprintFieldId = await fetchSprintFieldId(jiraOrigin, authorization)
  const issueFields = sprintFieldId ? [...jiraBaseIssueFields, sprintFieldId] : jiraBaseIssueFields

  const projectClause = `project = "${ticketPrefix}"`
  const currentSprintJql = `${projectClause} AND sprint in openSprints() ORDER BY Rank ASC, created ASC`
  const nextSprintJql = `${projectClause} AND sprint in futureSprints() ORDER BY Rank ASC, created ASC`
  const backlogJql = `${projectClause} AND sprint is EMPTY ORDER BY Rank ASC, created ASC`

  const [currentIssuesResult, nextIssuesResult, backlogIssuesResult] = await Promise.all([
    fetchAllSearchIssues(jiraOrigin, authorization, currentSprintJql, issueFields, sprintFieldId, 'active'),
    fetchAllSearchIssues(jiraOrigin, authorization, nextSprintJql, issueFields, sprintFieldId, 'future'),
    fetchAllSearchIssues(jiraOrigin, authorization, backlogJql, issueFields, sprintFieldId, null),
  ])

  if (currentIssuesResult instanceof Response) {
    return currentIssuesResult
  }
  if (nextIssuesResult instanceof Response) {
    return nextIssuesResult
  }
  if (backlogIssuesResult instanceof Response) {
    return backlogIssuesResult
  }

  const filteredCurrentIssues = currentIssuesResult.filter((issue) => isAllowedJiraIssueType(issue.issueType))
  const filteredNextIssues = nextIssuesResult.filter((issue) => isAllowedJiraIssueType(issue.issueType))
  const filteredBacklogIssues = backlogIssuesResult.filter((issue) => isAllowedJiraIssueType(issue.issueType))

  const groups: JiraIssueGroup[] = [
    ...groupIssuesBySprint(filteredCurrentIssues, 'current'),
    ...groupIssuesBySprint(filteredNextIssues, 'future'),
  ]

  if (filteredBacklogIssues.length > 0) {
    groups.push({
      id: 'backlog',
      name: 'Backlog / No sprint',
      category: 'backlog',
      sprint: null,
      issues: filteredBacklogIssues.map(withoutSprint),
    })
  }

  const response: JiraIssueResult = {
    groups,
  }

  return response
}

const parseClientEvent = (rawMessage: string | Uint8Array | ArrayBuffer): ClientEvent | null => {
  const text =
    typeof rawMessage === 'string'
      ? rawMessage
      : decoder.decode(rawMessage instanceof ArrayBuffer ? new Uint8Array(rawMessage) : rawMessage)

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null
    }
    return parsed as ClientEvent
  } catch {
    return null
  }
}

const makeSnapshot = (clientId: string): RoomStateSnapshot => {
  const participants = [...users.entries()]
    .map(([id, user]) => ({
      id,
      name: user.name,
      colorHue: user.colorHue,
      hasVoted: user.vote !== null,
      vote: revealed ? user.vote : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    revealed,
    myId: clientId,
    myVote: users.get(clientId)?.vote ?? null,
    participants,
    issueWorkspace: toWorkspaceSnapshot(),
    jiraIssues: sharedJiraIssues ? cloneJiraIssueResult(sharedJiraIssues) : null,
  }
}

const send = (ws: Bun.ServerWebSocket<SocketData>, event: ServerEvent): void => {
  ws.send(JSON.stringify(event))
}

const sendSnapshot = (clientId: string): void => {
  const ws = sockets.get(clientId)
  if (!ws) {
    return
  }
  send(ws, { type: 'state_snapshot', state: makeSnapshot(clientId) })
}

const broadcastSnapshots = (): void => {
  for (const clientId of sockets.keys()) {
    sendSnapshot(clientId)
  }
}

const resetRound = (): void => {
  revealed = false
  for (const user of users.values()) {
    user.vote = null
  }
}

const setVote = (clientId: string, vote: EstimateOption | null): boolean => {
  const user = users.get(clientId)
  if (!user) {
    return false
  }

  if (vote === null) {
    user.vote = null
    return true
  }

  if (!allowedVotes.has(vote)) {
    return false
  }

  user.vote = vote
  return true
}

const server = Bun.serve<SocketData>({
  port,
  async fetch(request, serverInstance) {
    const requestUrl = new URL(request.url)

    if (requestUrl.pathname === '/api/jira/issues' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: jiraCorsHeaders })
    }

    if (requestUrl.pathname === '/api/jira/issues') {
      if (request.method !== 'POST') {
        return jsonResponse(405, { message: 'Method not allowed.' })
      }

      const jiraIssues = await fetchJiraIssues(request)
      if (jiraIssues instanceof Response) {
        return jiraIssues
      }

      sharedJiraIssues = jiraIssues
      broadcastSnapshots()
      return jsonResponse(200, jiraIssues)
    }

    if (requestUrl.pathname === '/ws') {
      const id = crypto.randomUUID()
      if (serverInstance.upgrade(request, { data: { id } })) {
        return
      }
      return new Response('WebSocket upgrade failed.', { status: 500 })
    }

    return new Response('Scrummer WebSocket server is running.', { status: 200 })
  },
  websocket: {
    open(ws) {
      sockets.set(ws.data.id, ws)
      sendSnapshot(ws.data.id)
    },
    message(ws, rawMessage) {
      const event = parseClientEvent(rawMessage)
      if (!event) {
        send(ws, { type: 'server_error', message: 'Invalid message format.' })
        return
      }

      const clientId = ws.data.id
      switch (event.type) {
        case 'join': {
          const normalizedName = normalizeName(event.name)
          if (!normalizedName) {
            send(ws, { type: 'server_error', message: 'Display name cannot be empty.' })
            return
          }

          const existingUser = users.get(clientId)
          if (existingUser) {
            existingUser.name = normalizedName
          } else {
            users.set(clientId, { name: normalizedName, colorHue: pickDistinctHue(), vote: null })
          }

          broadcastSnapshots()
          return
        }
        case 'update_name': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before changing your name.' })
            return
          }

          const normalizedName = normalizeName(event.name)
          if (!normalizedName) {
            send(ws, { type: 'server_error', message: 'Display name cannot be empty.' })
            return
          }

          user.name = normalizedName
          broadcastSnapshots()
          return
        }
        case 'reroll_color': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before changing your color.' })
            return
          }

          user.colorHue = pickDistinctHue(clientId, user.colorHue)
          broadcastSnapshots()
          return
        }
        case 'set_vote': {
          if (!setVote(clientId, event.vote)) {
            send(ws, { type: 'server_error', message: 'Vote was rejected.' })
            return
          }

          broadcastSnapshots()
          return
        }
        case 'select_issue': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before selecting a ticket.' })
            return
          }

          const issueId = normalizeIssueId(event.issueId)
          const issueKey = normalizeIssueKey(event.issueKey)
          const issueUrl = normalizeIssueUrl(event.issueUrl)
          if (!issueId || !issueKey) {
            send(ws, { type: 'server_error', message: 'Issue selection is missing required details.' })
            return
          }

          const fields = normalizeIssueEditorFields(event.fields)
          ensureIssueDraft(issueId, issueKey, issueUrl, fields, clientId)
          selectedIssueId = issueId
          broadcastSnapshots()
          return
        }
        case 'set_issue_field': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before editing ticket fields.' })
            return
          }

          const issueId = normalizeIssueId(event.issueId)
          const issueKey = normalizeIssueKey(event.issueKey)
          const issueUrl = normalizeIssueUrl(event.issueUrl)
          const field = normalizeIssueEditorField(event.field)
          if (!issueId || !issueKey || !field) {
            send(ws, { type: 'server_error', message: 'Field update was missing required values.' })
            return
          }

          const draft = ensureIssueDraft(issueId, issueKey, issueUrl, [field], clientId)
          const existingField = draft.fields.find((entry) => entry.id === field.id)
          if (existingField) {
            existingField.label = field.label
            existingField.value = field.value
          } else if (draft.fields.length < maxIssueFieldsPerDraft) {
            draft.fields.push(field)
          }

          touchIssueDraft(draft, clientId)
          selectedIssueId = issueId
          broadcastSnapshots()
          return
        }
        case 'add_issue_subtask': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before creating subtasks.' })
            return
          }

          const issueId = normalizeIssueId(event.issueId)
          const issueKey = normalizeIssueKey(event.issueKey)
          const issueUrl = normalizeIssueUrl(event.issueUrl)
          const title = normalizeSubtaskTitle(event.title)
          if (!issueId || !issueKey || !title) {
            send(ws, { type: 'server_error', message: 'Subtask title cannot be empty.' })
            return
          }

          const draft = ensureIssueDraft(issueId, issueKey, issueUrl, [], clientId)
          if (draft.subtasks.length >= maxSubtasksPerIssue) {
            send(ws, { type: 'server_error', message: 'This ticket already has the maximum number of subtasks.' })
            return
          }

          draft.subtasks.push({
            id: crypto.randomUUID(),
            title,
            description: '',
            done: false,
          })

          touchIssueDraft(draft, clientId)
          selectedIssueId = issueId
          broadcastSnapshots()
          return
        }
        case 'update_issue_subtask': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before editing subtasks.' })
            return
          }

          const issueId = normalizeIssueId(event.issueId)
          const subtaskId = typeof event.subtaskId === 'string' ? event.subtaskId.trim() : ''
          if (!issueId || !subtaskId) {
            send(ws, { type: 'server_error', message: 'Subtask update is missing identifiers.' })
            return
          }

          const draft = issueDrafts.get(issueId)
          if (!draft) {
            send(ws, { type: 'server_error', message: 'Select a ticket before updating subtasks.' })
            return
          }

          const subtask = draft.subtasks.find((item) => item.id === subtaskId)
          if (!subtask) {
            send(ws, { type: 'server_error', message: 'Subtask could not be found.' })
            return
          }

          if ('title' in event) {
            const nextTitle = normalizeSubtaskTitle(event.title)
            if (!nextTitle) {
              send(ws, { type: 'server_error', message: 'Subtask title cannot be empty.' })
              return
            }
            subtask.title = nextTitle
          }

          if ('description' in event) {
            subtask.description = normalizeSubtaskDescription(event.description)
          }

          if ('done' in event && typeof event.done === 'boolean') {
            subtask.done = event.done
          }

          touchIssueDraft(draft, clientId)
          selectedIssueId = issueId
          broadcastSnapshots()
          return
        }
        case 'remove_issue_subtask': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before editing subtasks.' })
            return
          }

          const issueId = normalizeIssueId(event.issueId)
          const subtaskId = typeof event.subtaskId === 'string' ? event.subtaskId.trim() : ''
          if (!issueId || !subtaskId) {
            send(ws, { type: 'server_error', message: 'Subtask removal is missing identifiers.' })
            return
          }

          const draft = issueDrafts.get(issueId)
          if (!draft) {
            send(ws, { type: 'server_error', message: 'Select a ticket before removing subtasks.' })
            return
          }

          const nextSubtasks = draft.subtasks.filter((item) => item.id !== subtaskId)
          if (nextSubtasks.length === draft.subtasks.length) {
            return
          }

          draft.subtasks = nextSubtasks
          clearIssuePresenceByPrefix(issueId, `subtask:${subtaskId}:`)
          touchIssueDraft(draft, clientId)
          selectedIssueId = issueId
          broadcastSnapshots()
          return
        }
        case 'set_issue_presence': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before collaborating on a ticket.' })
            return
          }

          const issueId = normalizeIssueId(event.issueId)
          const targetId = normalizeIssuePresenceTargetId(event.targetId)
          if (!issueId || !targetId) {
            send(ws, { type: 'server_error', message: 'Presence update is missing required details.' })
            return
          }

          if (!issueDrafts.has(issueId)) {
            return
          }

          const changed = setIssuePresenceState(clientId, issueId, targetId, event.active)
          if (!changed) {
            return
          }

          broadcastSnapshots()
          return
        }
        case 'reveal': {
          if (users.size === 0 || revealed) {
            return
          }

          revealed = true
          broadcastSnapshots()
          return
        }
        case 'next_ticket': {
          if (users.size === 0) {
            return
          }

          resetRound()
          broadcastSnapshots()
          return
        }
      }
    },
    close(ws) {
      sockets.delete(ws.data.id)
      users.delete(ws.data.id)
      clearClientIssuePresence(ws.data.id)

      if (users.size === 0) {
        revealed = false
        selectedIssueId = null
        issueDrafts.clear()
        issuePresenceByIssue.clear()
        sharedJiraIssues = null
      }

      broadcastSnapshots()
    },
  },
})

console.log(`Scrummer WebSocket server listening on ws://localhost:${server.port}/ws`)
