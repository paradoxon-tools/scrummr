import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type {
  ClientEvent,
  EstimateOption,
  IssueCrdtSnapshot,
  IssueDraftSnapshot,
  IssueEditorField,
  IssueFieldCrdtSnapshot,
  IssuePresenceSnapshot,
  IssueSubtask,
  JiraIssue,
  JiraIssueGroup,
  JiraIssueResult,
  OrchestratorViewSnapshot,
  RoomStateSnapshot,
} from "../src/lib/protocol";
import * as Y from 'yjs'

type RoomRecord = {
  _id?: unknown;
  revealed: boolean;
  selectedIssueId: string | null;
  orchestratorId: string | null;
  orchestratorView: OrchestratorViewSnapshot;
  issueDrafts: IssueDraftSnapshot[];
  issueCrdt: IssueCrdtSnapshot[];
  issuePresence: IssuePresenceSnapshot[];
  jiraIssues: JiraIssueResult | null;
  jiraSubtasksByIssueId: Record<string, IssueSubtask[]>;
  estimatedIssueIds: string[];
};

type ParticipantRecord = {
  _id: unknown;
  clientId: string;
  name: string;
  colorHue: number;
  vote: EstimateOption | null;
  isFollowingOrchestrator: boolean;
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

const createEmptyOrchestratorView = (): OrchestratorViewSnapshot => ({
  issueId: null,
  targetId: null,
  scrollTop: 0,
})

const createDefaultRoom = (): Omit<RoomRecord, '_id'> => ({
  revealed: false,
  selectedIssueId: null,
  orchestratorId: null,
  orchestratorView: createEmptyOrchestratorView(),
  issueDrafts: [],
  issueCrdt: [],
  issuePresence: [],
  jiraIssues: null,
  jiraSubtasksByIssueId: {},
  estimatedIssueIds: [],
})

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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
  seedSubtasks: IssueSubtask[] = [],
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

    if (seedSubtasks.length > 0) {
      const existingSubtaskIds = new Set(existing.subtasks.map((subtask) => subtask.id))
      for (const seedSubtask of seedSubtasks) {
        if (existing.subtasks.length >= MAX_SUBTASKS_PER_ISSUE) {
          break
        }

        if (existingSubtaskIds.has(seedSubtask.id)) {
          continue
        }

        existing.subtasks.push({ ...seedSubtask })
        existingSubtaskIds.add(seedSubtask.id)
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
    subtasks: seedSubtasks.slice(0, MAX_SUBTASKS_PER_ISSUE).map((subtask) => ({ ...subtask })),
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

  const subtasks = room.jiraSubtasksByIssueId?.[normalizedIssueId] ?? []
  ensureIssueDraft(
    room,
    normalizedIssueId,
    normalizeIssueKey(entry.issue.key),
    normalizeIssueUrl(entry.issue.url),
    buildWorkspaceSeedFields(entry.issue, entry.group),
    updatedBy,
    subtasks,
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
  orchestratorView: createEmptyOrchestratorView(),
  participants: [],
  issueWorkspace: {
    selectedIssueId: null,
    drafts: [],
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
    orchestratorView: isRecord(raw.orchestratorView)
      ? {
          issueId: typeof raw.orchestratorView.issueId === 'string' ? raw.orchestratorView.issueId : null,
          targetId: typeof raw.orchestratorView.targetId === 'string' ? raw.orchestratorView.targetId : null,
          scrollTop: normalizeScrollTop(raw.orchestratorView.scrollTop),
        }
      : defaults.orchestratorView,
    issueDrafts: Array.isArray(raw.issueDrafts) ? (clone(raw.issueDrafts) as IssueDraftSnapshot[]) : defaults.issueDrafts,
    issueCrdt: normalizeIssueCrdt(raw.issueCrdt),
    issuePresence: Array.isArray(raw.issuePresence) ? (clone(raw.issuePresence) as IssuePresenceSnapshot[]) : defaults.issuePresence,
    jiraIssues: raw.jiraIssues ? (clone(raw.jiraIssues) as JiraIssueResult) : null,
    jiraSubtasksByIssueId: isRecord(raw.jiraSubtasksByIssueId)
      ? (clone(raw.jiraSubtasksByIssueId) as Record<string, IssueSubtask[]>)
      : defaults.jiraSubtasksByIssueId,
    estimatedIssueIds: Array.isArray(raw.estimatedIssueIds)
      ? raw.estimatedIssueIds.map((value) => (typeof value === 'string' ? value : '')).filter(Boolean)
      : defaults.estimatedIssueIds,
  }
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
    orchestratorView: room.orchestratorView,
    issueDrafts: room.issueDrafts,
    issueCrdt: room.issueCrdt,
    issuePresence: room.issuePresence,
    jiraIssues: room.jiraIssues,
    jiraSubtasksByIssueId: room.jiraSubtasksByIssueId,
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
    const clientId = typeof args?.clientId === 'string' && args.clientId.trim() ? args.clientId.trim() : crypto.randomUUID()
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
    base.orchestratorView = room.orchestratorView ?? createEmptyOrchestratorView()
    base.participants = participantViews
    base.issueWorkspace = {
      selectedIssueId: room.selectedIssueId,
      drafts: clone(Array.isArray(room.issueDrafts) ? room.issueDrafts : []),
      presence: clone(Array.isArray(room.issuePresence) ? room.issuePresence : []),
      crdt: clone(Array.isArray(room.issueCrdt) ? room.issueCrdt : []),
    }
    base.jiraIssues = room.jiraIssues ? clone(room.jiraIssues) : null
    return base
  },
})

export const sendEvent = mutation({
  args: {
    clientId: v.optional(v.string()),
    event: v.optional(v.any()),
  },
  handler: async (ctx, args: { clientId?: string; event?: unknown } | undefined) => {
    const clientId = typeof args?.clientId === 'string' ? args.clientId.trim() : ''
    const event = args?.event as ClientEvent | undefined
    if (!clientId || !event || typeof event !== 'object' || typeof event.type !== 'string') {
      return { ok: false, message: 'Invalid message format.' }
    }

    const roomDoc = await ensureRoom(ctx as MutationCtx)
    const room = {
      ...clone(roomDoc),
      _id: roomDoc._id,
    }
    const participants = await listParticipants(ctx as QueryCtx)
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
          await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { name: normalizedName })
        } else {
          await ctx.db.insert('participants', {
            clientId,
            name: normalizedName,
            colorHue: pickDistinctHue(participants),
            vote: null,
            isFollowingOrchestrator: true,
          })
          if (!room.orchestratorId && room.jiraIssues) {
            room.orchestratorId = clientId
            resetOrchestratorView(room, room.selectedIssueId)
            await persistRoom(ctx as MutationCtx, room)
          }
        }

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

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { name: normalizedName })
        return { ok: true }
      }
      case 'reroll_color': {
        if (!participant) {
          return { ok: false, message: 'Join before changing your color.' }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], {
          colorHue: pickDistinctHue(participants, clientId, participant.colorHue),
        })
        return { ok: true }
      }
      case 'set_vote': {
        if (!participant) {
          return { ok: false, message: 'Join before voting.' }
        }

        if (event.vote !== null && !allowedVotes.has(event.vote)) {
          return { ok: false, message: 'Vote was rejected.' }
        }

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { vote: event.vote === null ? null : event.vote })
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
        const subtasks = room.jiraSubtasksByIssueId?.[issueId] ?? []
        ensureIssueDraft(room, issueId, issueKey, issueUrl, fields, clientId, subtasks)
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

        const subtasks = room.jiraSubtasksByIssueId?.[issueId] ?? []
        const draft = ensureIssueDraft(room, issueId, issueKey, issueUrl, [field], clientId, subtasks)
        const draftField = ensureDraftField(draft, field.id, field.label)
        if (!draftField) {
          return { ok: false, message: 'Field update was rejected.' }
        }

        draftField.label = normalizeFieldLabel(field.label, draftField.id)
        draftField.value = normalizeIssueText(field.value)
        touchIssueDraft(draft, clientId)

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

        const subtasks = room.jiraSubtasksByIssueId?.[issueId] ?? []
        const draft = ensureIssueDraft(room, issueId, issueKey, issueUrl, [], clientId, subtasks)
        if (draft.subtasks.length >= MAX_SUBTASKS_PER_ISSUE) {
          return { ok: false, message: 'This ticket already has the maximum number of subtasks.' }
        }

        draft.subtasks.push({
          id: crypto.randomUUID(),
          key: '',
          url: null,
          title,
          description: '',
          done: false,
        })

        touchIssueDraft(draft, clientId)
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

        await ctx.db.patch(participant._id as Parameters<typeof ctx.db.patch>[0], { isFollowingOrchestrator: nextState })
        return { ok: true }
      }
      case 'reveal': {
        if (participants.length === 0 || room.revealed) {
          return { ok: true }
        }

        room.revealed = true
        await persistRoom(ctx as MutationCtx, room)
        return { ok: true }
      }
      case 'next_ticket': {
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
  },
  handler: async (
    ctx,
    args:
      | {
          participantId?: string
          jiraIssues?: unknown
          jiraSubtasksByIssueId?: unknown
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
    room.jiraSubtasksByIssueId = isRecord(args?.jiraSubtasksByIssueId)
      ? (clone(args?.jiraSubtasksByIssueId) as Record<string, IssueSubtask[]>)
      : {}
    applyEstimatedFlags(room)

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
