'use client'

import { useUser } from '@clerk/tanstack-react-start'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import * as Y from 'yjs'
import { api } from '../convex/_generated/api.js'
import JoinView from '../components/planning/JoinView'
import JiraTicketList from '../components/planning/JiraTicketList'
import TicketWorkspace from '../components/planning/TicketWorkspace'
import ParticipantsPanel from '../components/planning/ParticipantsPanel'
import { createRoomConnection, type RoomConnection } from '../src/lib/roomConnection'
import {
  ESTIMATE_OPTIONS,
  type ClientEvent,
  type EstimateOption,
  type IssueDraftSnapshot,
  type IssueEditorField,
  type IssueFieldSyncSnapshot,
  type IssueSubtask,
  type JiraIssue,
  type JiraIssueCategory,
  type JiraIssueGroup,
  type JiraIssueResult,
  type RoomStateSnapshot,
  type ServerEvent,
} from '../src/lib/protocol'

type IssueFieldDoc = {
  issueId: string
  fieldId: string
  label: string
  doc: Y.Doc
  text: Y.Text
  onUpdate: (update: Uint8Array, origin: unknown) => void
}

const STORAGE_KEY = 'scrummr.display_name'
const CRDT_UPDATE_MAX_BYTES = 1024 * 256
const SESSION_JOIN_RETRY_DELAY_MS = 1500
const CRDT_REMOTE_ORIGIN = Symbol('crdt-remote')
const CRDT_BOOTSTRAP_ORIGIN = Symbol('crdt-bootstrap')
const ORCHESTRATOR_SCROLL_SYNC_DELAY_MS = 90
const PARTICIPANT_HEARTBEAT_INTERVAL_MS = 15_000
const INACTIVITY_UNFOCUS_DELAY_MS = 30_000
const AUTHENTICATED_CLIENT_ID_PREFIX = 'clerk:'
const ANONYMOUS_CONNECTION_KEY = 'anonymous'

const createEmptyIssueWorkspace = (): RoomStateSnapshot['issueWorkspace'] => ({
  selectedIssueId: null,
  drafts: [],
  subtasks: [],
  sync: [],
  presence: [],
  crdt: [],
})

const createEmptyOrchestratorView = (): RoomStateSnapshot['orchestratorView'] => ({
  issueId: null,
  targetId: null,
  scrollTop: 0,
})

const createEmptyState = (): RoomStateSnapshot => ({
  revealed: false,
  myId: '',
  myVote: null,
  orchestratorId: null,
  settings: {
    allowParticipantEditingOutsideFocus: true,
  },
  orchestratorView: createEmptyOrchestratorView(),
  participants: [],
  issueWorkspace: createEmptyIssueWorkspace(),
  jiraIssues: null,
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '')
const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').slice(0, 40)
const normalizeIssueId = (value: string): string => value.trim().slice(0, 80)
const normalizeIssueKey = (value: string): string => value.trim().toUpperCase().slice(0, 40)
const buildAuthenticatedClientId = (userId: string): string =>
  normalizeIssueId(`${AUTHENTICATED_CLIENT_ID_PREFIX}${userId}`)

const normalizeEditorText = (value: string, maxLength = 16000): string => value.replace(/\r\n/g, '\n').slice(0, maxLength)
const normalizeEditorFieldId = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80)
const normalizePresenceTargetId = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9:._-]/g, '_').slice(0, 120)

const normalizeScrollTop = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

const fieldPresenceTargetId = (fieldId: string): string => normalizePresenceTargetId(`field:${normalizeEditorFieldId(fieldId)}`)

const parseServerEvent = (payload: string): ServerEvent | null => {
  try {
    const parsed = JSON.parse(payload)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null
    }
    return parsed as ServerEvent
  } catch {
    return null
  }
}

const parseJiraIssueList = (payload: unknown): JiraIssue[] | null => {
  if (!Array.isArray(payload)) {
    return null
  }

  return payload
    .filter((issue): issue is Record<string, unknown> => isRecord(issue))
    .map((issue) => ({
      id: toStringOrEmpty(issue.id),
      key: toStringOrEmpty(issue.key),
      summary: toStringOrEmpty(issue.summary),
      description: toStringOrEmpty(issue.description),
      status: toStringOrEmpty(issue.status),
      assignee: typeof issue.assignee === 'string' && issue.assignee ? issue.assignee : null,
      priority: typeof issue.priority === 'string' && issue.priority ? issue.priority : null,
      issueType: toStringOrEmpty(issue.issueType) || 'Issue',
      reporter: typeof issue.reporter === 'string' && issue.reporter ? issue.reporter : null,
      createdAt: typeof issue.createdAt === 'string' ? issue.createdAt : null,
      updatedAt: typeof issue.updatedAt === 'string' ? issue.updatedAt : null,
      url: toStringOrEmpty(issue.url),
      isEstimated: issue.isEstimated === true,
      fields: Array.isArray(issue.fields)
        ? issue.fields
            .filter((field): field is Record<string, unknown> => isRecord(field))
            .map((field) => ({
              id: toStringOrEmpty(field.id),
              label: toStringOrEmpty(field.label),
              value: toStringOrEmpty(field.value),
            }))
            .filter((field) => field.id !== '' && field.label !== '')
        : [],
    }))
    .filter((issue) => issue.id !== '' && issue.key !== '' && issue.summary !== '')
}

const parseJiraIssueResult = (payload: unknown): JiraIssueResult | null => {
  if (!isRecord(payload) || !Array.isArray(payload.groups)) {
    return null
  }

  const groups: JiraIssueGroup[] = []
  for (const groupCandidate of payload.groups) {
    if (!isRecord(groupCandidate)) {
      return null
    }

    const issues = parseJiraIssueList(groupCandidate.issues)
    if (!issues) {
      return null
    }

    const category = groupCandidate.category
    if (category !== 'current' && category !== 'future' && category !== 'backlog') {
      return null
    }

    groups.push({
      id: toStringOrEmpty(groupCandidate.id) || `${category}-${groups.length + 1}`,
      name:
        toStringOrEmpty(groupCandidate.name) ||
        (category === 'backlog' ? 'Backlog / No sprint' : category === 'current' ? 'Current sprint' : 'Future sprint'),
      category: category as JiraIssueCategory,
      sprint:
        isRecord(groupCandidate.sprint) && Number.isFinite(Number(groupCandidate.sprint.id))
          ? {
              id: Number(groupCandidate.sprint.id),
              name: toStringOrEmpty(groupCandidate.sprint.name) || 'Unnamed sprint',
              state: toStringOrEmpty(groupCandidate.sprint.state) || 'unknown',
              startDate: typeof groupCandidate.sprint.startDate === 'string' ? groupCandidate.sprint.startDate : null,
              endDate: typeof groupCandidate.sprint.endDate === 'string' ? groupCandidate.sprint.endDate : null,
              completeDate: typeof groupCandidate.sprint.completeDate === 'string' ? groupCandidate.sprint.completeDate : null,
            }
          : null,
      issues,
    })
  }

  const quickFilters = isRecord(payload.quickFilters) ? payload.quickFilters : null
  const parsedQuickFilterFields = quickFilters && Array.isArray(quickFilters.fields)
    ? quickFilters.fields
        .filter((field): field is Record<string, unknown> => isRecord(field))
        .map((field) => ({
          id: normalizeEditorFieldId(toStringOrEmpty(field.id)),
          label: toStringOrEmpty(field.label).trim().slice(0, 80),
        }))
        .filter((field) => field.id !== '' && field.label !== '')
    : []

  const parsedQuickFilterBadges = quickFilters && Array.isArray(quickFilters.badges)
    ? quickFilters.badges
        .filter((badge): badge is Record<string, unknown> => isRecord(badge))
        .map((badge) => {
          const fieldId = normalizeEditorFieldId(toStringOrEmpty(badge.fieldId))
          const value = toStringOrEmpty(badge.value).trim().slice(0, 120)
          const count = Number.isFinite(Number(badge.count)) ? Math.max(0, Math.floor(Number(badge.count))) : 0
          return {
            id: toStringOrEmpty(badge.id).trim() || `${fieldId}:${value.toLowerCase()}`,
            fieldId,
            fieldLabel: toStringOrEmpty(badge.fieldLabel).trim().slice(0, 80),
            value,
            count,
          }
        })
        .filter((badge) => badge.fieldId !== '' && badge.value !== '' && badge.count > 0)
    : []

  return {
    groups,
    quickFilters:
      parsedQuickFilterFields.length > 0 || parsedQuickFilterBadges.length > 0
        ? {
            fields: parsedQuickFilterFields,
            badges: parsedQuickFilterBadges,
          }
        : undefined,
  }
}

const jiraCategoryLabel = (category: JiraIssueCategory): string => {
  if (category === 'current') {
    return 'Current sprint'
  }
  if (category === 'future') {
    return 'Future sprint'
  }
  return 'Backlog'
}

const formatJiraIssueCount = (count: number): string => `${count} issue${count === 1 ? '' : 's'}`

const extractQuickFilterValues = (value: string): string[] => {
  const unique = new Set<string>()
  for (const part of value.split(/[\n,]/g)) {
    const normalized = part.trim().toLowerCase()
    if (!normalized) {
      continue
    }
    unique.add(normalized)
  }
  return [...unique]
}

const normalizeFieldLabelForMatch = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeFieldIdForMatch = (value: string): string => normalizeEditorFieldId(value).replace(/[._-]+/g, ' ').trim()

const hiddenIssueFieldIds = new Set([
  'summary',
  'status',
  'sprint',
  'subtasks',
  'priority',
  'assignee',
  'issue_type',
  'issuetype',
  'reporter',
  'created',
  'updated',
  'status_category_changed',
  'statuscategorychangedate',
  'status_category',
  'statuscategory',
  'last_viewed',
  'lastviewed',
  'creator',
  'progress',
  'aggregate_progress',
  'aggregateprogress',
  'votes',
  'log_work',
  'worklog',
  'project',
  'parent',
  'time_to_resolution',
  'time_to_first_response',
  'linked_issues',
  'attachment',
  'epic_link',
  'work_ratio',
  'workratio',
  'watchers',
  'development',
  'dev_area',
  'time_tracking',
  'timetracking',
  'rank',
  'reply',
  'comment',
  'comments',
])

const hiddenIssueFieldLabels = new Set([
  'summary',
  'status',
  'sprint',
  'sub tasks',
  'subtasks',
  'priority',
  'assignee',
  'issue type',
  'reporter',
  'created',
  'updated',
  'status category changed',
  'status category',
  'last viewed',
  'creator',
  'progress',
  'aggregate progress',
  'votes',
  'log work',
  'project',
  'parent',
  'time to resolution',
  'time to first response',
  'linked issues',
  'attachment',
  'epic link',
  'work ratio',
  'watchers',
  'development',
  'dev area',
  'time tracking',
  'rank',
  'reply',
  'comment',
  'comments',
])

const isIssueFieldHidden = (field: IssueEditorField): boolean => {
  const normalizedId = normalizeEditorFieldId(field.id)
  if (hiddenIssueFieldIds.has(normalizedId)) {
    return true
  }
  return hiddenIssueFieldLabels.has(normalizeFieldLabelForMatch(field.label))
}

const getIssueFieldPriority = (field: IssueEditorField): number => {
  const normalizedId = normalizeFieldIdForMatch(field.id)
  const normalizedLabel = normalizeFieldLabelForMatch(field.label)
  if (normalizedId === 'description' || normalizedLabel === 'description' || normalizedLabel === 'beschreibung') {
    return 0
  }
  if (normalizedId === 'it umsetzung' || normalizedLabel === 'it umsetzung') {
    return 1
  }
  return 2
}

const shouldUseMarkdownEditor = (fieldId: string): boolean => {
  const normalizedId = normalizeEditorFieldId(fieldId)
  return normalizedId === 'description' || normalizedId.includes('description') || normalizedId.includes('comment')
}

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return ''
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  return parsed.toLocaleString()
}

const buildIssueEditorFields = (issue: JiraIssue, sprintName: string): IssueEditorField[] => {
  const fields: IssueEditorField[] = [
    ...issue.fields.map((field) => ({
      id: normalizeEditorFieldId(field.id),
      label: field.label.trim().slice(0, 80),
      value: normalizeEditorText(field.value),
    })),
    { id: 'sprint', label: 'Sprint', value: sprintName },
    { id: 'planning_notes', label: 'Planning Notes', value: '' },
  ]

  const deduped = new Map<string, IssueEditorField>()
  for (const field of fields) {
    if (!field.id || deduped.has(field.id)) {
      continue
    }
    deduped.set(field.id, field)
  }
  return [...deduped.values()]
}

const encodeBinaryPayload = (payload: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const chunk = payload.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return window.btoa(binary)
}

const decodeBinaryPayload = (value: string): Uint8Array | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const binary = window.atob(trimmed)
    if (!binary || binary.length > CRDT_UPDATE_MAX_BYTES) {
      return null
    }

    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

export default function HomePage() {
  const { user, isLoaded: isUserLoaded } = useUser()
  const syncIssueFieldAction = useAction(api.jira.syncIssueField)
  const canCurrentUserSyncJira = useQuery(api.room.canCurrentUserSyncJira, {}) ?? false

  const [roomState, setRoomState] = useState<RoomStateSnapshot>(createEmptyState)
  const roomStateRef = useRef(roomState)

  const [jiraIssues, setJiraIssues] = useState<JiraIssueResult | null>(null)
  const jiraIssuesRef = useRef<JiraIssueResult | null>(null)

  const [jiraError, setJiraError] = useState('')
  const [jiraMessage, setJiraMessage] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [joinedName, setJoinedName] = useState('')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isSocketConnected, setIsSocketConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isProfileEditing, setIsProfileEditing] = useState(false)
  const [isRawTicketDataOpen, setIsRawTicketDataOpen] = useState(false)
  const [isCrdtDebugOpen, setIsCrdtDebugOpen] = useState(false)
  const [localSelectedIssueIdOverride, setLocalSelectedIssueIdOverride] = useState<string | null>(null)
  const [isFollowingOrchestrator, setIsFollowingOrchestrator] = useState(true)
  const [activeQuickFilterBadgeId, setActiveQuickFilterBadgeId] = useState<string | null>(null)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')

  const socketRef = useRef<RoomConnection | null>(null)
  const activeConnectionKeyRef = useRef<string | null>(null)
  const isConnectedRef = useRef(false)
  const isConnectingRef = useRef(false)
  const isUserLoadedRef = useRef(false)
  const preferredClientIdRef = useRef<string | undefined>(undefined)
  const preferredConnectionKeyRef = useRef<string | null>(null)
  const autoConnectInitializedRef = useRef(false)
  const pendingJoinNameRef = useRef('')
  const pendingReconnectNameRef = useRef<string | null>(null)
  const lastJoinAttemptAtRef = useRef(0)
  const isProfileEditingRef = useRef(false)
  const isFollowingOrchestratorRef = useRef(true)
  const localSelectedIssueIdOverrideRef = useRef<string | null>(null)
  const profileSyncTimerRef = useRef<number | undefined>(undefined)
  const jiraFieldBaselineByIssueRef = useRef<Map<string, Map<string, string>>>(new Map())
  const jiraIssueKeyByIdRef = useRef<Map<string, string>>(new Map())
  const jiraFieldSyncInFlightRef = useRef<Set<string>>(new Set())
  const jiraFieldLastRequestedValueRef = useRef<Map<string, string>>(new Map())
  const issueFieldDocsByIssueRef = useRef<Map<string, Map<string, IssueFieldDoc>>>(new Map())
  const activePresenceIssueIdRef = useRef<string | null>(null)
  const activePresenceTargetsRef = useRef<Set<string>>(new Set())
  const orchestratorFocusedTargetIdRef = useRef<string | null>(null)
  const orchestratorScrollSyncTimerRef = useRef<number | undefined>(undefined)
  const pendingOrchestratorScrollTopRef = useRef<number | null>(null)
  const lastSentOrchestratorViewIssueIdRef = useRef<string | null>(null)
  const lastSentOrchestratorViewTargetIdRef = useRef<string | null>(null)
  const lastSentOrchestratorScrollTopRef = useRef(-1)
  const lastSentFollowStateRef = useRef<boolean | null>(null)
  const isApplyingFollowScrollRef = useRef(false)
  const ticketWorkspaceRef = useRef<HTMLElement | null>(null)
  const middleScrollRef = useRef<HTMLElement | null>(null)
  const jiraListScrollRef = useRef<HTMLElement | null>(null)
  const participantNameInputRef = useRef<HTMLInputElement | null>(null)
  const heartbeatTimerRef = useRef<number | undefined>(undefined)
  const inactivityTimerRef = useRef<number | undefined>(undefined)
  const lastActivityAtRef = useRef(Date.now())
  const lastManualScrollAtRef = useRef<number | null>(null)

  useEffect(() => {
    roomStateRef.current = roomState
  }, [roomState])

  useEffect(() => {
    isConnectedRef.current = isConnected
  }, [isConnected])

  useEffect(() => {
    isConnectingRef.current = isConnecting
  }, [isConnecting])

  useEffect(() => {
    isProfileEditingRef.current = isProfileEditing
  }, [isProfileEditing])

  useEffect(() => {
    isFollowingOrchestratorRef.current = isFollowingOrchestrator
  }, [isFollowingOrchestrator])

  useEffect(() => {
    localSelectedIssueIdOverrideRef.current = localSelectedIssueIdOverride
  }, [localSelectedIssueIdOverride])

  useEffect(() => {
    jiraIssuesRef.current = jiraIssues
  }, [jiraIssues])

  const preferredClientId = user?.id ? buildAuthenticatedClientId(user.id) : undefined
  const preferredConnectionKey = isUserLoaded
    ? preferredClientId ?? ANONYMOUS_CONNECTION_KEY
    : null

  useEffect(() => {
    isUserLoadedRef.current = isUserLoaded
  }, [isUserLoaded])

  useEffect(() => {
    preferredClientIdRef.current = preferredClientId
    preferredConnectionKeyRef.current = preferredConnectionKey
  }, [preferredClientId, preferredConnectionKey])

  const send = (event: ClientEvent): void => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }
    socket.send(JSON.stringify(event))
  }

  const isSessionOpen = (state: RoomStateSnapshot): boolean => state.jiraIssues !== null

  const tryJoinPendingParticipant = (force = false): void => {
    const pendingName = normalizeName(pendingJoinNameRef.current)
    if (!pendingName || isConnectedRef.current) {
      return
    }

    const now = Date.now()
    if (!force && now - lastJoinAttemptAtRef.current < SESSION_JOIN_RETRY_DELAY_MS) {
      return
    }

    lastJoinAttemptAtRef.current = now
    send({ type: 'join', name: pendingName })
  }

  const publishRoomState = (): void => {
    setRoomState({ ...roomStateRef.current })
  }

  const canFollowCurrentOrchestrator = (): boolean =>
    roomStateRef.current.orchestratorId !== null && roomStateRef.current.orchestratorId !== roomStateRef.current.myId

  const isCurrentUserOrchestrator = (): boolean =>
    roomStateRef.current.orchestratorId !== null && roomStateRef.current.orchestratorId === roomStateRef.current.myId

  const shouldApplyParticipantInactivityBehavior = (): boolean =>
    isConnectedRef.current && !isCurrentUserOrchestrator()

  const getIssueFieldDoc = (issueId: string, fieldId: string): IssueFieldDoc | null => {
    const normalizedIssueId = normalizeIssueId(issueId)
    const normalizedFieldId = normalizeEditorFieldId(fieldId)
    if (!normalizedIssueId || !normalizedFieldId) {
      return null
    }
    return issueFieldDocsByIssueRef.current.get(normalizedIssueId)?.get(normalizedFieldId) ?? null
  }

  const setDraftFieldFromCrdt = (issueId: string, fieldId: string, label: string, value: string): boolean => {
    const draft = roomStateRef.current.issueWorkspace.drafts.find((entry) => entry.issueId === issueId)
    if (!draft) {
      return false
    }

    const normalizedFieldId = normalizeEditorFieldId(fieldId)
    if (!normalizedFieldId) {
      return false
    }

    const normalizedLabel = label.trim().slice(0, 80) || normalizedFieldId
    const normalizedValue = normalizeEditorText(value)
    const existingField = draft.fields.find((field) => field.id === normalizedFieldId)
    if (existingField) {
      existingField.label = normalizedLabel
      existingField.value = normalizedValue
      return true
    }

    draft.fields.push({ id: normalizedFieldId, label: normalizedLabel, value: normalizedValue })
    return true
  }

  const ensureIssueFieldDoc = (issueId: string, field: IssueEditorField): IssueFieldDoc => {
    const normalizedIssueId = normalizeIssueId(issueId)
    const normalizedFieldId = normalizeEditorFieldId(field.id)
    const normalizedLabel = field.label.trim().slice(0, 80) || normalizedFieldId
    const normalizedValue = normalizeEditorText(field.value)

    let issueDocs = issueFieldDocsByIssueRef.current.get(normalizedIssueId)
    if (!issueDocs) {
      issueDocs = new Map<string, IssueFieldDoc>()
      issueFieldDocsByIssueRef.current.set(normalizedIssueId, issueDocs)
    }

    const existing = issueDocs.get(normalizedFieldId)
    if (existing) {
      existing.label = normalizedLabel
      return existing
    }

    const doc = new Y.Doc()
    const text = doc.getText('content')
    if (normalizedValue) {
      text.insert(0, normalizedValue)
    }

    const issueFieldDoc: IssueFieldDoc = {
      issueId: normalizedIssueId,
      fieldId: normalizedFieldId,
      label: normalizedLabel,
      doc,
      text,
      onUpdate: (update, origin) => {
        if (origin === CRDT_REMOTE_ORIGIN || origin === CRDT_BOOTSTRAP_ORIGIN) {
          return
        }

        send({
          type: 'issue_crdt_delta',
          issueId: normalizedIssueId,
          fieldId: normalizedFieldId,
          label: issueFieldDoc.label,
          update: encodeBinaryPayload(update),
        })
      },
    }

    doc.on('update', issueFieldDoc.onUpdate)
    issueDocs.set(normalizedFieldId, issueFieldDoc)
    return issueFieldDoc
  }

  const replaceIssueFieldDocValue = (issueFieldDoc: IssueFieldDoc, nextValue: string, origin: unknown): void => {
    const normalizedValue = normalizeEditorText(nextValue)
    const currentValue = issueFieldDoc.text.toString()
    if (currentValue === normalizedValue) {
      return
    }

    issueFieldDoc.doc.transact(() => {
      if (currentValue.length > 0) {
        issueFieldDoc.text.delete(0, currentValue.length)
      }
      if (normalizedValue.length > 0) {
        issueFieldDoc.text.insert(0, normalizedValue)
      }
    }, origin)
  }

  const disposeIssueDocsForIssue = (issueId: string): void => {
    const normalizedIssueId = normalizeIssueId(issueId)
    const issueDocs = issueFieldDocsByIssueRef.current.get(normalizedIssueId)
    if (!issueDocs) {
      return
    }

    for (const issueFieldDoc of issueDocs.values()) {
      issueFieldDoc.doc.off('update', issueFieldDoc.onUpdate)
      issueFieldDoc.doc.destroy()
    }

    issueFieldDocsByIssueRef.current.delete(normalizedIssueId)
  }

  const disposeAllIssueDocs = (): void => {
    for (const issueId of issueFieldDocsByIssueRef.current.keys()) {
      disposeIssueDocsForIssue(issueId)
    }
  }

  const syncIssueFieldDocsFromSnapshot = (workspace: RoomStateSnapshot['issueWorkspace']): void => {
    const activeIssueIds = new Set<string>()
    const crdtFieldsByIssueId = new Map(
      workspace.crdt.map((entry) => [
        normalizeIssueId(entry.issueId),
        new Set(entry.fields.map((field) => normalizeEditorFieldId(field.fieldId)).filter(Boolean)),
      ]),
    )

    for (const draft of workspace.drafts) {
      const normalizedIssueId = normalizeIssueId(draft.issueId)
      if (!normalizedIssueId) {
        continue
      }

      activeIssueIds.add(normalizedIssueId)
      for (const field of draft.fields) {
        const issueFieldDoc = ensureIssueFieldDoc(draft.issueId, field)
        issueFieldDoc.label = field.label.trim().slice(0, 80) || issueFieldDoc.label
        if (!crdtFieldsByIssueId.get(normalizedIssueId)?.has(normalizeEditorFieldId(field.id))) {
          replaceIssueFieldDocValue(issueFieldDoc, field.value, CRDT_BOOTSTRAP_ORIGIN)
        }
      }
    }

    for (const entry of workspace.crdt) {
      const normalizedIssueId = normalizeIssueId(entry.issueId)
      if (!normalizedIssueId) {
        continue
      }

      activeIssueIds.add(normalizedIssueId)
      for (const field of entry.fields) {
        applyIssueFieldCrdtUpdate(normalizedIssueId, field.fieldId, field.label, field.update, CRDT_BOOTSTRAP_ORIGIN)
      }
    }

    for (const issueId of issueFieldDocsByIssueRef.current.keys()) {
      if (!activeIssueIds.has(issueId)) {
        disposeIssueDocsForIssue(issueId)
      }
    }
  }

  const applyIssueFieldCrdtUpdate = (
    issueId: string,
    fieldId: string,
    label: string,
    encodedUpdate: string,
    origin: unknown,
  ): boolean => {
    const normalizedIssueId = normalizeIssueId(issueId)
    const normalizedFieldId = normalizeEditorFieldId(fieldId)
    if (!normalizedIssueId || !normalizedFieldId) {
      return false
    }

    const decodedUpdate = decodeBinaryPayload(encodedUpdate)
    if (!decodedUpdate) {
      return false
    }

    const draft = roomStateRef.current.issueWorkspace.drafts.find((entry) => entry.issueId === normalizedIssueId) ?? null
    const fallbackField: IssueEditorField = {
      id: normalizedFieldId,
      label: label || normalizedFieldId,
      value: '',
    }
    const draftField = draft?.fields.find((entry) => entry.id === normalizedFieldId) ?? fallbackField
    const issueFieldDoc = ensureIssueFieldDoc(normalizedIssueId, draftField)
    issueFieldDoc.label = label.trim().slice(0, 80) || issueFieldDoc.label

    try {
      Y.applyUpdate(issueFieldDoc.doc, decodedUpdate, origin)
    } catch {
      return false
    }

    return setDraftFieldFromCrdt(normalizedIssueId, normalizedFieldId, issueFieldDoc.label, issueFieldDoc.text.toString())
  }

  const applyIssueCrdtBootstrap = (issueId: string, fields: { fieldId: string; label: string; update: string }[]): void => {
    const normalizedIssueId = normalizeIssueId(issueId)
    if (!normalizedIssueId || fields.length === 0) {
      return
    }

    for (const field of fields) {
      applyIssueFieldCrdtUpdate(normalizedIssueId, field.fieldId, field.label, field.update, CRDT_BOOTSTRAP_ORIGIN)
    }

    publishRoomState()
  }

  const applyIssueCrdtDelta = (
    issueId: string,
    fieldId: string,
    label: string,
    update: string,
    updatedBy: string | null,
    updatedAt: string,
  ): void => {
    applyIssueFieldCrdtUpdate(issueId, fieldId, label, update, CRDT_REMOTE_ORIGIN)
    const draft = roomStateRef.current.issueWorkspace.drafts.find((entry) => entry.issueId === normalizeIssueId(issueId))
    if (draft) {
      draft.updatedBy = updatedBy
      draft.updatedAt = updatedAt
    }
    publishRoomState()
  }

  const getIssueFieldYText = (issueId: string, field: IssueEditorField): Y.Text | null => {
    const issueFieldDoc = getIssueFieldDoc(issueId, field.id) ?? ensureIssueFieldDoc(issueId, field)
    return issueFieldDoc.text
  }

  const getIssueFieldSyncState = (
    issueId: string,
    field: IssueEditorField,
  ): { id: string; label: string; synced: boolean; docLength: number; draftLength: number } => {
    const issueFieldDoc = getIssueFieldDoc(issueId, field.id)
    if (!issueFieldDoc) {
      return {
        id: field.id,
        label: field.label,
        synced: false,
        docLength: 0,
        draftLength: field.value.length,
      }
    }

    const docValue = issueFieldDoc.text.toString()
    return {
      id: field.id,
      label: field.label,
      synced: docValue === field.value,
      docLength: docValue.length,
      draftLength: field.value.length,
    }
  }

  const syncOrchestratorFollowState = (force = false): void => {
    const state = roomStateRef.current
    if (!isConnectedRef.current || !state.myId || !state.participants.some((participant) => participant.id === state.myId)) {
      return
    }

    const following = canFollowCurrentOrchestrator() ? isFollowingOrchestratorRef.current : true
    if (!force && lastSentFollowStateRef.current === following) {
      return
    }

    lastSentFollowStateRef.current = following
    send({ type: 'set_follow_orchestrator', following })
  }

  const applyOrchestratorScrollSync = (force = false): void => {
    const middleScrollElement = middleScrollRef.current
    const state = roomStateRef.current
    if (!middleScrollElement || !isConnectedRef.current || !canFollowCurrentOrchestrator() || !isFollowingOrchestratorRef.current) {
      return
    }

    const selectedIssueId = localSelectedIssueIdOverrideRef.current ?? state.issueWorkspace.selectedIssueId
    const orchestratorView = state.orchestratorView
    if (!selectedIssueId || orchestratorView.issueId !== selectedIssueId) {
      return
    }

    const maxScroll = middleScrollElement.scrollHeight - middleScrollElement.clientHeight
    const nextTop = maxScroll > 0 ? Math.min(normalizeScrollTop(orchestratorView.scrollTop), maxScroll) : 0
    if (!force && Math.abs(middleScrollElement.scrollTop - nextTop) < 2) {
      return
    }

    isApplyingFollowScrollRef.current = true
    middleScrollElement.scrollTop = nextTop
    window.setTimeout(() => {
      isApplyingFollowScrollRef.current = false
    }, 0)
  }

  const syncOrchestratorViewState = (force = false, explicitScrollTop?: number): void => {
    if (!isConnectedRef.current || !isCurrentUserOrchestrator()) {
      return
    }

    const state = roomStateRef.current
    const issueId = state.issueWorkspace.selectedIssueId
    const targetId = issueId ? orchestratorFocusedTargetIdRef.current : null
    const scrollTop = normalizeScrollTop(explicitScrollTop ?? (middleScrollRef.current?.scrollTop ?? 0))
    const shouldSkip =
      !force &&
      lastSentOrchestratorViewIssueIdRef.current === issueId &&
      lastSentOrchestratorViewTargetIdRef.current === targetId &&
      Math.abs(lastSentOrchestratorScrollTopRef.current - scrollTop) < 2

    if (shouldSkip) {
      return
    }

    lastSentOrchestratorViewIssueIdRef.current = issueId
    lastSentOrchestratorViewTargetIdRef.current = targetId
    lastSentOrchestratorScrollTopRef.current = scrollTop

    send({
      type: 'set_orchestrator_view',
      issueId,
      targetId,
      scrollTop,
    })
  }

  const flushOrchestratorScrollSync = (): void => {
    orchestratorScrollSyncTimerRef.current = undefined
    const scrollTop = pendingOrchestratorScrollTopRef.current
    pendingOrchestratorScrollTopRef.current = null
    syncOrchestratorViewState(false, scrollTop === null ? undefined : scrollTop)
  }

  const queueOrchestratorScrollSync = (): void => {
    if (!isConnectedRef.current || !isCurrentUserOrchestrator()) {
      return
    }

    pendingOrchestratorScrollTopRef.current = normalizeScrollTop(middleScrollRef.current?.scrollTop ?? 0)
    if (orchestratorScrollSyncTimerRef.current !== undefined) {
      return
    }

    orchestratorScrollSyncTimerRef.current = window.setTimeout(flushOrchestratorScrollSync, ORCHESTRATOR_SCROLL_SYNC_DELAY_MS)
  }

  const clearOrchestratorScrollSyncTimer = (): void => {
    window.clearTimeout(orchestratorScrollSyncTimerRef.current)
    orchestratorScrollSyncTimerRef.current = undefined
    pendingOrchestratorScrollTopRef.current = null
  }

  const releaseAllIssuePresence = (): void => {
    if (!activePresenceIssueIdRef.current || activePresenceTargetsRef.current.size === 0) {
      activePresenceIssueIdRef.current = null
      activePresenceTargetsRef.current.clear()
      return
    }

    const issueId = activePresenceIssueIdRef.current
    const targets = [...activePresenceTargetsRef.current]
    activePresenceIssueIdRef.current = null
    activePresenceTargetsRef.current.clear()

    for (const targetId of targets) {
      send({
        type: 'set_issue_presence',
        issueId,
        targetId,
        active: false,
      })
    }
  }

  const blurActiveTicketField = (): void => {
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement)) {
      return
    }
    if (!ticketWorkspaceRef.current?.contains(activeElement)) {
      return
    }
    activeElement.blur()
  }

  const clearInactivityTimer = (): void => {
    window.clearTimeout(inactivityTimerRef.current)
    inactivityTimerRef.current = undefined
  }

  const handleParticipantInactivity = (): void => {
    inactivityTimerRef.current = undefined

    if (!shouldApplyParticipantInactivityBehavior()) {
      return
    }

    blurActiveTicketField()

    if (!canFollowCurrentOrchestrator()) {
      return
    }

    const lastManualScrollAt = lastManualScrollAtRef.current
    if (lastManualScrollAt !== null && lastManualScrollAt >= lastActivityAtRef.current) {
      return
    }

    if (!isFollowingOrchestratorRef.current) {
      followOrchestrator()
    }
  }

  const registerParticipantActivity = (options?: { manualScroll?: boolean }): void => {
    if (!shouldApplyParticipantInactivityBehavior()) {
      clearInactivityTimer()
      return
    }

    lastActivityAtRef.current = Date.now()
    if (options?.manualScroll) {
      lastManualScrollAtRef.current = lastActivityAtRef.current
    }

    clearInactivityTimer()
    inactivityTimerRef.current = window.setTimeout(handleParticipantInactivity, INACTIVITY_UNFOCUS_DELAY_MS)
  }

  const isIssueFieldIdleForSync = (issueId: string, fieldId: string): boolean => {
    const targetId = fieldPresenceTargetId(fieldId)
    const presenceEntry = roomStateRef.current.issueWorkspace.presence.find(
      (entry) => entry.issueId === issueId && entry.targetId === targetId,
    )
    return !presenceEntry || presenceEntry.participantIds.length === 0
  }

  const updateJiraFieldBaseline = (issueId: string, fieldId: string, value: string): void => {
    let issueBaseline = jiraFieldBaselineByIssueRef.current.get(issueId)
    if (!issueBaseline) {
      issueBaseline = new Map<string, string>()
      jiraFieldBaselineByIssueRef.current.set(issueId, issueBaseline)
    }
    issueBaseline.set(fieldId, normalizeEditorText(value))
  }

  const syncIssueFieldToJira = async (issueId: string, issueKey: string, fieldId: string, value: string): Promise<void> => {
    const syncKey = `${issueId}:${fieldId}`
    const normalizedValue = normalizeEditorText(value)

    jiraFieldSyncInFlightRef.current.add(syncKey)
    jiraFieldLastRequestedValueRef.current.set(syncKey, normalizedValue)

    try {
      const result = await syncIssueFieldAction({
        participantId: roomStateRef.current.myId || undefined,
        issueId,
        issueKey,
        fieldId,
        value: normalizedValue,
      })

      if (!result.ok) {
        setJiraError(result.message || 'Failed to sync Jira field.')
        return
      }

      updateJiraFieldBaseline(issueId, fieldId, normalizedValue)
      setJiraError('')
    } catch {
      setJiraError('Could not reach Jira while syncing field updates.')
    } finally {
      jiraFieldSyncInFlightRef.current.delete(syncKey)
    }
  }

  const flushPendingJiraSyncs = async (): Promise<void> => {
    if (!isConnectedRef.current || !canCurrentUserSyncJira) {
      return
    }

    const syncRequests: Array<Promise<void>> = []
    for (const syncEntry of roomStateRef.current.issueWorkspace.sync) {
      const draft = roomStateRef.current.issueWorkspace.drafts.find((entry) => entry.issueId === syncEntry.issueId) ?? null
      const issueKey = normalizeIssueKey(syncEntry.issueKey || draft?.issueKey || '')
      if (!issueKey) {
        continue
      }

      for (const field of syncEntry.fields) {
        const normalizedFieldId = normalizeEditorFieldId(field.fieldId)
        if (normalizedFieldId !== 'description' || field.status === 'clean' || field.status === 'syncing') {
          continue
        }

        const retryAt = field.nextRetryAt ? new Date(field.nextRetryAt).getTime() : 0
        if (field.status === 'failed' && retryAt > Date.now()) {
          continue
        }

        const draftUpdatedAt = draft ? new Date(draft.updatedAt).getTime() : 0
        const hasIdleDebounceElapsed = !draft || !Number.isFinite(draftUpdatedAt) || Date.now() - draftUpdatedAt >= 1_500
        if (!hasIdleDebounceElapsed || !isIssueFieldIdleForSync(syncEntry.issueId, normalizedFieldId)) {
          continue
        }

        const syncKey = `${syncEntry.issueId}:${normalizedFieldId}`
        if (jiraFieldSyncInFlightRef.current.has(syncKey) && jiraFieldLastRequestedValueRef.current.get(syncKey) === field.value) {
          continue
        }

        syncRequests.push(syncIssueFieldToJira(syncEntry.issueId, issueKey, normalizedFieldId, field.value))
      }
    }

    await Promise.all(syncRequests)
  }

  const selectedIssueId = localSelectedIssueIdOverride ?? roomState.issueWorkspace.selectedIssueId

  const selectedIssueIdentity = (): { issueId: string; issueKey: string; issueUrl: string } | null => {
    if (!selectedIssueId) {
      return null
    }

    const draft = roomStateRef.current.issueWorkspace.drafts.find((entry) => entry.issueId === selectedIssueId) ?? null
    const issue = jiraIssuesRef.current
      ? jiraIssuesRef.current.groups.flatMap((group) => group.issues).find((entry) => entry.id === selectedIssueId) ?? null
      : null

    const issueKey = draft?.issueKey || issue?.key || ''
    const issueUrl = draft?.issueUrl || issue?.url || ''
    if (!issueKey) {
      return null
    }

    return {
      issueId: selectedIssueId,
      issueKey,
      issueUrl,
    }
  }

  const setIssuePresence = (targetId: string, active: boolean): void => {
    const identity = selectedIssueIdentity()
    if (!identity) {
      return
    }

    const normalizedTargetId = normalizePresenceTargetId(targetId)
    if (!normalizedTargetId) {
      return
    }

    if (active) {
      if (activePresenceIssueIdRef.current && activePresenceIssueIdRef.current !== identity.issueId) {
        releaseAllIssuePresence()
      }

      if (activePresenceIssueIdRef.current === identity.issueId && activePresenceTargetsRef.current.has(normalizedTargetId)) {
        return
      }

      activePresenceIssueIdRef.current = identity.issueId
      activePresenceTargetsRef.current.add(normalizedTargetId)
    } else {
      if (activePresenceIssueIdRef.current !== identity.issueId || !activePresenceTargetsRef.current.has(normalizedTargetId)) {
        return
      }

      activePresenceTargetsRef.current.delete(normalizedTargetId)
      if (activePresenceTargetsRef.current.size === 0) {
        activePresenceIssueIdRef.current = null
      }
    }

    send({
      type: 'set_issue_presence',
      issueId: identity.issueId,
      targetId: normalizedTargetId,
      active,
    })
  }

  const getPresenceEntryForTarget = (targetId: string): RoomStateSnapshot['issueWorkspace']['presence'][number] | null => {
    if (!selectedIssueId) {
      return null
    }

    const normalizedTargetId = normalizePresenceTargetId(targetId)
    if (!normalizedTargetId) {
      return null
    }

    return (
      roomState.issueWorkspace.presence.find((entry) => entry.issueId === selectedIssueId && entry.targetId === normalizedTargetId) ?? null
    )
  }

  const isTargetEditedByOthers = (targetId: string): boolean => {
    const presenceEntry = getPresenceEntryForTarget(targetId)
    if (!presenceEntry) {
      return false
    }

    return presenceEntry.participantIds.some((participantId) => participantId !== roomState.myId)
  }

  const getPresenceLabelForTarget = (targetId: string): string => {
    const presenceEntry = getPresenceEntryForTarget(targetId)
    if (!presenceEntry || presenceEntry.participantIds.length === 0) {
      return ''
    }

    const names = presenceEntry.participantIds
      .map((participantId) => {
        if (participantId === roomState.myId) {
          return 'You'
        }

        return roomState.participants.find((participant) => participant.id === participantId)?.name ?? null
      })
      .filter((name): name is string => name !== null)

    if (names.length === 0) {
      return ''
    }
    return names.length === 1 ? `${names[0]} is editing` : `${names.join(', ')} are editing`
  }

  const readStoredName = (): string | null => {
    const storedName = window.localStorage.getItem(STORAGE_KEY)
    if (!storedName) {
      return null
    }

    const normalized = normalizeName(storedName)
    if (!normalized) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }

    window.localStorage.setItem(STORAGE_KEY, normalized)
    return normalized
  }

  const connect = (explicitName?: string): void => {
    if (isConnectingRef.current || isConnectedRef.current) {
      return
    }

    if (!isUserLoadedRef.current) {
      setConnectionMessage('Checking your sign-in status...')
      return
    }

    const normalizedName = normalizeName(explicitName ?? nameInput)
    if (!normalizedName) {
      setConnectionMessage('Enter a display name to join.')
      return
    }

    setNameInput(normalizedName)
    setJoinedName(normalizedName)
    pendingJoinNameRef.current = normalizedName
    window.localStorage.setItem(STORAGE_KEY, normalizedName)

    const activeSocket = socketRef.current
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      const sessionOpen = isSessionOpen(roomStateRef.current)
      setConnectionMessage(
        sessionOpen ? 'Joining active session...' : 'Waiting for the facilitator to open a planning session...',
      )
      if (sessionOpen) {
        tryJoinPendingParticipant(true)
      }
      return
    }

    setConnectionMessage('Connecting to the planning backend...')
    clearOrchestratorScrollSyncTimer()
    setIsFollowingOrchestrator(true)
    setLocalSelectedIssueIdOverride(null)
    orchestratorFocusedTargetIdRef.current = null
    lastSentOrchestratorViewIssueIdRef.current = null
    lastSentOrchestratorViewTargetIdRef.current = null
    lastSentOrchestratorScrollTopRef.current = -1
    lastSentFollowStateRef.current = null
    isConnectingRef.current = true
    setIsConnecting(true)

    const nextSocket = createRoomConnection(preferredClientIdRef.current)
    if (!nextSocket) {
      isConnectingRef.current = false
      setIsConnecting(false)
      setConnectionMessage('Set VITE_CONVEX_URL to connect to the shared room backend.')
      return
    }

    socketRef.current = nextSocket
    activeConnectionKeyRef.current = preferredConnectionKeyRef.current

    nextSocket.addEventListener('open', () => {
      if (socketRef.current !== nextSocket) {
        return
      }

      isConnectingRef.current = false
      setIsConnecting(false)
      setIsSocketConnected(true)
      setConnectionMessage('Waiting for the facilitator to open a planning session...')
    })

    nextSocket.addEventListener('message', (event) => {
      if (socketRef.current !== nextSocket || typeof event.data !== 'string') {
        return
      }

      const serverEvent = parseServerEvent(event.data)
      if (!serverEvent) {
        setConnectionMessage('Received an invalid update from the server.')
        return
      }

      if (serverEvent.type === 'state_snapshot') {
        const previousRoomState = roomStateRef.current
        roomStateRef.current = serverEvent.state
        setRoomState(serverEvent.state)
        setJiraIssues(serverEvent.state.jiraIssues)
        syncIssueFieldDocsFromSnapshot(serverEvent.state.issueWorkspace)

        const me = serverEvent.state.participants.find((participant) => participant.id === serverEvent.state.myId)
        if (me) {
          isConnectedRef.current = true
          setIsConnected(true)
          setConnectionMessage('')
          setJoinedName(me.name)
          if (!isProfileEditingRef.current) {
            setNameInput(me.name)
          }
        } else {
          if (isConnectedRef.current) {
            isConnectedRef.current = false
            setIsConnected(false)
          }

          if (pendingJoinNameRef.current) {
            if (isSessionOpen(serverEvent.state)) {
              setConnectionMessage('Joining active session...')
              tryJoinPendingParticipant()
            } else {
              setConnectionMessage('Waiting for the facilitator to open a planning session...')
            }
          }
        }

        if (!canFollowCurrentOrchestrator()) {
          if (!isCurrentUserOrchestrator()) {
            blurActiveTicketField()
            releaseAllIssuePresence()
          }
          isFollowingOrchestratorRef.current = true
          setIsFollowingOrchestrator(true)
          localSelectedIssueIdOverrideRef.current = null
          setLocalSelectedIssueIdOverride(null)
          syncOrchestratorFollowState(false)
        } else {
          const hasNextTicketTransition = previousRoomState.revealed && !serverEvent.state.revealed
          if (hasNextTicketTransition) {
            blurActiveTicketField()
            releaseAllIssuePresence()
            isFollowingOrchestratorRef.current = true
            setIsFollowingOrchestrator(true)
            localSelectedIssueIdOverrideRef.current = null
            setLocalSelectedIssueIdOverride(null)
            syncOrchestratorFollowState(false)
          }
        }

        if (isCurrentUserOrchestrator() && serverEvent.state.orchestratorView.issueId !== serverEvent.state.issueWorkspace.selectedIssueId) {
          orchestratorFocusedTargetIdRef.current = null
        }

        const localOverride = localSelectedIssueIdOverrideRef.current
        if (localOverride) {
          const existsInDrafts = serverEvent.state.issueWorkspace.drafts.some((draft) => draft.issueId === localOverride)
          const existsInJira =
            serverEvent.state.jiraIssues?.groups.some((group) =>
              group.issues.some((issue) => issue.id === localOverride),
            ) ?? false
          if (!existsInDrafts && !existsInJira) {
            localSelectedIssueIdOverrideRef.current = null
            setLocalSelectedIssueIdOverride(null)
          }
        }

        syncOrchestratorFollowState(false)
        window.requestAnimationFrame(() => applyOrchestratorScrollSync())
        return
      }

      if (serverEvent.type === 'issue_crdt_bootstrap') {
        applyIssueCrdtBootstrap(serverEvent.issueId, serverEvent.fields)
        return
      }

      if (serverEvent.type === 'issue_crdt_delta') {
        applyIssueCrdtDelta(
          serverEvent.issueId,
          serverEvent.fieldId,
          serverEvent.label,
          serverEvent.update,
          serverEvent.updatedBy,
          serverEvent.updatedAt,
        )
        return
      }

      setConnectionMessage(serverEvent.message)
    })

    nextSocket.addEventListener('close', () => {
      if (socketRef.current !== nextSocket) {
        return
      }

      releaseAllIssuePresence()
      clearOrchestratorScrollSyncTimer()
      socketRef.current = null
      setIsSocketConnected(false)
      pendingJoinNameRef.current = ''
      lastJoinAttemptAtRef.current = 0
      isConnectedRef.current = false
      isConnectingRef.current = false
      setIsConnected(false)
      setIsConnecting(false)
      setJoinedName('')
      isFollowingOrchestratorRef.current = true
      setIsFollowingOrchestrator(true)
      localSelectedIssueIdOverrideRef.current = null
      setLocalSelectedIssueIdOverride(null)
      isApplyingFollowScrollRef.current = false
      orchestratorFocusedTargetIdRef.current = null
      lastSentOrchestratorViewIssueIdRef.current = null
      lastSentOrchestratorViewTargetIdRef.current = null
      lastSentOrchestratorScrollTopRef.current = -1
      lastSentFollowStateRef.current = null
      activeConnectionKeyRef.current = null
      const emptyState = createEmptyState()
      roomStateRef.current = emptyState
      setRoomState(emptyState)
      disposeAllIssueDocs()
      setJiraIssues(null)
      const reconnectName = pendingReconnectNameRef.current
      if (reconnectName) {
        pendingReconnectNameRef.current = null
        setConnectionMessage('Reconnecting with your account...')
        window.setTimeout(() => connect(reconnectName), 0)
        return
      }

      setConnectionMessage('Connection closed. Rejoin to continue planning.')
    })

    nextSocket.addEventListener('error', () => {
      if (socketRef.current !== nextSocket) {
        return
      }
      setConnectionMessage('Could not connect to the planning server.')
    })
  }

  const handleMiddleScroll = (): void => {
    if (!isConnectedRef.current || !middleScrollRef.current || isApplyingFollowScrollRef.current) {
      return
    }

    if (isCurrentUserOrchestrator()) {
      queueOrchestratorScrollSync()
      return
    }

    registerParticipantActivity({ manualScroll: true })

    if (canFollowCurrentOrchestrator() && isFollowingOrchestrator) {
      isFollowingOrchestratorRef.current = false
      setIsFollowingOrchestrator(false)
      syncOrchestratorFollowState(true)
    }
  }

  const handleIssueFieldFocus = (targetId: string): void => {
    registerParticipantActivity()
    setIssuePresence(targetId, true)

    if (isCurrentUserOrchestrator()) {
      orchestratorFocusedTargetIdRef.current = normalizePresenceTargetId(targetId)
      syncOrchestratorViewState(true)
      return
    }

    if (canFollowCurrentOrchestrator() && isFollowingOrchestrator) {
      isFollowingOrchestratorRef.current = false
      setIsFollowingOrchestrator(false)
      syncOrchestratorFollowState(true)
    }
  }

  const handleIssueFieldBlur = (targetId: string): void => {
    setIssuePresence(targetId, false)

    if (isCurrentUserOrchestrator() && orchestratorFocusedTargetIdRef.current === normalizePresenceTargetId(targetId)) {
      orchestratorFocusedTargetIdRef.current = null
      syncOrchestratorViewState(true)
    }
  }

  const followOrchestrator = (): void => {
    if (!canFollowCurrentOrchestrator() || isFollowingOrchestrator) {
      return
    }

    blurActiveTicketField()
    releaseAllIssuePresence()
    isFollowingOrchestratorRef.current = true
    setIsFollowingOrchestrator(true)
    localSelectedIssueIdOverrideRef.current = null
    setLocalSelectedIssueIdOverride(null)
    syncOrchestratorFollowState(true)
    lastManualScrollAtRef.current = null
    window.requestAnimationFrame(() => applyOrchestratorScrollSync(true))
  }

  const selectIssue = (issue: JiraIssue, group: JiraIssueGroup): void => {
    ticketWorkspaceRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    releaseAllIssuePresence()
    registerParticipantActivity()

    const sharedIssueId = roomStateRef.current.issueWorkspace.selectedIssueId
    if (canFollowCurrentOrchestrator() && issue.id !== sharedIssueId) {
      localSelectedIssueIdOverrideRef.current = issue.id
      setLocalSelectedIssueIdOverride(issue.id)
      if (isFollowingOrchestrator) {
        isFollowingOrchestratorRef.current = false
        setIsFollowingOrchestrator(false)
        syncOrchestratorFollowState(true)
      }
    } else if (!canFollowCurrentOrchestrator()) {
      localSelectedIssueIdOverrideRef.current = null
      setLocalSelectedIssueIdOverride(null)
    }

    if (isCurrentUserOrchestrator()) {
      orchestratorFocusedTargetIdRef.current = null
      clearOrchestratorScrollSyncTimer()
    }

    const sprintName = group.sprint?.name ?? group.name
    send({
      type: 'select_issue',
      issueId: issue.id,
      issueKey: issue.key,
      issueUrl: issue.url,
      fields: buildIssueEditorFields(issue, sprintName),
    })
  }

  const addIssueSubtask = (): void => {
    const identity = selectedIssueIdentity()
    if (!identity) {
      return
    }

    const title = normalizeEditorText(newSubtaskTitle, 240).trim()
    if (!title) {
      return
    }

    registerParticipantActivity()

    send({
      type: 'add_issue_subtask',
      issueId: identity.issueId,
      issueKey: identity.issueKey,
      issueUrl: identity.issueUrl,
      title,
    })
    setNewSubtaskTitle('')
  }

  const updateIssueSubtask = (
    subtaskId: string,
    updates: Partial<Pick<IssueSubtask, 'title' | 'description' | 'done'>>,
  ): void => {
    const identity = selectedIssueIdentity()
    if (!identity) {
      return
    }

    registerParticipantActivity()
    send({
      type: 'update_issue_subtask',
      issueId: identity.issueId,
      subtaskId,
      ...updates,
    })
  }

  const removeIssueSubtask = (subtaskId: string): void => {
    const identity = selectedIssueIdentity()
    if (!identity) {
      return
    }

    registerParticipantActivity()
    send({
      type: 'remove_issue_subtask',
      issueId: identity.issueId,
      subtaskId,
    })
  }

  const requestNewColor = (): void => {
    if (!isConnected) {
      return
    }
    send({ type: 'reroll_color' })
  }

  const setVote = (option: EstimateOption): void => {
    const nextVote = roomState.myVote === option ? null : option
    send({ type: 'set_vote', vote: nextVote })
  }

  const revealOrNextTicket = (): void => {
    if (roomState.revealed) {
      const nextIssueId = (() => {
        if (visibleIssueOrder.length === 0) {
          return null
        }

        const currentIndex = selectedIssueId ? visibleIssueOrder.indexOf(selectedIssueId) : -1
        if (currentIndex < 0) {
          return visibleIssueOrder[0]
        }

        return visibleIssueOrder[(currentIndex + 1) % visibleIssueOrder.length]
      })()

      void (async () => {
        if (isCurrentUserOrchestrator()) {
          orchestratorFocusedTargetIdRef.current = null
          clearOrchestratorScrollSyncTimer()
          await flushPendingJiraSyncs()
        }
        send({ type: 'next_ticket', nextIssueId })
      })()
      return
    }
    send({ type: 'reveal' })
  }

  const commitProfileName = (showError: boolean): void => {
    const normalizedName = normalizeName(nameInput)
    if (!normalizedName) {
      if (showError) {
        setConnectionMessage('Display name cannot be empty.')
      }
      setNameInput(joinedName)
      return
    }

    setNameInput(normalizedName)
    window.localStorage.setItem(STORAGE_KEY, normalizedName)

    if (!isConnected || normalizedName === joinedName) {
      return
    }

    setJoinedName(normalizedName)
    send({ type: 'update_name', name: normalizedName })
  }

  const handleNameInput = (value: string): void => {
    const next = value.slice(0, 40)
    setNameInput(next)
    window.localStorage.setItem(STORAGE_KEY, next)

    if (!isConnected) {
      return
    }

    window.clearTimeout(profileSyncTimerRef.current)
    profileSyncTimerRef.current = window.setTimeout(() => {
      commitProfileName(false)
    }, 320)
  }

  useEffect(() => {
    if (!isUserLoaded || autoConnectInitializedRef.current) {
      return
    }

    autoConnectInitializedRef.current = true
    const storedName = readStoredName()
    if (storedName) {
      setNameInput(storedName)
      connect(storedName)
    }
  }, [isUserLoaded])

  useEffect(() => {
    return () => {
      window.clearTimeout(profileSyncTimerRef.current)
      window.clearInterval(heartbeatTimerRef.current)
      clearOrchestratorScrollSyncTimer()
      clearInactivityTimer()
      void flushPendingJiraSyncs()
      releaseAllIssuePresence()
      disposeAllIssueDocs()
      socketRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (!preferredConnectionKey || !socketRef.current) {
      return
    }

    if (activeConnectionKeyRef.current === preferredConnectionKey) {
      return
    }

    const reconnectName = normalizeName(joinedName || pendingJoinNameRef.current || nameInput)
    if (!reconnectName) {
      return
    }

    pendingReconnectNameRef.current = reconnectName
    setConnectionMessage('Switching to your account...')
    socketRef.current.close()
  }, [preferredConnectionKey, joinedName, nameInput])

  useEffect(() => {
    if (isProfileEditing) {
      participantNameInputRef.current?.focus()
    }
  }, [isProfileEditing])

  useEffect(() => {
    if (selectedIssueId) {
      return
    }
    setIsRawTicketDataOpen(false)
    setIsCrdtDebugOpen(false)
  }, [selectedIssueId])

  useEffect(() => {
    clearInactivityTimer()
    if (!isConnected || isCurrentUserOrchestrator()) {
      return
    }

    registerParticipantActivity()
    return clearInactivityTimer
  }, [isConnected, roomState.myId, roomState.orchestratorId])

  useEffect(() => {
    window.clearInterval(heartbeatTimerRef.current)
    if (!isConnected) {
      heartbeatTimerRef.current = undefined
      return
    }

    heartbeatTimerRef.current = window.setInterval(() => {
      send({ type: 'heartbeat' })
    }, PARTICIPANT_HEARTBEAT_INTERVAL_MS)

    return () => {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = undefined
    }
  }, [isConnected])

  useEffect(() => {
    const nextBaselineByIssue = new Map<string, Map<string, string>>()
    const nextIssueKeyById = new Map<string, string>()

    if (jiraIssues) {
      for (const group of jiraIssues.groups) {
        for (const issue of group.issues) {
          const normalizedIssueId = normalizeIssueId(issue.id)
          if (!normalizedIssueId) {
            continue
          }

          nextIssueKeyById.set(normalizedIssueId, normalizeIssueKey(issue.key))
          const issueBaseline = new Map<string, string>()
          for (const field of issue.fields) {
            const normalizedFieldId = normalizeEditorFieldId(field.id)
            if (!normalizedFieldId) {
              continue
            }
            issueBaseline.set(normalizedFieldId, normalizeEditorText(field.value))
          }
          nextBaselineByIssue.set(normalizedIssueId, issueBaseline)
        }
      }
    }

    jiraFieldBaselineByIssueRef.current = nextBaselineByIssue
    jiraIssueKeyByIdRef.current = nextIssueKeyById
    jiraFieldLastRequestedValueRef.current.clear()
  }, [jiraIssues])

  useEffect(() => {
    if (!activeQuickFilterBadgeId) {
      return
    }

    const badges = jiraIssues?.quickFilters?.badges ?? []
    if (badges.some((badge) => badge.id === activeQuickFilterBadgeId)) {
      return
    }

    setActiveQuickFilterBadgeId(null)
  }, [jiraIssues, activeQuickFilterBadgeId])

  useEffect(() => {
    if (isConnected && canFollowCurrentOrchestrator() && isFollowingOrchestrator && middleScrollRef.current) {
      window.requestAnimationFrame(() => applyOrchestratorScrollSync())
    }
  }, [isConnected, isFollowingOrchestrator, roomState.orchestratorView, roomState.issueWorkspace.selectedIssueId, selectedIssueId])

  useEffect(() => {
    if (isConnected && isCurrentUserOrchestrator() && middleScrollRef.current) {
      window.requestAnimationFrame(() => syncOrchestratorViewState(false))
    }
  }, [
    isConnected,
    roomState.issueWorkspace.selectedIssueId,
    roomState.orchestratorView.issueId,
    roomState.orchestratorView.targetId,
    roomState.orchestratorView.scrollTop,
  ])

  useEffect(() => {
    if (!isConnected || !canCurrentUserSyncJira) {
      return
    }
    void flushPendingJiraSyncs()
  }, [
    canCurrentUserSyncJira,
    isConnected,
    roomState.issueWorkspace.sync,
    roomState.issueWorkspace.drafts,
    roomState.issueWorkspace.presence,
    roomState.myId,
    roomState.orchestratorId,
  ])

  const votedCount = useMemo(() => roomState.participants.filter((participant) => participant.hasVoted).length, [roomState.participants])
  const totalCount = roomState.participants.length

  const participantsForDisplay = useMemo(
    () =>
      [...roomState.participants].sort((a, b) => {
        const aIsOrchestrator = a.id === roomState.orchestratorId
        const bIsOrchestrator = b.id === roomState.orchestratorId
        if (aIsOrchestrator !== bIsOrchestrator) {
          return aIsOrchestrator ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      }),
    [roomState.participants, roomState.orchestratorId],
  )

  const canReveal = votedCount > 0

  const revealBuckets = useMemo(
    () =>
      ESTIMATE_OPTIONS.map((estimate) => ({
        estimate,
        voters: roomState.participants.filter((participant) => participant.vote === estimate),
      })).filter((bucket) => bucket.voters.length > 0),
    [roomState.participants],
  )

  const selectedIssueDraft = useMemo(
    () => (selectedIssueId ? roomState.issueWorkspace.drafts.find((draft) => draft.issueId === selectedIssueId) ?? null : null),
    [roomState.issueWorkspace.drafts, selectedIssueId],
  )

  const selectedIssueSubtasks = useMemo(
    () => (selectedIssueId ? roomState.issueWorkspace.subtasks.find((entry) => entry.issueId === selectedIssueId)?.subtasks ?? [] : []),
    [roomState.issueWorkspace.subtasks, selectedIssueId],
  )

  const selectedIssueSyncState = useMemo(
    () => (selectedIssueId ? roomState.issueWorkspace.sync.find((entry) => entry.issueId === selectedIssueId) ?? null : null),
    [roomState.issueWorkspace.sync, selectedIssueId],
  )

  const descriptionSyncState = useMemo(
    () => selectedIssueSyncState?.fields.find((field) => normalizeEditorFieldId(field.fieldId) === 'description') ?? null,
    [selectedIssueSyncState],
  )

  const selectedIssueFromJira = useMemo(
    () =>
      selectedIssueId && jiraIssues
        ? jiraIssues.groups.flatMap((group) => group.issues).find((issue) => issue.id === selectedIssueId) ?? null
        : null,
    [selectedIssueId, jiraIssues],
  )

  const visibleIssueFields = useMemo(
    () =>
      selectedIssueDraft
        ? selectedIssueDraft.fields
            .filter((field) => !isIssueFieldHidden(field))
            .map((field, index) => ({ field, index, priority: getIssueFieldPriority(field) }))
            .sort((a, b) => a.priority - b.priority || a.index - b.index)
            .map((entry) => entry.field)
        : [],
    [selectedIssueDraft],
  )

  const selectedIssueGroup = useMemo(
    () =>
      selectedIssueId && jiraIssues
        ? jiraIssues.groups.find((group) => group.issues.some((issue) => issue.id === selectedIssueId)) ?? null
        : null,
    [selectedIssueId, jiraIssues],
  )

  const quickFilterBadges = useMemo(() => jiraIssues?.quickFilters?.badges ?? [], [jiraIssues])

  const activeQuickFilterBadge = useMemo(
    () => (activeQuickFilterBadgeId ? quickFilterBadges.find((badge) => badge.id === activeQuickFilterBadgeId) ?? null : null),
    [quickFilterBadges, activeQuickFilterBadgeId],
  )

  const visibleJiraGroups = useMemo(() => {
    if (!jiraIssues) {
      return []
    }

    if (!activeQuickFilterBadge) {
      return jiraIssues.groups
    }

    const targetFieldId = normalizeEditorFieldId(activeQuickFilterBadge.fieldId)
    const targetValue = activeQuickFilterBadge.value.trim().toLowerCase()
    if (!targetFieldId || !targetValue) {
      return jiraIssues.groups
    }

    return jiraIssues.groups
      .map((group) => ({
        ...group,
        issues: group.issues.filter((issue) => {
          const candidateField = issue.fields.find((field) => normalizeEditorFieldId(field.id) === targetFieldId)
          if (!candidateField) {
            return false
          }
          return extractQuickFilterValues(candidateField.value).includes(targetValue)
        }),
      }))
      .filter((group) => group.issues.length > 0)
  }, [jiraIssues, activeQuickFilterBadge])

  const visibleIssueOrder = useMemo(
    () => visibleJiraGroups.flatMap((group) => group.issues.map((issue) => issue.id)),
    [visibleJiraGroups],
  )

  const orchestratorParticipant = useMemo(
    () =>
      roomState.orchestratorId
        ? roomState.participants.find((participant) => participant.id === roomState.orchestratorId) ?? null
        : null,
    [roomState.orchestratorId, roomState.participants],
  )

  const followedFieldTargetId =
    canFollowCurrentOrchestrator() && isFollowingOrchestrator && selectedIssueId && roomState.orchestratorView.issueId === selectedIssueId
      ? roomState.orchestratorView.targetId
      : null

  const selectedIssueRawData = selectedIssueId
    ? JSON.stringify(
        {
          issueId: selectedIssueId,
          jiraIssue: selectedIssueFromJira,
          jiraGroup: selectedIssueGroup
            ? {
                id: selectedIssueGroup.id,
                name: selectedIssueGroup.name,
                category: selectedIssueGroup.category,
                sprint: selectedIssueGroup.sprint,
              }
            : null,
          sharedDraft: selectedIssueDraft,
          workspacePresence: roomState.issueWorkspace.presence.filter((entry) => entry.issueId === selectedIssueId),
        },
        null,
        2,
      )
    : ''

  const selectedIssueCrdtSync =
    selectedIssueId && selectedIssueDraft ? selectedIssueDraft.fields.map((field) => getIssueFieldSyncState(selectedIssueId, field)) : []
  const selectedIssueCrdtSyncedCount = selectedIssueCrdtSync.filter((entry) => entry.synced).length

  const selectedIssueKey = selectedIssueDraft?.issueKey || selectedIssueFromJira?.key || ''
  const canManageRoom = roomState.orchestratorId === null || roomState.orchestratorId === roomState.myId
  const canEditSelectedIssue =
    !selectedIssueId ||
    canManageRoom ||
    roomState.settings.allowParticipantEditingOutsideFocus ||
    selectedIssueId === roomState.issueWorkspace.selectedIssueId

  return (
    <main style={{ background: 'var(--color-bg)' }}>
      {!isConnected ? (
        <JoinView
          nameInput={nameInput}
          isConnecting={isConnecting}
          isSocketConnected={isSocketConnected}
          connectionMessage={connectionMessage}
          onNameChange={handleNameInput}
          onSubmit={connect}
        />
      ) : (
        <div
          className="planning-layout"
          onWheelCapture={(event) => {
            if (!isConnected || !middleScrollRef.current || event.ctrlKey) {
              return
            }

            const target = event.target as Node | null
            if (target && jiraListScrollRef.current?.contains(target)) {
              return
            }

            if (!isCurrentUserOrchestrator() && canFollowCurrentOrchestrator() && isFollowingOrchestrator) {
              isFollowingOrchestratorRef.current = false
              setIsFollowingOrchestrator(false)
              syncOrchestratorFollowState(true)
            }

            event.preventDefault()
            middleScrollRef.current.scrollBy({ top: event.deltaY })
          }}
        >
          {/* Left sidebar: Jira tickets */}
          <section className="planning-sidebar">
            <JiraTicketList
              jiraIssues={jiraIssues}
              visibleJiraGroups={visibleJiraGroups}
              selectedIssueId={selectedIssueId}
              jiraError={jiraError}
              jiraMessage={jiraMessage}
              quickFilterBadges={quickFilterBadges}
              activeQuickFilterBadgeId={activeQuickFilterBadgeId}
              activeQuickFilterBadge={activeQuickFilterBadge}
              onSelectIssue={selectIssue}
              onSetQuickFilter={setActiveQuickFilterBadgeId}
              jiraListScrollRef={(node) => {
                jiraListScrollRef.current = node
              }}
            />
          </section>

          {/* Center: Ticket workspace */}
          <section
            className="planning-main"
            ref={(node) => {
              middleScrollRef.current = node
            }}
            onScroll={handleMiddleScroll}
          >
            <TicketWorkspace
              selectedIssueId={selectedIssueId}
              selectedIssueKey={selectedIssueKey}
              selectedIssueDraft={selectedIssueDraft}
              selectedIssueSubtasks={selectedIssueSubtasks}
              descriptionSyncState={descriptionSyncState}
              selectedIssueFromJira={selectedIssueFromJira}
              visibleIssueFields={visibleIssueFields}
              votedCount={votedCount}
              totalCount={totalCount}
              revealed={roomState.revealed}
              isRawTicketDataOpen={isRawTicketDataOpen}
              isCrdtDebugOpen={isCrdtDebugOpen}
              selectedIssueRawData={selectedIssueRawData}
              selectedIssueCrdtSync={selectedIssueCrdtSync}
              selectedIssueCrdtSyncedCount={selectedIssueCrdtSyncedCount}
              orchestratorColorHue={orchestratorParticipant?.colorHue ?? 210}
              followedFieldTargetId={followedFieldTargetId}
              newSubtaskTitle={newSubtaskTitle}
              canEditSelectedIssue={canEditSelectedIssue}
              onToggleRawData={() => setIsRawTicketDataOpen((value) => !value)}
              onToggleCrdtDebug={() => setIsCrdtDebugOpen((value) => !value)}
              onFieldInput={(issueId, issueKey, issueUrl, field, value) => {
                send({
                  type: 'set_issue_field',
                  issueId,
                  issueKey,
                  issueUrl,
                  field: { id: field.id, label: field.label, value },
                })
              }}
              onFieldFocus={handleIssueFieldFocus}
              onFieldBlur={handleIssueFieldBlur}
              onFieldActivity={() => registerParticipantActivity()}
              onNewSubtaskTitleChange={setNewSubtaskTitle}
              onAddSubtask={addIssueSubtask}
              onUpdateSubtask={updateIssueSubtask}
              onRemoveSubtask={removeIssueSubtask}
              getPresenceLabelForTarget={getPresenceLabelForTarget}
              isTargetEditedByOthers={isTargetEditedByOthers}
              getIssueFieldYText={getIssueFieldYText}
              shouldUseMarkdownEditor={shouldUseMarkdownEditor}
              fieldPresenceTargetId={fieldPresenceTargetId}
              ticketWorkspaceRef={(node) => {
                ticketWorkspaceRef.current = node
              }}
            />
          </section>

          {/* Right panel: Participants & voting */}
          <section className="planning-panel">
            <ParticipantsPanel
              participants={participantsForDisplay}
              myId={roomState.myId}
              orchestratorId={roomState.orchestratorId}
              revealed={roomState.revealed}
              myVote={roomState.myVote}
              canReveal={canReveal}
              canManageRoom={canManageRoom}
              isFollowingOrchestrator={isFollowingOrchestrator}
              canFollowOrchestrator={canFollowCurrentOrchestrator()}
              roomSettings={roomState.settings}
              isProfileEditing={isProfileEditing}
              nameInput={nameInput}
              joinedName={joinedName}
              isConnected={isConnected}
              orchestratorParticipant={orchestratorParticipant}
              revealBuckets={revealBuckets}
              participantNameInputRef={participantNameInputRef}
              onRevealOrNext={revealOrNextTicket}
              onToggleAllowEditingOutsideFocus={(nextValue) => {
                send({
                  type: 'set_room_settings',
                  settings: { allowParticipantEditingOutsideFocus: nextValue },
                })
              }}
              onVote={setVote}
              onRequestNewColor={requestNewColor}
              onFollowOrchestrator={followOrchestrator}
              onStartEditing={() => {
                if (!isConnected) return
                setNameInput(joinedName)
                setIsProfileEditing(true)
                setConnectionMessage('')
              }}
              onStopEditing={() => {
                setIsProfileEditing(false)
                window.clearTimeout(profileSyncTimerRef.current)
              }}
              onNameChange={handleNameInput}
              onNameSubmit={() => commitProfileName(true)}
              onNameCancel={() => setNameInput(joinedName)}
            />
          </section>
        </div>
      )}

      {connectionMessage && !isConnected ? null : connectionMessage ? (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-4 py-2 text-sm shadow-md"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {connectionMessage}
        </div>
      ) : null}
    </main>
  )
}
