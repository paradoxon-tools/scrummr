import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type {
  ClientEvent,
  EstimateOption,
  IssueCrdtSnapshot,
  IssueDraftSnapshot,
  IssueEditorField,
  IssueFieldCrdtSnapshot,
  IssueFieldSyncSnapshot,
  IssuePresenceSnapshot,
  IssueSubtask,
  IssueSubtasksSnapshot,
  IssueSyncSnapshot,
  JiraIssue,
  JiraIssueGroup,
  JiraIssueResult,
  OrchestratorViewSnapshot,
  RoomSettingsSnapshot,
  RoomStateSnapshot,
} from "../src/lib/protocol";
import * as Y from 'yjs'

type IdentityLike = {
  tokenIdentifier: string
  subject?: string | null
}

type RoomRecord = {
  _id?: unknown;
  revealed: boolean;
  selectedIssueId: string | null;
  orchestratorId: string | null;
  settings: RoomSettingsSnapshot;
  orchestratorView: OrchestratorViewSnapshot;
  issueDrafts: IssueDraftSnapshot[];
  issueSubtasks: IssueSubtasksSnapshot[];
  issueSync: IssueSyncSnapshot[];
  issueCrdt: IssueCrdtSnapshot[];
  issuePresence: IssuePresenceSnapshot[];
  jiraIssues: JiraIssueResult | null;
  jiraConnection: {
    connectionId: string;
    baseUrl: string;
    siteName: string;
    ticketPrefix: string;
    quickFilterFieldIds: string[];
    ownerUserId: string;
    ownerName: string;
    updatedAt: string;
  } | null;
  estimatedIssueIds: string[];
};

type ParticipantRecord = {
  _id: unknown;
  clientId: string;
  name: string;
  colorHue: number;
  vote: EstimateOption | null;
  isFollowingOrchestrator: boolean;
  lastSeenAt: number;
};

type QueryCtx = {
  db: {
    query: (table: string) => {
      first: () => Promise<unknown>;
      collect: () => Promise<unknown[]>;
    };
  };
};

type MutationCtx = {
  db: QueryCtx["db"] & {
    insert: (table: string, value: unknown) => Promise<unknown>;
    get: (id: unknown) => Promise<unknown>;
    patch: (id: unknown, value: unknown) => Promise<void>;
    delete: (id: unknown) => Promise<void>;
  };
  scheduler: {
    runAfter: (delayMs: number, fn: unknown, args: Record<string, never>) => Promise<unknown>;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const ESTIMATE_OPTIONS = ['0', '1', '2', '3', '5', '8', '13', '20', '?']
const allowedVotes = new Set(ESTIMATE_OPTIONS)

const ISSUE_FIELD_MAX_LENGTH = 16000
const FIELD_LABEL_MAX_LENGTH = 80
const FIELD_ID_MAX_LENGTH = 80
const ISSUE_KEY_MAX_LENGTH = 40
const ISSUE_URL_MAX_LENGTH = 600
const SUBTASK_TITLE_MAX_LENGTH = 240
const MAX_SUBTASKS_PER_ISSUE = 100
const MAX_ISSUE_FIELDS_PER_DRAFT = 256
const MAX_ISSUE_CRDT_FIELDS_PER_ISSUE = 32
const ISSUE_PRESENCE_TARGET_ID_MAX_LENGTH = 120
const MAX_ORCHESTRATOR_SCROLL_TOP = 2_000_000
const CRDT_UPDATE_MAX_BYTES = 1024 * 256
const PRESENCE_STALE_AFTER_MS = 45_000
const STALE_PARTICIPANT_SWEEP_DELAY_MS = PRESENCE_STALE_AFTER_MS + 1_000
const SYNC_RETRY_BASE_DELAY_MS = 5_000
const SYNC_RETRY_MAX_DELAY_MS = 60_000
const AUTHENTICATED_CLIENT_ID_PREFIX = 'clerk:'

const createDefaultRoomSettings = (): RoomSettingsSnapshot => ({
  allowParticipantEditingOutsideFocus: true,
})

const createEmptyOrchestratorView = (): OrchestratorViewSnapshot => ({
  issueId: null,
  targetId: null,
  scrollTop: 0,
})

const createDefaultRoom = (): Omit<RoomRecord, '_id'> => ({
  revealed: false,
  selectedIssueId: null,
  orchestratorId: null,
  settings: createDefaultRoomSettings(),
  orchestratorView: createEmptyOrchestratorView(),
  issueDrafts: [],
  issueSubtasks: [],
  issueSync: [],
  issueCrdt: [],
  issuePresence: [],
  jiraIssues: null,
  jiraConnection: null,
  estimatedIssueIds: [],
})

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const getIdentityUserId = (identity: IdentityLike): string =>
  typeof identity.subject === 'string' && identity.subject.trim()
    ? identity.subject.trim().slice(0, 200)
    : identity.tokenIdentifier.trim().slice(0, 200)

const getAuthenticatedClientId = (identity: IdentityLike): string =>
  normalizeIssueId(`${AUTHENTICATED_CLIENT_ID_PREFIX}${getIdentityUserId(identity)}`)

const normalizeName = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 40) : '')
const normalizeIssueId = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, FIELD_ID_MAX_LENGTH) : '')
const normalizeIssueKey = (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase().slice(0, ISSUE_KEY_MAX_LENGTH) : '')
const normalizeIssueUrl = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, ISSUE_URL_MAX_LENGTH) : '')
const normalizeIssueText = (value: unknown, maxLength = ISSUE_FIELD_MAX_LENGTH) =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').slice(0, maxLength) : ''
const normalizeFieldId = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, FIELD_ID_MAX_LENGTH)
}
const normalizeFieldLabel = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback.slice(0, FIELD_LABEL_MAX_LENGTH)
  }
  const normalized = value.trim().slice(0, FIELD_LABEL_MAX_LENGTH)
  return normalized || fallback.slice(0, FIELD_LABEL_MAX_LENGTH)
}
const normalizeIssuePresenceTargetId = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, '_')
    .slice(0, ISSUE_PRESENCE_TARGET_ID_MAX_LENGTH)
}
const decodeBinaryPayload = (value: unknown): Uint8Array | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const payload = Buffer.from(trimmed, 'base64')
    if (!payload.length || payload.length > CRDT_UPDATE_MAX_BYTES) {
      return null
    }
    return new Uint8Array(payload)
  } catch {
    return null
  }
}

const encodeBinaryPayload = (payload: Uint8Array): string => Buffer.from(payload).toString('base64')
const normalizeScrollTop = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > MAX_ORCHESTRATOR_SCROLL_TOP) {
    return MAX_ORCHESTRATOR_SCROLL_TOP
  }
  return Math.floor(value)
}
const normalizeEditorField = (field: unknown): IssueEditorField | null => {
  if (!isRecord(field)) {
    return null
  }

  const id = normalizeFieldId(field.id)
  if (!id) {
    return null
  }

  return {
    id,
    label: normalizeFieldLabel(field.label, id),
    value: normalizeIssueText(field.value),
  }
}

const normalizeEditorFields = (value: unknown): IssueEditorField[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const unique = new Map<string, IssueEditorField>()
  for (const candidate of value) {
    const field = normalizeEditorField(candidate)
    if (!field) {
      continue
    }

    if (unique.size >= MAX_ISSUE_FIELDS_PER_DRAFT && !unique.has(field.id)) {
      continue
    }

    unique.set(field.id, field)
  }

  return [...unique.values()]
}

const normalizeSubtaskTitle = (value: unknown) => normalizeIssueText(value, SUBTASK_TITLE_MAX_LENGTH).trim()

const normalizeRoomSettings = (value: unknown): RoomSettingsSnapshot => {
  if (!isRecord(value)) {
    return createDefaultRoomSettings()
  }

  return {
    allowParticipantEditingOutsideFocus: value.allowParticipantEditingOutsideFocus !== false,
  }
}

const normalizeIssueSubtask = (value: unknown): IssueSubtask | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = normalizeIssueId(value.id)
  const title = normalizeSubtaskTitle(value.title)
  if (!id || !title) {
    return null
  }

  return {
    id,
    key: normalizeIssueKey(value.key),
    url: typeof value.url === 'string' ? normalizeIssueUrl(value.url) : null,
    title,
    description: normalizeIssueText(value.description),
    done: value.done === true,
  }
}

const normalizeIssueSubtasks = (value: unknown): IssueSubtasksSnapshot[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const entries = new Map<string, IssueSubtasksSnapshot>()
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue
    }

    const issueId = normalizeIssueId(candidate.issueId)
    if (!issueId) {
      continue
    }

    const subtasks = Array.isArray(candidate.subtasks)
      ? candidate.subtasks.map((subtask) => normalizeIssueSubtask(subtask)).filter((subtask): subtask is IssueSubtask => subtask !== null).slice(0, MAX_SUBTASKS_PER_ISSUE)
      : []
    entries.set(issueId, { issueId, subtasks })
  }

  return [...entries.values()]
}

const normalizeIssueFieldSyncStatus = (value: unknown): IssueFieldSyncSnapshot['status'] => {
  if (value === 'dirty' || value === 'syncing' || value === 'failed') {
    return value
  }
  return 'clean'
}

const normalizeIsoStringOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

const normalizeRetryCount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

const normalizeIssueFieldSyncSnapshot = (value: unknown): IssueFieldSyncSnapshot | null => {
  if (!isRecord(value)) {
    return null
  }

  const fieldId = normalizeFieldId(value.fieldId)
  if (!fieldId) {
    return null
  }

  return {
    fieldId,
    label: normalizeFieldLabel(value.label, fieldId),
    value: normalizeIssueText(value.value),
    status: normalizeIssueFieldSyncStatus(value.status),
    retryCount: normalizeRetryCount(value.retryCount),
    nextRetryAt: normalizeIsoStringOrNull(value.nextRetryAt),
    lastAttemptAt: normalizeIsoStringOrNull(value.lastAttemptAt),
    lastSyncedAt: normalizeIsoStringOrNull(value.lastSyncedAt),
    failureMessage: typeof value.failureMessage === 'string' ? value.failureMessage.slice(0, 300) : null,
  }
}

const normalizeIssueSync = (value: unknown): IssueSyncSnapshot[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const entries = new Map<string, IssueSyncSnapshot>()
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue
    }

    const issueId = normalizeIssueId(candidate.issueId)
    if (!issueId) {
      continue
    }

    const fields = Array.isArray(candidate.fields)
      ? candidate.fields
          .map((field) => normalizeIssueFieldSyncSnapshot(field))
          .filter((field): field is IssueFieldSyncSnapshot => field !== null)
      : []
    entries.set(issueId, {
      issueId,
      issueKey: normalizeIssueKey(candidate.issueKey),
      issueUrl: normalizeIssueUrl(candidate.issueUrl),
      fields,
    })
  }

  return [...entries.values()]
}

const normalizeJiraConnection = (value: unknown): RoomRecord['jiraConnection'] => {
  if (!isRecord(value)) {
    return null
  }

  const connectionId = normalizeIssueId(value.connectionId)
  const baseUrl = normalizeIssueUrl(value.baseUrl)
  const siteName = normalizeIssueText(value.siteName, 120).trim()
  const ownerUserId = normalizeIssueText(value.ownerUserId, 200).trim()
  if (!connectionId || !baseUrl || !siteName || !ownerUserId) {
    return null
  }

  return {
    connectionId,
    baseUrl,
    siteName,
    ticketPrefix: normalizeIssueKey(value.ticketPrefix),
    quickFilterFieldIds: Array.isArray(value.quickFilterFieldIds)
      ? value.quickFilterFieldIds.map((entry) => normalizeFieldId(entry)).filter(Boolean)
      : [],
    ownerUserId,
    ownerName: normalizeIssueText(value.ownerName, 120).trim(),
    updatedAt: normalizeIsoStringOrNull(value.updatedAt) ?? new Date().toISOString(),
  }
}

const normalizeIssueFieldCrdtSnapshot = (value: unknown): IssueFieldCrdtSnapshot | null => {
  if (!isRecord(value)) {
    return null
  }

  const fieldId = normalizeFieldId(value.fieldId)
  const update = typeof value.update === 'string' ? value.update.trim() : ''
  if (!fieldId || !update || !decodeBinaryPayload(update)) {
    return null
  }

  return {
    fieldId,
    label: normalizeFieldLabel(value.label, fieldId),
    update,
  }
}

const normalizeIssueCrdt = (value: unknown): IssueCrdtSnapshot[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const entries = new Map<string, IssueCrdtSnapshot>()
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue
    }

    const issueId = normalizeIssueId(candidate.issueId)
    if (!issueId) {
      continue
    }

    const fields = Array.isArray(candidate.fields)
      ? candidate.fields
          .map((field) => normalizeIssueFieldCrdtSnapshot(field))
          .filter((field): field is IssueFieldCrdtSnapshot => field !== null)
          .slice(0, MAX_ISSUE_CRDT_FIELDS_PER_ISSUE)
      : []
    entries.set(issueId, { issueId, fields })
  }

  return [...entries.values()]
}

const hueDistance = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

const pickDistinctHue = (participants: ParticipantRecord[], excludeClientId?: string, avoidHue?: number) => {
  const usedHues = participants
    .filter((entry) => entry.clientId !== excludeClientId)
    .map((entry) => entry.colorHue)

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

const resetOrchestratorView = (room: RoomRecord, issueId = room.selectedIssueId) => {
  room.orchestratorView = {
    issueId,
    targetId: null,
    scrollTop: 0,
  }
}

const canClientControlTicketFlow = (room: RoomRecord, clientId: string) => room.orchestratorId === null || room.orchestratorId === clientId

const touchIssueDraft = (draft: IssueDraftSnapshot, updatedBy: string | null) => {
  draft.updatedBy = updatedBy
  draft.updatedAt = new Date().toISOString()
}

const ensureDraftField = (draft: IssueDraftSnapshot, fieldId: string, label: string): IssueEditorField | null => {
  const normalizedFieldId = normalizeFieldId(fieldId)
  if (!normalizedFieldId) {
    return null
  }

  const fallbackLabel = label || normalizedFieldId
  const existing = draft.fields.find((candidate) => candidate.id === normalizedFieldId)
  if (existing) {
    existing.label = normalizeFieldLabel(label, existing.label || fallbackLabel)
    return existing
  }

  if (draft.fields.length >= MAX_ISSUE_FIELDS_PER_DRAFT) {
    return null
  }

  const nextField = {
    id: normalizedFieldId,
    label: normalizeFieldLabel(label, fallbackLabel),
    value: '',
  }
  draft.fields.push(nextField)
  return nextField
}

const ensureIssueCrdtEntry = (room: RoomRecord, issueId: string): IssueCrdtSnapshot | null => {
  const normalizedIssueId = normalizeIssueId(issueId)
  if (!normalizedIssueId) {
    return null
  }

  const existing = room.issueCrdt.find((entry) => entry.issueId === normalizedIssueId)
  if (existing) {
    return existing
  }

  const entry = { issueId: normalizedIssueId, fields: [] }
  room.issueCrdt.push(entry)
  return entry
}

const ensureIssueSubtasksEntry = (room: RoomRecord, issueId: string, seedSubtasks: IssueSubtask[] = []): IssueSubtasksSnapshot | null => {
  const normalizedIssueId = normalizeIssueId(issueId)
  if (!normalizedIssueId) {
    return null
  }

  const existing = room.issueSubtasks.find((entry) => entry.issueId === normalizedIssueId)
  if (existing) {
    if (seedSubtasks.length > 0 && existing.subtasks.length === 0) {
      existing.subtasks = seedSubtasks.slice(0, MAX_SUBTASKS_PER_ISSUE).map((subtask) => ({ ...subtask }))
    }
    return existing
  }

  const entry = {
    issueId: normalizedIssueId,
    subtasks: seedSubtasks.slice(0, MAX_SUBTASKS_PER_ISSUE).map((subtask) => ({ ...subtask })),
  }
  room.issueSubtasks.push(entry)
  return entry
}

const getIssueSubtasks = (room: RoomRecord, issueId: string): IssueSubtask[] =>
  room.issueSubtasks.find((entry) => entry.issueId === normalizeIssueId(issueId))?.subtasks ?? []

const getIssueBaselineFieldValue = (room: RoomRecord, issueId: string, fieldId: string): string | null => {
  const normalizedIssueId = normalizeIssueId(issueId)
  const normalizedFieldId = normalizeFieldId(fieldId)
  if (!normalizedIssueId || !normalizedFieldId || !room.jiraIssues) {
    return null
  }

  const issue = room.jiraIssues.groups.flatMap((group) => group.issues).find((entry) => entry.id === normalizedIssueId)
  if (!issue) {
    return null
  }

  const field = issue.fields.find((entry) => normalizeFieldId(entry.id) === normalizedFieldId)
  return field ? normalizeIssueText(field.value) : null
}

const createIssueFieldSyncState = (fieldId: string, label: string, value: string): IssueFieldSyncSnapshot => ({
  fieldId: normalizeFieldId(fieldId),
  label: normalizeFieldLabel(label, fieldId),
  value: normalizeIssueText(value),
  status: 'clean',
  retryCount: 0,
  nextRetryAt: null,
  lastAttemptAt: null,
  lastSyncedAt: new Date().toISOString(),
  failureMessage: null,
})

const ensureIssueSyncEntry = (room: RoomRecord, issueId: string, issueKey: string, issueUrl: string): IssueSyncSnapshot | null => {
  const normalizedIssueId = normalizeIssueId(issueId)
  if (!normalizedIssueId) {
    return null
  }

  const existing = room.issueSync.find((entry) => entry.issueId === normalizedIssueId)
  if (existing) {
    existing.issueKey = normalizeIssueKey(issueKey) || existing.issueKey
    existing.issueUrl = normalizeIssueUrl(issueUrl) || existing.issueUrl
    return existing
  }

  const entry = {
    issueId: normalizedIssueId,
    issueKey: normalizeIssueKey(issueKey),
    issueUrl: normalizeIssueUrl(issueUrl),
    fields: [],
  }
  room.issueSync.push(entry)
  return entry
}

const ensureIssueSyncField = (
  room: RoomRecord,
  issueId: string,
  issueKey: string,
  issueUrl: string,
  fieldId: string,
  label: string,
  value: string,
): IssueFieldSyncSnapshot | null => {
  const syncEntry = ensureIssueSyncEntry(room, issueId, issueKey, issueUrl)
  const normalizedFieldId = normalizeFieldId(fieldId)
  if (!syncEntry || !normalizedFieldId) {
    return null
  }

  const existing = syncEntry.fields.find((entry) => entry.fieldId === normalizedFieldId)
  if (existing) {
    existing.label = normalizeFieldLabel(label, existing.label || normalizedFieldId)
    existing.value = normalizeIssueText(value)
    return existing
  }

  const nextField = createIssueFieldSyncState(normalizedFieldId, label, value)
  syncEntry.fields.push(nextField)
  return nextField
}

const updateIssueSyncLifecycle = (
  room: RoomRecord,
  issueId: string,
  issueKey: string,
  issueUrl: string,
  fieldId: string,
  label: string,
  value: string,
): void => {
  const normalizedFieldId = normalizeFieldId(fieldId)
  if (normalizedFieldId !== 'description') {
    return
  }

  const syncField = ensureIssueSyncField(room, issueId, issueKey, issueUrl, normalizedFieldId, label, value)
  if (!syncField) {
    return
  }

  const baselineValue = getIssueBaselineFieldValue(room, issueId, normalizedFieldId)
  syncField.value = normalizeIssueText(value)
  syncField.label = normalizeFieldLabel(label, syncField.label || normalizedFieldId)
  if (baselineValue !== null && syncField.value === baselineValue) {
    syncField.status = 'clean'
    syncField.retryCount = 0
    syncField.nextRetryAt = null
    syncField.failureMessage = null
    syncField.lastSyncedAt = new Date().toISOString()
    return
  }

  if (syncField.status !== 'syncing') {
    syncField.status = syncField.retryCount > 0 ? 'failed' : 'dirty'
  }
}

const getRetryDelayMs = (retryCount: number): number =>
  Math.min(SYNC_RETRY_MAX_DELAY_MS, SYNC_RETRY_BASE_DELAY_MS * Math.max(1, 2 ** Math.max(0, retryCount - 1)))

const pruneRoomIssueData = (room: RoomRecord, activeIssueIds: Set<string>): void => {
  room.issueDrafts = room.issueDrafts.filter((entry) => activeIssueIds.has(entry.issueId))
  room.issueSubtasks = room.issueSubtasks.filter((entry) => activeIssueIds.has(entry.issueId))
  room.issueSync = room.issueSync.filter((entry) => activeIssueIds.has(entry.issueId))
  room.issueCrdt = room.issueCrdt.filter((entry) => activeIssueIds.has(entry.issueId))
  room.issuePresence = room.issuePresence.filter((entry) => activeIssueIds.has(entry.issueId))
  room.estimatedIssueIds = room.estimatedIssueIds.filter((entry) => activeIssueIds.has(entry))
}

const canEditIssue = (room: RoomRecord, clientId: string, issueId: string): boolean => {
  if (canClientControlTicketFlow(room, clientId)) {
    return true
  }

  if (room.settings.allowParticipantEditingOutsideFocus) {
    return true
  }

  return room.selectedIssueId === normalizeIssueId(issueId)
}

const ensureIssueCrdtField = (entry: IssueCrdtSnapshot, fieldId: string, label: string): IssueFieldCrdtSnapshot | null => {
  const normalizedFieldId = normalizeFieldId(fieldId)
  if (!normalizedFieldId) {
    return null
  }

  const existing = entry.fields.find((candidate) => candidate.fieldId === normalizedFieldId)
  if (existing) {
    existing.label = normalizeFieldLabel(label, existing.label || normalizedFieldId)
    return existing
  }

  if (entry.fields.length >= MAX_ISSUE_CRDT_FIELDS_PER_ISSUE) {
    return null
  }

  const field = {
    fieldId: normalizedFieldId,
    label: normalizeFieldLabel(label, normalizedFieldId),
    update: '',
  }
  entry.fields.push(field)
  return field
}

const ensureIssueDraft = (
  room: RoomRecord,
  issueId: string,
  issueKey: string,
  issueUrl: string,
  seedFields: IssueEditorField[],
  updatedBy: string | null,
): IssueDraftSnapshot => {
  const existing = room.issueDrafts.find((entry) => entry.issueId === issueId)
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
        if (existing.fields.length >= MAX_ISSUE_FIELDS_PER_DRAFT) {
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
  const draft = {
    issueId,
    issueKey,
    issueUrl,
    fields,
    updatedBy,
    updatedAt: new Date().toISOString(),
  }
  room.issueDrafts.push(draft)
  return draft
}

const flattenSharedIssueEntries = (room: RoomRecord): Array<{ issue: JiraIssue; group: JiraIssueGroup }> => {
  if (!room.jiraIssues) {
    return []
  }

  const entries: Array<{ issue: JiraIssue; group: JiraIssueGroup }> = []
  for (const group of room.jiraIssues.groups) {
    for (const issue of group.issues) {
      entries.push({ issue, group })
    }
  }
  return entries
}

const buildWorkspaceSeedFields = (issue: JiraIssue, group: JiraIssueGroup) =>
  normalizeEditorFields([
    ...(Array.isArray(issue.fields) ? issue.fields : []),
    {
      id: 'sprint',
      label: 'Sprint',
      value: group?.sprint?.name ?? group?.name ?? '',
    },
    {
      id: 'planning_notes',
      label: 'Planning Notes',
      value: '',
    },
  ])

const ensureSelectedIssueFromShared = (room: RoomRecord, issueId: string, updatedBy: string | null): boolean => {
  const normalizedIssueId = normalizeIssueId(issueId)
  if (!normalizedIssueId) {
    return false
  }

  const entry = flattenSharedIssueEntries(room).find((candidate) => candidate.issue.id === normalizedIssueId)
  if (!entry) {
    return false
  }

  const subtasks = getIssueSubtasks(room, normalizedIssueId)
  ensureIssueDraft(
    room,
    normalizedIssueId,
    normalizeIssueKey(entry.issue.key),
    normalizeIssueUrl(entry.issue.url),
    buildWorkspaceSeedFields(entry.issue, entry.group),
    updatedBy,
  )
  ensureIssueSubtasksEntry(room, normalizedIssueId, subtasks)
  updateIssueSyncLifecycle(
    room,
    normalizedIssueId,
    normalizeIssueKey(entry.issue.key),
    normalizeIssueUrl(entry.issue.url),
    'description',
    'Description',
    getIssueBaselineFieldValue(room, normalizedIssueId, 'description') ?? '',
  )
  room.selectedIssueId = normalizedIssueId
  resetOrchestratorView(room, normalizedIssueId)
  return true
}

const selectFirstSharedIssue = (room: RoomRecord): void => {
  const entries = flattenSharedIssueEntries(room)
  if (entries.length === 0) {
    room.selectedIssueId = null
    resetOrchestratorView(room, null)
    return
  }

  ensureSelectedIssueFromShared(room, entries[0].issue.id, null)
}

const selectNextSharedIssue = (room: RoomRecord): void => {
  const entries = flattenSharedIssueEntries(room)
  if (entries.length === 0) {
    room.selectedIssueId = null
    resetOrchestratorView(room, null)
    return
  }

  const currentIndex = room.selectedIssueId ? entries.findIndex((entry) => entry.issue.id === room.selectedIssueId) : -1
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % entries.length : 0
  ensureSelectedIssueFromShared(room, entries[nextIndex].issue.id, null)
}

const applyEstimatedFlags = (room: RoomRecord): void => {
  if (!room.jiraIssues) {
    return
  }

  const estimatedIssueIds = new Set(Array.isArray(room.estimatedIssueIds) ? room.estimatedIssueIds : [])
  for (const group of room.jiraIssues.groups) {
    for (const issue of group.issues) {
      issue.isEstimated = estimatedIssueIds.has(issue.id)
    }
  }
}

const markIssueEstimated = (room: RoomRecord, issueId: string | null): void => {
  const normalizedIssueId = normalizeIssueId(issueId)
  if (!normalizedIssueId) {
    return
  }

  const estimatedIssueIds = new Set(Array.isArray(room.estimatedIssueIds) ? room.estimatedIssueIds : [])
  estimatedIssueIds.add(normalizedIssueId)
  room.estimatedIssueIds = [...estimatedIssueIds]
  applyEstimatedFlags(room)
}

const clearClientIssuePresence = (room: RoomRecord, clientId: string): void => {
  const nextPresence: IssuePresenceSnapshot[] = []
  for (const entry of Array.isArray(room.issuePresence) ? room.issuePresence : []) {
    const participantIds = Array.isArray(entry.participantIds)
      ? entry.participantIds.filter((participantId: string) => participantId !== clientId)
      : []
    if (participantIds.length === 0) {
      continue
    }
    nextPresence.push({
      issueId: entry.issueId,
      targetId: entry.targetId,
      participantIds,
    })
  }
  room.issuePresence = nextPresence
}

const clearIssuePresenceByPrefix = (room: RoomRecord, issueId: string, targetPrefix: string): void => {
  const normalizedIssueId = normalizeIssueId(issueId)
  const normalizedTargetPrefix = normalizeIssuePresenceTargetId(targetPrefix)
  if (!normalizedIssueId || !normalizedTargetPrefix) {
    return
  }

  room.issuePresence = (Array.isArray(room.issuePresence) ? room.issuePresence : []).filter(
    (entry) =>
      !(entry.issueId === normalizedIssueId && typeof entry.targetId === 'string' && entry.targetId.startsWith(normalizedTargetPrefix)),
  )
}

const setIssuePresenceState = (room: RoomRecord, clientId: string, issueId: string, targetId: string, active: boolean): boolean => {
  const normalizedIssueId = normalizeIssueId(issueId)
  const normalizedTargetId = normalizeIssuePresenceTargetId(targetId)
  if (!normalizedIssueId || !normalizedTargetId) {
    return false
  }

  const nextPresence = Array.isArray(room.issuePresence)
    ? room.issuePresence.map((entry) => ({ ...entry, participantIds: [...entry.participantIds] }))
    : []
  const existing = nextPresence.find((entry) => entry.issueId === normalizedIssueId && entry.targetId === normalizedTargetId)

  if (active) {
    if (existing) {
      if (existing.participantIds.includes(clientId)) {
        return false
      }
      existing.participantIds.push(clientId)
      room.issuePresence = nextPresence
      return true
    }

    nextPresence.push({
      issueId: normalizedIssueId,
      targetId: normalizedTargetId,
      participantIds: [clientId],
    })
    room.issuePresence = nextPresence
    return true
  }

  if (!existing) {
    return false
  }

  const nextParticipantIds = existing.participantIds.filter((participantId: string) => participantId !== clientId)
  if (nextParticipantIds.length === existing.participantIds.length) {
    return false
  }

  if (nextParticipantIds.length === 0) {
    room.issuePresence = nextPresence.filter((entry) => !(entry.issueId === normalizedIssueId && entry.targetId === normalizedTargetId))
    return true
  }

  existing.participantIds = nextParticipantIds
  room.issuePresence = nextPresence
  return true
}

const setOrchestratorView = (room: RoomRecord, nextView: OrchestratorViewSnapshot): boolean => {
  const normalizedIssueId = nextView.issueId ? normalizeIssueId(nextView.issueId) : null
  const normalizedTargetId = nextView.targetId ? normalizeIssuePresenceTargetId(nextView.targetId) : null
  const normalizedScrollTop = normalizeScrollTop(nextView.scrollTop)

  const changed =
    room.orchestratorView.issueId !== normalizedIssueId ||
    room.orchestratorView.targetId !== normalizedTargetId ||
    room.orchestratorView.scrollTop !== normalizedScrollTop

  if (!changed) {
    return false
  }

  room.orchestratorView = {
    issueId: normalizedIssueId,
    targetId: normalizedTargetId,
    scrollTop: normalizedScrollTop,
  }

  return true
}

const makeEmptySnapshot = (clientId: string): RoomStateSnapshot => ({
  revealed: false,
  myId: clientId,
  myVote: null,
  orchestratorId: null,
  settings: createDefaultRoomSettings(),
  orchestratorView: createEmptyOrchestratorView(),
  participants: [],
  issueWorkspace: {
    selectedIssueId: null,
    drafts: [],
    subtasks: [],
    sync: [],
    presence: [],
    crdt: [],
  },
  jiraIssues: null,
})

const normalizeRoom = (raw: unknown): RoomRecord | null => {
  if (!isRecord(raw)) {
    return null
  }

  const defaults = createDefaultRoom()
  return {
    _id: raw._id,
    revealed: typeof raw.revealed === 'boolean' ? raw.revealed : defaults.revealed,
    selectedIssueId: typeof raw.selectedIssueId === 'string' ? raw.selectedIssueId : null,
    orchestratorId: typeof raw.orchestratorId === 'string' ? raw.orchestratorId : null,
    settings: normalizeRoomSettings(raw.settings),
    orchestratorView: isRecord(raw.orchestratorView)
      ? {
          issueId: typeof raw.orchestratorView.issueId === 'string' ? raw.orchestratorView.issueId : null,
          targetId: typeof raw.orchestratorView.targetId === 'string' ? raw.orchestratorView.targetId : null,
          scrollTop: normalizeScrollTop(raw.orchestratorView.scrollTop),
        }
      : defaults.orchestratorView,
    issueDrafts: Array.isArray(raw.issueDrafts) ? (clone(raw.issueDrafts) as IssueDraftSnapshot[]) : defaults.issueDrafts,
    issueSubtasks: normalizeIssueSubtasks(raw.issueSubtasks),
    issueSync: normalizeIssueSync(raw.issueSync),
    issueCrdt: normalizeIssueCrdt(raw.issueCrdt),
    issuePresence: Array.isArray(raw.issuePresence) ? (clone(raw.issuePresence) as IssuePresenceSnapshot[]) : defaults.issuePresence,
    jiraIssues: raw.jiraIssues ? (clone(raw.jiraIssues) as JiraIssueResult) : null,
    jiraConnection: normalizeJiraConnection(raw.jiraConnection),
    estimatedIssueIds: Array.isArray(raw.estimatedIssueIds)
      ? raw.estimatedIssueIds.map((value) => (typeof value === 'string' ? value : '')).filter(Boolean)
      : defaults.estimatedIssueIds,
  }
}

const isParticipantStale = (participant: ParticipantRecord, now: number): boolean => now - participant.lastSeenAt > PRESENCE_STALE_AFTER_MS

const cleanupStaleParticipants = async (ctx: MutationCtx, room: RoomRecord, participants: ParticipantRecord[]): Promise<ParticipantRecord[]> => {
  const now = Date.now()
  const staleParticipants = participants.filter((participant) => isParticipantStale(participant, now))
  if (staleParticipants.length === 0) {
    return participants
  }

  const staleIds = new Set(staleParticipants.map((participant) => participant.clientId))
  for (const participant of staleParticipants) {
    await ctx.db.delete(participant._id as Parameters<typeof ctx.db.delete>[0])
  }

  room.issuePresence = room.issuePresence
    .map((entry) => ({
      ...entry,
      participantIds: entry.participantIds.filter((participantId) => !staleIds.has(participantId)),
    }))
    .filter((entry) => entry.participantIds.length > 0)

  if (room.orchestratorId && staleIds.has(room.orchestratorId)) {
    const remaining = participants.filter((participant) => !staleIds.has(participant.clientId))
    room.orchestratorId = remaining[0]?.clientId ?? null
    resetOrchestratorView(room, room.orchestratorId ? room.selectedIssueId : null)
  }

  await persistRoom(ctx, room)
  const remainingParticipants = participants.filter((participant) => !staleIds.has(participant.clientId))
  if (remainingParticipants.length === 0) {
    await resetRoomIfEmpty(ctx, room)
  }
  return remainingParticipants
}

const scheduleStaleParticipantSweep = async (ctx: MutationCtx): Promise<void> => {
  await ctx.scheduler.runAfter(
    STALE_PARTICIPANT_SWEEP_DELAY_MS,
    internal.room.sweepStaleParticipantsInternal,
    {},
  )
}

const normalizeParticipant = (raw: unknown): ParticipantRecord | null => {
  if (!isRecord(raw)) {
    return null
  }

  const clientId = normalizeIssueId(raw.clientId)
  if (!clientId) {
    return null
  }

  return {
    _id: raw._id,
    clientId,
    name: normalizeName(raw.name),
    colorHue: typeof raw.colorHue === 'number' && Number.isFinite(raw.colorHue) ? Math.floor(raw.colorHue) : 210,
    vote: raw.vote === null || (typeof raw.vote === 'string' && allowedVotes.has(raw.vote)) ? (raw.vote as EstimateOption | null) : null,
    isFollowingOrchestrator: raw.isFollowingOrchestrator === true,
    lastSeenAt: typeof raw.lastSeenAt === 'number' && Number.isFinite(raw.lastSeenAt) ? raw.lastSeenAt : 0,
  }
}

const ensureRoom = async (ctx: MutationCtx): Promise<RoomRecord> => {
  const existing = normalizeRoom(await ctx.db.query('rooms').first())
  if (existing) {
    return existing
  }

  const roomId = await ctx.db.insert('rooms', createDefaultRoom())
  const created = normalizeRoom(await ctx.db.get(roomId))
  if (created) {
    return created
  }

  return {
    _id: roomId,
    ...createDefaultRoom(),
  }
}

const listParticipants = async (ctx: QueryCtx): Promise<ParticipantRecord[]> => {
  const records = await ctx.db.query('participants').collect()
  return records
    .map((entry) => normalizeParticipant(entry))
    .filter((entry): entry is ParticipantRecord => entry !== null)
}

const findParticipant = (participants: ParticipantRecord[], clientId: string): ParticipantRecord | null =>
  participants.find((entry) => entry.clientId === clientId) ?? null

const persistRoom = async (ctx: MutationCtx, room: RoomRecord): Promise<void> => {
  if (!room._id) {
    return
  }

  await ctx.db.patch(room._id, {
    revealed: room.revealed,
    selectedIssueId: room.selectedIssueId,
    orchestratorId: room.orchestratorId,
    settings: room.settings,
    orchestratorView: room.orchestratorView,
    issueDrafts: room.issueDrafts,
    issueSubtasks: room.issueSubtasks,
    issueSync: room.issueSync,
    issueCrdt: room.issueCrdt,
    issuePresence: room.issuePresence,
    jiraIssues: room.jiraIssues,
    jiraConnection: room.jiraConnection,
    estimatedIssueIds: room.estimatedIssueIds,
  })
}

const resetRoomIfEmpty = async (ctx: MutationCtx, room: RoomRecord): Promise<void> => {
  const participants = await listParticipants(ctx)
  if (participants.length > 0) {
    return
  }

  const defaultRoom = createDefaultRoom()
  if (room._id) {
    await ctx.db.patch(room._id, defaultRoom)
  }
}

export const snapshot = query({
  args: {
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args: { clientId?: string } | undefined): Promise<RoomStateSnapshot> => {
    const identity = await ctx.auth.getUserIdentity()
    const clientId = identity
      ? getAuthenticatedClientId(identity)
      : typeof args?.clientId === 'string' && args.clientId.trim()
        ? args.clientId.trim()
        : crypto.randomUUID()
    const room = normalizeRoom(await (ctx as QueryCtx).db.query('rooms').first()) ?? {
      ...createDefaultRoom(),
    }
    const participants = await listParticipants(ctx as QueryCtx)
    const me = findParticipant(participants, clientId)

    const participantViews = participants
      .map((participant) => ({
        id: participant.clientId,
        name: participant.name,
        colorHue: participant.colorHue,
        isOrchestrator: room.orchestratorId === participant.clientId,
        isFollowingOrchestrator: room.orchestratorId === participant.clientId ? true : participant.isFollowingOrchestrator,
        hasVoted: participant.vote !== null,
        vote: room.revealed ? participant.vote : null,
      }))
      .sort((a, b) => {
        if (a.isOrchestrator !== b.isOrchestrator) {
          return a.isOrchestrator ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

    const base = makeEmptySnapshot(clientId)
    base.revealed = room.revealed
    base.myVote = me?.vote ?? null
    base.orchestratorId = room.orchestratorId
    base.settings = room.settings
    base.orchestratorView = room.orchestratorView ?? createEmptyOrchestratorView()
    base.participants = participantViews
    base.issueWorkspace = {
      selectedIssueId: room.selectedIssueId,
      drafts: clone(Array.isArray(room.issueDrafts) ? room.issueDrafts : []),
      subtasks: clone(Array.isArray(room.issueSubtasks) ? room.issueSubtasks : []),
      sync: clone(Array.isArray(room.issueSync) ? room.issueSync : []),
      presence: clone(Array.isArray(room.issuePresence) ? room.issuePresence : []),
      crdt: clone(Array.isArray(room.issueCrdt) ? room.issueCrdt : []),
    }
    base.jiraIssues = room.jiraIssues ? clone(room.jiraIssues) : null
    return base
  },
})

export const sweepStaleParticipantsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = {
      ...clone(roomDoc),
      _id: roomDoc._id,
    }
    const participants = await listParticipants(ctx as QueryCtx)
    const remainingParticipants = await cleanupStaleParticipants(ctx as MutationCtx, room, participants)
    return { ok: true, participantCount: remainingParticipants.length }
  },
})

export const sendEvent = mutation({
  args: {
    clientId: v.optional(v.string()),
    event: v.optional(v.any()),
  },
  handler: async (ctx, args: { clientId?: string; event?: unknown } | undefined) => {
    const identity = await ctx.auth.getUserIdentity()
    const clientId = identity
      ? getAuthenticatedClientId(identity)
      : typeof args?.clientId === 'string'
        ? args.clientId.trim()
        : ''
    const event = args?.event as ClientEvent | undefined
    if (!clientId || !event || typeof event !== 'object' || typeof event.type !== 'string') {
      return { ok: false, message: 'Invalid message format.' }
    }

    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = {
      ...clone(roomDoc),
      _id: roomDoc._id,
    }
    let participants = await listParticipants(ctx as QueryCtx)
    participants = await cleanupStaleParticipants(ctx as MutationCtx, room, participants)
    const participant = findParticipant(participants, clientId)

    switch (event.type) {
      case 'join': {
        const normalizedName = normalizeName(event.name)
        if (!normalizedName) {
          return { ok: false, message: 'Display name cannot be empty.' }
        }

        if (!room.jiraIssues) {
          return {
            ok: false,
            message: 'Planning session is not open yet. Ask the facilitator to start it from the dashboard.',
          }
        }

        if (participant) {
          await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { name: normalizedName, lastSeenAt: Date.now() })
          await scheduleStaleParticipantSweep(ctx as MutationCtx)
        } else {
          await ctx.db.insert('participants', {
            clientId,
            name: normalizedName,
            colorHue: pickDistinctHue(participants),
            vote: null,
            isFollowingOrchestrator: true,
            lastSeenAt: Date.now(),
          })
          await scheduleStaleParticipantSweep(ctx as MutationCtx)
          if (!room.orchestratorId && room.jiraIssues) {
            room.orchestratorId = clientId
            resetOrchestratorView(room, room.selectedIssueId)
            await persistRoom(ctx as MutationCtx, room)
          }
        }

        return { ok: true }
      }
      case 'heartbeat': {
        if (!participant) {
          return { ok: true }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { lastSeenAt: Date.now() })
        await scheduleStaleParticipantSweep(ctx as MutationCtx)
        return { ok: true }
      }
      case 'update_name': {
        if (!participant) {
          return { ok: false, message: 'Join before changing your name.' }
        }

        const normalizedName = normalizeName(event.name)
        if (!normalizedName) {
          return { ok: false, message: 'Display name cannot be empty.' }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { name: normalizedName, lastSeenAt: Date.now() })
        await scheduleStaleParticipantSweep(ctx as MutationCtx)
        return { ok: true }
      }
      case 'reroll_color': {
        if (!participant) {
          return { ok: false, message: 'Join before changing your color.' }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], {
          colorHue: pickDistinctHue(participants, clientId, participant.colorHue),
          lastSeenAt: Date.now(),
        })
        await scheduleStaleParticipantSweep(ctx as MutationCtx)
        return { ok: true }
      }
      case 'set_vote': {
        if (!participant) {
          return { ok: false, message: 'Join before voting.' }
        }

        if (event.vote !== null && !allowedVotes.has(event.vote)) {
          return { ok: false, message: 'Vote was rejected.' }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { vote: event.vote === null ? null : event.vote, lastSeenAt: Date.now() })
        await scheduleStaleParticipantSweep(ctx as MutationCtx)
        return { ok: true }
      }
      case 'select_issue': {
        if (!participant) {
          return { ok: false, message: 'Join before selecting a ticket.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const issueKey = normalizeIssueKey(event.issueKey)
        const issueUrl = normalizeIssueUrl(event.issueUrl)
        if (!issueId || !issueKey) {
          return { ok: false, message: 'Issue selection is missing required details.' }
        }

        const fields = normalizeEditorFields(event.fields)
        ensureIssueDraft(room, issueId, issueKey, issueUrl, fields, clientId)
        if (canClientControlTicketFlow(room, clientId)) {
          room.selectedIssueId = issueId
          if (room.orchestratorId === clientId || room.orchestratorId === null) {
            resetOrchestratorView(room, issueId)
          }
        }

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'set_issue_field': {
        if (!participant) {
          return { ok: false, message: 'Join before editing ticket fields.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const issueKey = normalizeIssueKey(event.issueKey)
        const issueUrl = normalizeIssueUrl(event.issueUrl)
        const field = normalizeEditorField(event.field)
        if (!issueId || !issueKey || !field) {
          return { ok: false, message: 'Field update was missing required values.' }
        }

        if (!canEditIssue(room, clientId, issueId)) {
          return { ok: false, message: 'Only the orchestrator can edit tickets outside the shared focus right now.' }
        }

        const draft = ensureIssueDraft(room, issueId, issueKey, issueUrl, [field], clientId)
        const draftField = ensureDraftField(draft, field.id, field.label)
        if (!draftField) {
          return { ok: false, message: 'Field update was rejected.' }
        }

        draftField.label = normalizeFieldLabel(field.label, draftField.id)
        draftField.value = normalizeIssueText(field.value)
        touchIssueDraft(draft, clientId)
        updateIssueSyncLifecycle(room, issueId, issueKey, issueUrl, draftField.id, draftField.label, draftField.value)

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'issue_crdt_delta': {
        if (!participant) {
          return { ok: false, message: 'Join before collaborating on ticket descriptions.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const fieldId = normalizeFieldId(event.fieldId)
        const update = decodeBinaryPayload(event.update)
        if (!issueId || !fieldId || !update) {
          return { ok: false, message: 'Collaborative field update was invalid.' }
        }

        if (!canEditIssue(room, clientId, issueId)) {
          return { ok: false, message: 'Only the orchestrator can edit tickets outside the shared focus right now.' }
        }

        const draft = room.issueDrafts.find((entry) => entry.issueId === issueId)
        if (!draft) {
          return { ok: true }
        }

        const draftField = ensureDraftField(draft, fieldId, event.label)
        const crdtEntry = ensureIssueCrdtEntry(room, issueId)
        if (!draftField || !crdtEntry) {
          return { ok: false, message: 'Collaborative field update was rejected.' }
        }

        const crdtField = ensureIssueCrdtField(crdtEntry, fieldId, event.label)
        if (!crdtField) {
          return { ok: false, message: 'Collaborative field update was rejected.' }
        }

        const doc = new Y.Doc()
        const text = doc.getText('content')
        const existingUpdate = decodeBinaryPayload(crdtField.update)
        if (existingUpdate) {
          Y.applyUpdate(doc, existingUpdate)
        } else if (draftField.value) {
          text.insert(0, draftField.value)
        }

        try {
          Y.applyUpdate(doc, update)
        } catch {
          return { ok: false, message: 'Collaborative field update could not be applied.' }
        }

        crdtField.label = normalizeFieldLabel(event.label, draftField.label || fieldId)
        crdtField.update = encodeBinaryPayload(Y.encodeStateAsUpdate(doc))
        draftField.label = crdtField.label
        draftField.value = normalizeIssueText(text.toString())
        touchIssueDraft(draft, clientId)
        updateIssueSyncLifecycle(room, issueId, draft.issueKey, draft.issueUrl, draftField.id, draftField.label, draftField.value)

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'add_issue_subtask': {
        if (!participant) {
          return { ok: false, message: 'Join before creating subtasks.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const issueKey = normalizeIssueKey(event.issueKey)
        const issueUrl = normalizeIssueUrl(event.issueUrl)
        const title = normalizeSubtaskTitle(event.title)
        if (!issueId || !issueKey || !title) {
          return { ok: false, message: 'Subtask title cannot be empty.' }
        }

        if (!canEditIssue(room, clientId, issueId)) {
          return { ok: false, message: 'Only the orchestrator can edit tickets outside the shared focus right now.' }
        }

        ensureIssueDraft(room, issueId, issueKey, issueUrl, [], clientId)
        const subtaskEntry = ensureIssueSubtasksEntry(room, issueId)
        if (!subtaskEntry) {
          return { ok: false, message: 'Subtask update was rejected.' }
        }
        if (subtaskEntry.subtasks.length >= MAX_SUBTASKS_PER_ISSUE) {
          return { ok: false, message: 'This ticket already has the maximum number of subtasks.' }
        }

        subtaskEntry.subtasks.push({
          id: crypto.randomUUID(),
          key: '',
          url: null,
          title,
          description: '',
          done: false,
        })

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'update_issue_subtask': {
        if (!participant) {
          return { ok: false, message: 'Join before updating subtasks.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const subtaskId = normalizeIssueId(event.subtaskId)
        if (!issueId || !subtaskId || !canEditIssue(room, clientId, issueId)) {
          return { ok: false, message: 'Subtask update was rejected.' }
        }

        const subtaskEntry = ensureIssueSubtasksEntry(room, issueId)
        const subtask = subtaskEntry?.subtasks.find((entry) => entry.id === subtaskId) ?? null
        if (!subtask) {
          return { ok: true }
        }

        if (typeof event.title === 'string') {
          const title = normalizeSubtaskTitle(event.title)
          if (!title) {
            return { ok: false, message: 'Subtask title cannot be empty.' }
          }
          subtask.title = title
        }
        if (typeof event.description === 'string') {
          subtask.description = normalizeIssueText(event.description)
        }
        if (typeof event.done === 'boolean') {
          subtask.done = event.done
        }

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'remove_issue_subtask': {
        if (!participant) {
          return { ok: false, message: 'Join before removing subtasks.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const subtaskId = normalizeIssueId(event.subtaskId)
        if (!issueId || !subtaskId || !canEditIssue(room, clientId, issueId)) {
          return { ok: false, message: 'Subtask removal was rejected.' }
        }

        const subtaskEntry = ensureIssueSubtasksEntry(room, issueId)
        if (!subtaskEntry) {
          return { ok: true }
        }

        subtaskEntry.subtasks = subtaskEntry.subtasks.filter((entry) => entry.id !== subtaskId)
        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'set_room_settings': {
        if (!participant || !canClientControlTicketFlow(room, clientId)) {
          return { ok: false, message: 'Only the orchestrator can update session settings.' }
        }

        room.settings = {
          ...room.settings,
          ...normalizeRoomSettings(event.settings),
        }
        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'set_issue_presence': {
        if (!participant) {
          return { ok: false, message: 'Join before collaborating on a ticket.' }
        }

        const issueId = normalizeIssueId(event.issueId)
        const targetId = normalizeIssuePresenceTargetId(event.targetId)
        if (!issueId || !targetId) {
          return { ok: false, message: 'Presence update is missing required details.' }
        }

        if (!room.issueDrafts.some((draft) => draft.issueId === issueId)) {
          return { ok: true }
        }

        const changed = setIssuePresenceState(room, clientId, issueId, targetId, event.active)
        if (!changed) {
          return { ok: true }
        }

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'set_orchestrator_view': {
        if (!participant) {
          return { ok: false, message: 'Join before sharing orchestrator view state.' }
        }

        if (!room.orchestratorId || room.orchestratorId !== clientId) {
          return { ok: true }
        }

        const issueId = event.issueId === null ? null : normalizeIssueId(event.issueId)
        const targetId = event.targetId === null ? null : normalizeIssuePresenceTargetId(event.targetId)
        if (event.issueId !== null && !issueId) {
          return { ok: false, message: 'Orchestrator view issue id is invalid.' }
        }
        if (event.targetId !== null && !targetId) {
          return { ok: false, message: 'Orchestrator view target id is invalid.' }
        }

        const changed = setOrchestratorView(room, {
          issueId,
          targetId: issueId ? targetId : null,
          scrollTop: normalizeScrollTop(event.scrollTop),
        })
        if (!changed) {
          return { ok: true }
        }

        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'set_follow_orchestrator': {
        if (!participant) {
          return { ok: false, message: 'Join before updating follow mode.' }
        }

        const nextState = room.orchestratorId === clientId ? true : event.following === true
        if (participant.isFollowingOrchestrator === nextState) {
          return { ok: true }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { isFollowingOrchestrator: nextState, lastSeenAt: Date.now() })
        await scheduleStaleParticipantSweep(ctx as MutationCtx)
        return { ok: true }
      }
      case 'reveal': {
        if (!participant || !canClientControlTicketFlow(room, clientId)) {
          return { ok: false, message: 'Only the orchestrator can reveal votes.' }
        }

        if (participants.length === 0 || room.revealed) {
          return { ok: true }
        }

        room.revealed = true
        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'next_ticket': {
        if (!participant || !canClientControlTicketFlow(room, clientId)) {
          return { ok: false, message: 'Only the orchestrator can advance the room.' }
        }

        if (participants.length === 0) {
          return { ok: true }
        }

        const hasAnyVote = participants.some((entry) => entry.vote !== null)
        if (hasAnyVote) {
          markIssueEstimated(room, room.selectedIssueId)
        }

        room.revealed = false
        for (const entry of participants) {
          if (entry.vote !== null) {
            await ctx.db.patch(entry._id as Parameters<typeof ctx.db.patch>[0], { vote: null })
          }
        }

        const canControlTicketFlow = canClientControlTicketFlow(room, clientId)
        const requestedNextIssueId = typeof event.nextIssueId === 'string' ? normalizeIssueId(event.nextIssueId) : ''
        if (
          canControlTicketFlow &&
          requestedNextIssueId &&
          ensureSelectedIssueFromShared(room, requestedNextIssueId, null)
        ) {
          await persistRoom(ctx as MutationCtx, room)
          return { ok: true }
        }

        selectNextSharedIssue(room)
        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      default:
        return { ok: false, message: 'Unsupported event type.' }
    }
  },
})

export const setJiraIssues = mutation({
  args: {
    participantId: v.optional(v.string()),
    jiraIssues: v.optional(v.any()),
    jiraSubtasksByIssueId: v.optional(v.any()),
    jiraConnection: v.optional(v.any()),
  },
  handler: async (
    ctx,
    args:
        | {
            participantId?: string
            jiraIssues?: unknown
            jiraSubtasksByIssueId?: unknown
            jiraConnection?: unknown
          }
        | undefined,
  ) => {
    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = {
      ...clone(roomDoc),
      _id: roomDoc._id,
    }

    const jiraIssuesCandidate = args?.jiraIssues
    if (!isRecord(jiraIssuesCandidate) || !Array.isArray(jiraIssuesCandidate.groups)) {
      return { ok: false, message: 'Invalid Jira issue payload.' }
    }
    const jiraIssues = clone(jiraIssuesCandidate) as JiraIssueResult

    room.jiraIssues = jiraIssues
    room.jiraConnection = normalizeJiraConnection(args?.jiraConnection)
    applyEstimatedFlags(room)

    const subtasksByIssueId = isRecord(args?.jiraSubtasksByIssueId)
      ? (clone(args?.jiraSubtasksByIssueId) as Record<string, IssueSubtask[]>)
      : {}
    room.issueSubtasks = Object.entries(subtasksByIssueId)
      .map(([issueId, subtasks]) => ({ issueId: normalizeIssueId(issueId), subtasks }))
      .filter((entry) => entry.issueId)
      .map((entry) => ({
        issueId: entry.issueId,
        subtasks: entry.subtasks.map((subtask) => normalizeIssueSubtask(subtask)).filter((subtask): subtask is IssueSubtask => subtask !== null),
      }))

    const activeIssueIds = new Set(flattenSharedIssueEntries(room).map((entry) => entry.issue.id))
    pruneRoomIssueData(room, activeIssueIds)

    const participants = await listParticipants(ctx as QueryCtx)
    const requesterId = typeof args?.participantId === 'string' ? args.participantId.trim() : ''
    if (requesterId && participants.some((entry) => entry.clientId === requesterId)) {
      room.orchestratorId = requesterId
      resetOrchestratorView(room, room.selectedIssueId)
    } else if (!room.orchestratorId && participants.length === 1) {
      room.orchestratorId = participants[0].clientId
      resetOrchestratorView(room, room.selectedIssueId)
    }

    if (!room.selectedIssueId || !ensureSelectedIssueFromShared(room, room.selectedIssueId, null)) {
      selectFirstSharedIssue(room)
    }

    await persistRoom(ctx as MutationCtx, room)
    return { ok: true, jiraIssues }
  },
})

export const getJiraSyncContext = query({
  args: {
    participantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }

    const room = normalizeRoom(await (ctx as QueryCtx).db.query('rooms').first())
    if (!room?.jiraConnection) {
      return null
    }

    if (room.jiraConnection.ownerUserId !== getIdentityUserId(identity)) {
      return null
    }

    return clone(room.jiraConnection)
  },
})

export const canCurrentUserSyncJira = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return false
    }

    const room = normalizeRoom(await (ctx as QueryCtx).db.query('rooms').first())
    return room?.jiraConnection?.ownerUserId === getIdentityUserId(identity)
  },
})

export const claimOwnerOrchestrator = mutation({
  args: {
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { ok: false, message: 'Sign in before claiming the orchestrator role.' }
    }

    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = { ...clone(roomDoc), _id: roomDoc._id }
    if (!room.jiraConnection || room.jiraConnection.ownerUserId !== getIdentityUserId(identity)) {
      return { ok: false, message: 'Only the Jira-connected facilitator can claim the orchestrator role.' }
    }

    const clientId = getAuthenticatedClientId(identity) || normalizeIssueId(args.clientId)
    if (!clientId) {
      return { ok: false, message: 'Participant id is invalid.' }
    }

    const participants = await listParticipants(ctx as QueryCtx)
    if (!participants.some((participant) => participant.clientId === clientId)) {
      return { ok: false, message: 'Join the room before claiming orchestrator.' }
    }

    if (room.orchestratorId === clientId) {
      return { ok: true }
    }

    room.orchestratorId = clientId
    resetOrchestratorView(room, room.selectedIssueId)
    await persistRoom(ctx as MutationCtx, room)
    return { ok: true }
  },
})

export const clearJiraConnectionForOwner = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { ok: false }
    }

    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = { ...clone(roomDoc), _id: roomDoc._id }
    if (!room.jiraConnection || room.jiraConnection.ownerUserId !== getIdentityUserId(identity)) {
      return { ok: true }
    }

    room.jiraConnection = null
    await persistRoom(ctx as MutationCtx, room)
    return { ok: true }
  },
})

export const markIssueFieldSyncing = mutation({
  args: {
    issueId: v.string(),
    issueKey: v.string(),
    issueUrl: v.string(),
    fieldId: v.string(),
    label: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = { ...clone(roomDoc), _id: roomDoc._id }
    const syncField = ensureIssueSyncField(
      room,
      args.issueId,
      args.issueKey,
      args.issueUrl,
      args.fieldId,
      args.label,
      args.value,
    )
    if (!syncField) {
      return { ok: false }
    }

    syncField.status = 'syncing'
    syncField.value = normalizeIssueText(args.value)
    syncField.lastAttemptAt = new Date().toISOString()
    syncField.failureMessage = null
    await persistRoom(ctx as MutationCtx, room)
    return { ok: true }
  },
})

export const markIssueFieldSyncResult = mutation({
  args: {
    issueId: v.string(),
    issueKey: v.string(),
    issueUrl: v.string(),
    fieldId: v.string(),
    label: v.string(),
    value: v.string(),
    ok: v.boolean(),
    failureMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = { ...clone(roomDoc), _id: roomDoc._id }
    const syncField = ensureIssueSyncField(
      room,
      args.issueId,
      args.issueKey,
      args.issueUrl,
      args.fieldId,
      args.label,
      args.value,
    )
    if (!syncField) {
      return { ok: false }
    }

    syncField.value = normalizeIssueText(args.value)
    syncField.lastAttemptAt = new Date().toISOString()
    if (args.ok) {
      syncField.status = 'clean'
      syncField.retryCount = 0
      syncField.nextRetryAt = null
      syncField.failureMessage = null
      syncField.lastSyncedAt = syncField.lastAttemptAt
    } else {
      syncField.status = 'failed'
      syncField.retryCount += 1
      syncField.nextRetryAt = new Date(Date.now() + getRetryDelayMs(syncField.retryCount)).toISOString()
      syncField.failureMessage = normalizeIssueText(args.failureMessage, 300) || 'Failed to sync field to Jira.'
    }

    await persistRoom(ctx as MutationCtx, room)
    return { ok: true }
  },
})

export const leave = mutation({
  args: {
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args: { clientId?: string } | undefined) => {
    const clientId = typeof args?.clientId === 'string' ? args.clientId.trim() : ''
    if (!clientId) {
      return { ok: true }
    }

    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = {
      ...clone(roomDoc),
      _id: roomDoc._id,
    }
    const participants = await listParticipants(ctx as QueryCtx)
    const participant = findParticipant(participants, clientId)
    if (participant) {
      await ctx.db.delete(participant._id as Parameters<typeof ctx.db.delete>[0])
    }

    if (room.orchestratorId === clientId) {
      const remaining = participants.filter((entry) => entry.clientId !== clientId)
      room.orchestratorId = remaining.length > 0 ? remaining[0].clientId : null
      resetOrchestratorView(room, room.orchestratorId ? room.selectedIssueId : null)
    }

    clearClientIssuePresence(room, clientId)
    await persistRoom(ctx as MutationCtx, room)
    await resetRoomIfEmpty(ctx as MutationCtx, room)
    return { ok: true }
  },
})
