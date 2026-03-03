<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    ESTIMATE_OPTIONS,
    type ClientEvent,
    type EstimateOption,
    type IssueDraftSnapshot,
    type IssueEditorField,
    type IssueSubtask,
    type JiraIssue,
    type JiraIssueField,
    type JiraIssueCategory,
    type JiraIssueGroup,
    type JiraIssueResult,
    type JiraSprint,
    type RoomStateSnapshot,
    type ServerEvent,
  } from './lib/protocol'

  type JiraConfig = {
    baseUrl: string
    email: string
    apiToken: string
    ticketPrefix: string
  }

  const STORAGE_KEY = 'scrummer.display_name'
  const JIRA_STORAGE_KEY = 'scrummer.jira_config'

  const createEmptyIssueWorkspace = (): RoomStateSnapshot['issueWorkspace'] => ({
    selectedIssueId: null,
    drafts: [],
    presence: [],
  })

  const createEmptyState = (): RoomStateSnapshot => ({
    revealed: false,
    myId: '',
    myVote: null,
    participants: [],
    issueWorkspace: createEmptyIssueWorkspace(),
    jiraIssues: null,
  })

  const createDefaultJiraConfig = (): JiraConfig => ({
    baseUrl: '',
    email: '',
    apiToken: '',
    ticketPrefix: '',
  })

  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

  const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '')

  const normalizeTicketPrefix = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20)

  let roomState: RoomStateSnapshot = createEmptyState()
  let jiraConfig: JiraConfig = createDefaultJiraConfig()
  let jiraIssues: JiraIssueResult | null = null
  let jiraError = ''
  let jiraMessage = ''
  let nameInput = ''
  let joinedName = ''
  let connectionMessage = ''
  let isConnected = false
  let isConnecting = false
  let isProfileEditing = false
  let isJiraLoading = false
  let isJiraConfigCollapsed = false
  let hasAutoCollapsedJiraConfig = false
  let socket: WebSocket | null = null
  let profileSyncTimer: number | undefined
  let jiraRequestCounter = 0
  let ticketWorkspaceElement: HTMLElement | null = null
  let middleScrollElement: HTMLElement | null = null
  let jiraListScrollElement: HTMLElement | null = null
  let participantNameInputElement: HTMLInputElement | null = null
  let isRawTicketDataOpen = false
  let rawTicketDataIssueId: string | null = null

  const socketUrl = (): string => {
    const configuredUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.trim()
    if (configuredUrl) {
      return configuredUrl
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.hostname}:3001/ws`
  }

  const apiBaseUrl = (): string => {
    const configuredUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
    if (configuredUrl) {
      return configuredUrl.replace(/\/$/, '')
    }

    return `${window.location.protocol}//${window.location.hostname}:3001`
  }

  const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').slice(0, 40)

  const saveNameLocally = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed) {
      window.localStorage.setItem(STORAGE_KEY, name.slice(0, 40))
      return
    }

    window.localStorage.removeItem(STORAGE_KEY)
  }

  const saveJiraConfigLocally = (): void => {
    const normalized = {
      ...jiraConfig,
      baseUrl: jiraConfig.baseUrl.trim(),
      email: jiraConfig.email.trim(),
      apiToken: jiraConfig.apiToken.trim(),
      ticketPrefix: normalizeTicketPrefix(jiraConfig.ticketPrefix),
    }

    const hasAnyValue =
      normalized.baseUrl !== '' || normalized.email !== '' || normalized.apiToken !== '' || normalized.ticketPrefix !== ''

    if (!hasAnyValue) {
      window.localStorage.removeItem(JIRA_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(JIRA_STORAGE_KEY, JSON.stringify(normalized))
  }

  const readStoredName = (): boolean => {
    const storedName = window.localStorage.getItem(STORAGE_KEY)
    if (!storedName) {
      return false
    }

    const normalized = normalizeName(storedName)
    if (!normalized) {
      window.localStorage.removeItem(STORAGE_KEY)
      return false
    }

    nameInput = normalized
    saveNameLocally(normalized)
    return true
  }

  const readStoredJiraConfig = (): boolean => {
    const raw = window.localStorage.getItem(JIRA_STORAGE_KEY)
    if (!raw) {
      return false
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed)) {
        return false
      }

      jiraConfig = {
        baseUrl: toStringOrEmpty(parsed.baseUrl).trim(),
        email: toStringOrEmpty(parsed.email).trim(),
        apiToken: toStringOrEmpty(parsed.apiToken).trim(),
        ticketPrefix: normalizeTicketPrefix(toStringOrEmpty(parsed.ticketPrefix) || toStringOrEmpty(parsed.boardId)),
      }

      return (
        jiraConfig.baseUrl !== '' &&
        jiraConfig.email !== '' &&
        jiraConfig.apiToken !== '' &&
        jiraConfig.ticketPrefix !== ''
      )
    } catch {
      return false
    }
  }

  const send = (event: ClientEvent): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    socket.send(JSON.stringify(event))
  }

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

    const parseJiraIssueFields = (fieldPayload: unknown): JiraIssueField[] => {
      if (!Array.isArray(fieldPayload)) {
        return []
      }

      return fieldPayload
        .filter((field): field is Record<string, unknown> => isRecord(field))
        .map((field) => ({
          id: toStringOrEmpty(field.id),
          label: toStringOrEmpty(field.label),
          value: toStringOrEmpty(field.value),
        }))
        .filter((field) => field.id !== '' && field.label !== '' && field.value !== '')
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
        fields: parseJiraIssueFields(issue.fields),
      }))
      .filter((issue) => issue.id !== '' && issue.key !== '' && issue.summary !== '')
  }

  const parseJiraSprint = (payload: unknown): JiraSprint | null => {
    if (!isRecord(payload)) {
      return null
    }

    const id = Number.parseInt(String(payload.id ?? ''), 10)
    if (!Number.isFinite(id) || id <= 0) {
      return null
    }

    return {
      id,
      name: toStringOrEmpty(payload.name) || 'Unnamed sprint',
      state: toStringOrEmpty(payload.state) || 'unknown',
      startDate: typeof payload.startDate === 'string' ? payload.startDate : null,
      endDate: typeof payload.endDate === 'string' ? payload.endDate : null,
      completeDate: typeof payload.completeDate === 'string' ? payload.completeDate : null,
    }
  }

  const parseJiraIssueCategory = (payload: unknown): JiraIssueCategory | null => {
    if (payload === 'current' || payload === 'future' || payload === 'backlog') {
      return payload
    }

    return null
  }

  const parseJiraIssueGroup = (payload: unknown): JiraIssueGroup | null => {
    if (!isRecord(payload)) {
      return null
    }

    const category = parseJiraIssueCategory(payload.category)
    const issues = parseJiraIssueList(payload.issues)
    if (!category || !issues) {
      return null
    }

    const fallbackName = category === 'backlog' ? 'Backlog / No sprint' : category === 'current' ? 'Current sprint' : 'Future sprint'
    const name = toStringOrEmpty(payload.name) || fallbackName
    const id = toStringOrEmpty(payload.id) || `${category}-${name}`

    return {
      id,
      name,
      category,
      sprint: parseJiraSprint(payload.sprint),
      issues,
    }
  }

  const parseJiraIssueResult = (payload: unknown): JiraIssueResult | null => {
    if (!isRecord(payload)) {
      return null
    }

    if (!Array.isArray(payload.groups)) {
      return null
    }

    const groups = payload.groups.map(parseJiraIssueGroup).filter((group): group is JiraIssueGroup => group !== null)
    if (groups.length !== payload.groups.length) {
      return null
    }

    return {
      groups,
    }
  }

  const formatJiraIssueCount = (count: number): string => `${count} issue${count === 1 ? '' : 's'}`

  const jiraCategoryLabel = (category: JiraIssueCategory): string => {
    if (category === 'current') {
      return 'Current sprint'
    }
    if (category === 'future') {
      return 'Future sprint'
    }

    return 'Backlog'
  }

  const normalizeEditorFieldId = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80)

  const normalizeEditorText = (value: string, maxLength = 16000): string => value.replace(/\r\n/g, '\n').slice(0, maxLength)

  const normalizePresenceTargetId = (value: string): string =>
    value.trim().toLowerCase().replace(/[^a-z0-9:._-]/g, '_').slice(0, 120)

  const fieldPresenceTargetId = (fieldId: string): string => normalizePresenceTargetId(`field:${normalizeEditorFieldId(fieldId)}`)

  const subtaskPresenceTargetId = (subtaskId: string, section: 'title' | 'description'): string =>
    normalizePresenceTargetId(`subtask:${subtaskId}:${section}`)

  const createEditorField = (id: string, label: string, value: string): IssueEditorField => ({
    id: normalizeEditorFieldId(id),
    label: label.trim().slice(0, 80),
    value: normalizeEditorText(value),
  })

  const buildIssueEditorFields = (issue: JiraIssue, sprintName: string): IssueEditorField[] => {
    const fields: IssueEditorField[] = [
      ...issue.fields.map((field) => createEditorField(field.id, field.label, field.value)),
      createEditorField('sprint', 'Sprint', sprintName),
      createEditorField('planning_notes', 'Planning Notes', ''),
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

  const getFieldValue = (draft: IssueDraftSnapshot | null, fieldId: string): string => {
    if (!draft) {
      return ''
    }

    const normalizedFieldId = normalizeEditorFieldId(fieldId)
    return draft.fields.find((field) => field.id === normalizedFieldId)?.value ?? ''
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

  const selectIssue = (issue: JiraIssue, group: JiraIssueGroup): void => {
    ticketWorkspaceElement?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    releaseAllIssuePresence()
    const sprintName = group.sprint?.name ?? group.name
    send({
      type: 'select_issue',
      issueId: issue.id,
      issueKey: issue.key,
      issueUrl: issue.url,
      fields: buildIssueEditorFields(issue, sprintName),
    })
  }

  const selectedIssueIdentity = (): { issueId: string; issueKey: string; issueUrl: string } | null => {
    const issueId = roomState.issueWorkspace.selectedIssueId
    if (!issueId) {
      return null
    }

    const draft = roomState.issueWorkspace.drafts.find((entry) => entry.issueId === issueId) ?? null
    const issue = jiraIssues
      ? jiraIssues.groups.flatMap((group) => group.issues).find((entry) => entry.id === issueId) ?? null
      : null

    const issueKey = draft?.issueKey || issue?.key || ''
    const issueUrl = draft?.issueUrl || issue?.url || ''
    if (!issueKey) {
      return null
    }

    return {
      issueId,
      issueKey,
      issueUrl,
    }
  }

  let activePresenceIssueId: string | null = null
  const activePresenceTargets = new Set<string>()

  const releaseAllIssuePresence = (): void => {
    if (!activePresenceIssueId || activePresenceTargets.size === 0) {
      activePresenceIssueId = null
      activePresenceTargets.clear()
      return
    }

    const issueId = activePresenceIssueId
    const targets = [...activePresenceTargets]
    activePresenceIssueId = null
    activePresenceTargets.clear()

    for (const targetId of targets) {
      send({
        type: 'set_issue_presence',
        issueId,
        targetId,
        active: false,
      })
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
      if (activePresenceIssueId && activePresenceIssueId !== identity.issueId) {
        releaseAllIssuePresence()
      }

      if (activePresenceIssueId === identity.issueId && activePresenceTargets.has(normalizedTargetId)) {
        return
      }

      activePresenceIssueId = identity.issueId
      activePresenceTargets.add(normalizedTargetId)
    } else {
      if (activePresenceIssueId !== identity.issueId || !activePresenceTargets.has(normalizedTargetId)) {
        return
      }

      activePresenceTargets.delete(normalizedTargetId)
      if (activePresenceTargets.size === 0) {
        activePresenceIssueId = null
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
      roomState.issueWorkspace.presence.find((entry) => entry.issueId === selectedIssueId && entry.targetId === normalizedTargetId) ??
      null
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

  const setIssueField = (field: IssueEditorField, value: string): void => {
    const identity = selectedIssueIdentity()
    if (!identity) {
      return
    }

    send({
      type: 'set_issue_field',
      issueId: identity.issueId,
      issueKey: identity.issueKey,
      issueUrl: identity.issueUrl,
      field: {
        id: normalizeEditorFieldId(field.id),
        label: field.label,
        value: normalizeEditorText(value),
      },
    })
  }

  let newSubtaskTitle = ''

  const addIssueSubtask = (): void => {
    const identity = selectedIssueIdentity()
    if (!identity) {
      return
    }

    const title = normalizeEditorText(newSubtaskTitle, 240).trim()
    if (!title) {
      return
    }

    send({
      type: 'add_issue_subtask',
      issueId: identity.issueId,
      issueKey: identity.issueKey,
      issueUrl: identity.issueUrl,
      title,
    })
    newSubtaskTitle = ''
  }

  const updateIssueSubtaskTitle = (subtask: IssueSubtask, value: string): void => {
    const issueId = roomState.issueWorkspace.selectedIssueId
    if (!issueId) {
      return
    }

    send({
      type: 'update_issue_subtask',
      issueId,
      subtaskId: subtask.id,
      title: normalizeEditorText(value, 240),
    })
  }

  const updateIssueSubtaskDescription = (subtask: IssueSubtask, value: string): void => {
    const issueId = roomState.issueWorkspace.selectedIssueId
    if (!issueId) {
      return
    }

    send({
      type: 'update_issue_subtask',
      issueId,
      subtaskId: subtask.id,
      description: normalizeEditorText(value),
    })
  }

  const toggleIssueSubtaskDone = (subtask: IssueSubtask, done: boolean): void => {
    const issueId = roomState.issueWorkspace.selectedIssueId
    if (!issueId) {
      return
    }

    send({
      type: 'update_issue_subtask',
      issueId,
      subtaskId: subtask.id,
      done,
    })
  }

  const removeIssueSubtask = (subtask: IssueSubtask): void => {
    const issueId = roomState.issueWorkspace.selectedIssueId
    if (!issueId) {
      return
    }

    setIssuePresence(subtaskPresenceTargetId(subtask.id, 'title'), false)
    setIssuePresence(subtaskPresenceTargetId(subtask.id, 'description'), false)

    send({
      type: 'remove_issue_subtask',
      issueId,
      subtaskId: subtask.id,
    })
  }

  const normalizeJiraConfig = (): JiraConfig => ({
    baseUrl: jiraConfig.baseUrl.trim(),
    email: jiraConfig.email.trim(),
    apiToken: jiraConfig.apiToken.trim(),
    ticketPrefix: normalizeTicketPrefix(jiraConfig.ticketPrefix),
  })

  const loadJiraIssues = async (): Promise<void> => {
    const normalized = normalizeJiraConfig()
    jiraConfig = normalized
    saveJiraConfigLocally()

    if (!normalized.baseUrl || !normalized.email || !normalized.apiToken || !normalized.ticketPrefix) {
      jiraError = 'Add Jira URL, email, API token, and ticket prefix first.'
      jiraMessage = ''
      return
    }

    const requestId = ++jiraRequestCounter
    isJiraLoading = true
    jiraError = ''
    jiraMessage = ''

    try {
      const response = await fetch(`${apiBaseUrl()}/api/jira/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(normalized),
      })

      const payload = (await response.json().catch(() => null)) as unknown
      if (requestId !== jiraRequestCounter) {
        return
      }

      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'Failed to load Jira tickets.'
        jiraError = message
        jiraMessage = ''
        return
      }

      const result = parseJiraIssueResult(payload)
      if (!result) {
        jiraError = 'Received an unexpected Jira response.'
        jiraMessage = ''
        return
      }

      jiraIssues = result
      jiraError = ''
      const total = result.groups.reduce((count, group) => count + group.issues.length, 0)
      jiraMessage =
        total > 0
          ? `Loaded ${total} tickets grouped into ${result.groups.length} sprint buckets.`
          : 'No Jira tickets found for current/future sprints or backlog.'
    } catch {
      if (requestId !== jiraRequestCounter) {
        return
      }

      jiraError = 'Could not reach the backend Jira endpoint.'
      jiraMessage = ''
    } finally {
      if (requestId === jiraRequestCounter) {
        isJiraLoading = false
      }
    }
  }

  const clearJiraConfig = (): void => {
    jiraConfig = createDefaultJiraConfig()
    jiraError = ''
    jiraMessage = ''
    window.localStorage.removeItem(JIRA_STORAGE_KEY)
  }

  const handleJiraConfigInput = (): void => {
    jiraConfig.ticketPrefix = normalizeTicketPrefix(jiraConfig.ticketPrefix)
    saveJiraConfigLocally()
  }

  const commitProfileName = (showError: boolean): void => {
    const normalizedName = normalizeName(nameInput)
    if (!normalizedName) {
      if (showError) {
        connectionMessage = 'Display name cannot be empty.'
      }

      nameInput = joinedName
      return
    }

    nameInput = normalizedName
    saveNameLocally(normalizedName)

    if (!isConnected || normalizedName === joinedName) {
      return
    }

    joinedName = normalizedName
    send({ type: 'update_name', name: normalizedName })
  }

  const scheduleProfileNameSync = (): void => {
    if (!isConnected) {
      return
    }

    window.clearTimeout(profileSyncTimer)
    profileSyncTimer = window.setTimeout(() => {
      commitProfileName(false)
    }, 320)
  }

  const connect = (): void => {
    if (isConnecting || isConnected) {
      return
    }

    const normalizedName = normalizeName(nameInput)
    if (!normalizedName) {
      connectionMessage = 'Enter a display name to join.'
      return
    }

    nameInput = normalizedName
    joinedName = normalizedName
    connectionMessage = ''
    saveNameLocally(normalizedName)
    isConnecting = true

    const nextSocket = new WebSocket(socketUrl())
    socket = nextSocket

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) {
        return
      }

      isConnecting = false
      isConnected = true
      send({ type: 'join', name: normalizedName })
    })

    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket || typeof event.data !== 'string') {
        return
      }

      const serverEvent = parseServerEvent(event.data)
      if (!serverEvent) {
        connectionMessage = 'Received an invalid update from the server.'
        return
      }

      if (serverEvent.type === 'state_snapshot') {
        roomState = serverEvent.state
        jiraIssues = serverEvent.state.jiraIssues
        const me = roomState.participants.find((participant) => participant.id === roomState.myId)
        if (me) {
          joinedName = me.name
          if (!isProfileEditing) {
            nameInput = me.name
          }
        }

        return
      }

      connectionMessage = serverEvent.message
    })

    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) {
        return
      }

      releaseAllIssuePresence()
      socket = null
      isConnected = false
      isConnecting = false
      joinedName = ''
      roomState = createEmptyState()
      jiraIssues = null
      connectionMessage = 'Connection closed. Rejoin to continue planning.'
    })

    nextSocket.addEventListener('error', () => {
      if (socket !== nextSocket) {
        return
      }

      connectionMessage = 'Could not connect to the planning server.'
    })
  }

  const handleNameInput = (): void => {
    nameInput = nameInput.slice(0, 40)
    saveNameLocally(nameInput)
    scheduleProfileNameSync()
  }

  const submitJoin = (event: SubmitEvent): void => {
    event.preventDefault()
    connect()
  }

  const handleProfileBlur = (): void => {
    isProfileEditing = false
    window.clearTimeout(profileSyncTimer)
    if (!isConnected) {
      return
    }

    commitProfileName(true)
  }

  const handleProfileKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      nameInput = joinedName
      ;(event.currentTarget as HTMLInputElement).blur()
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    if (!isConnected) {
      return
    }

    window.clearTimeout(profileSyncTimer)
    commitProfileName(true)
    ;(event.currentTarget as HTMLInputElement).blur()
  }

  const startInlineProfileEdit = (): void => {
    if (!isConnected) {
      return
    }

    nameInput = joinedName
    isProfileEditing = true
    connectionMessage = ''
  }

  $: if (isProfileEditing) {
    void tick().then(() => participantNameInputElement?.focus())
  }

  const setVote = (option: EstimateOption): void => {
    const nextVote = roomState.myVote === option ? null : option
    send({ type: 'set_vote', vote: nextVote })
  }

  const revealOrNextTicket = (): void => {
    if (roomState.revealed) {
      send({ type: 'next_ticket' })
      return
    }

    send({ type: 'reveal' })
  }

  const requestNewColor = (): void => {
    if (!isConnected) {
      return
    }

    send({ type: 'reroll_color' })
  }

  const handleAppWheel = (event: WheelEvent): void => {
    if (!isConnected || !middleScrollElement || event.ctrlKey) {
      return
    }

    const target = event.target as Node | null
    if (target && jiraListScrollElement?.contains(target)) {
      return
    }

    event.preventDefault()
    middleScrollElement.scrollBy({ top: event.deltaY })
  }

  onMount(() => {
    const hasStoredName = readStoredName()
    const hasStoredJiraConnection = readStoredJiraConfig()

    if (hasStoredName) {
      connect()
    }

    if (hasStoredJiraConnection) {
      void loadJiraIssues()
    }
  })

  onDestroy(() => {
    window.clearTimeout(profileSyncTimer)
    releaseAllIssuePresence()
    socket?.close()
  })

  $: votedCount = roomState.participants.filter((participant) => participant.hasVoted).length
  $: totalCount = roomState.participants.length
  $: canReveal = votedCount > 0
  $: revealBuckets = ESTIMATE_OPTIONS.map((estimate) => ({
    estimate,
    voters: roomState.participants.filter((participant) => participant.vote === estimate),
  })).filter((bucket) => bucket.voters.length > 0)
  $: selectedIssueId = roomState.issueWorkspace.selectedIssueId
  $: if (activePresenceIssueId && selectedIssueId !== activePresenceIssueId) {
    releaseAllIssuePresence()
  }
  $: selectedIssueDraft = selectedIssueId
    ? roomState.issueWorkspace.drafts.find((draft) => draft.issueId === selectedIssueId) ?? null
    : null
  $: selectedIssueFromJira = selectedIssueId && jiraIssues
    ? jiraIssues.groups.flatMap((group) => group.issues).find((issue) => issue.id === selectedIssueId) ?? null
    : null
  $: selectedIssueGroup = selectedIssueId && jiraIssues
    ? jiraIssues.groups.find((group) => group.issues.some((issue) => issue.id === selectedIssueId)) ?? null
    : null
  $: if (selectedIssueId !== rawTicketDataIssueId) {
    isRawTicketDataOpen = false
    rawTicketDataIssueId = selectedIssueId
  }
  $: selectedIssueRawData = selectedIssueId
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
  $: loadedJiraTicketCount = jiraIssues ? jiraIssues.groups.reduce((count, group) => count + group.issues.length, 0) : 0
  $: if (loadedJiraTicketCount > 0 && !hasAutoCollapsedJiraConfig) {
    isJiraConfigCollapsed = true
    hasAutoCollapsedJiraConfig = true
  }
  $: if (loadedJiraTicketCount === 0) {
    isJiraConfigCollapsed = false
    hasAutoCollapsedJiraConfig = false
  }
  $: selectedIssueKey = selectedIssueDraft?.issueKey || selectedIssueFromJira?.key || ''
  $: selectedIssueUrl = selectedIssueDraft?.issueUrl || selectedIssueFromJira?.url || ''
  $: selectedIssueSummary = getFieldValue(selectedIssueDraft, 'summary') || selectedIssueFromJira?.summary || '(no summary)'
  $: selectedIssueStatus = getFieldValue(selectedIssueDraft, 'status') || selectedIssueFromJira?.status || 'Unknown'
  $: selectedIssuePriority = getFieldValue(selectedIssueDraft, 'priority') || selectedIssueFromJira?.priority || 'Unspecified'
  $: selectedIssueAssignee = getFieldValue(selectedIssueDraft, 'assignee') || selectedIssueFromJira?.assignee || 'Unassigned'
  $: selectedIssueType = getFieldValue(selectedIssueDraft, 'issue_type') || selectedIssueFromJira?.issueType || 'Issue'
  $: selectedIssueReporter = getFieldValue(selectedIssueDraft, 'reporter') || selectedIssueFromJira?.reporter || 'Unknown'
  $: selectedIssueUpdatedAt = selectedIssueDraft ? formatTimestamp(selectedIssueDraft.updatedAt) : ''
  $: selectedIssueUpdatedBy = selectedIssueDraft?.updatedBy
    ? roomState.participants.find((participant) => participant.id === selectedIssueDraft.updatedBy)?.name ?? 'Someone'
    : ''
</script>

<main class="app-shell" class:connected={isConnected} on:wheel|nonpassive={handleAppWheel}>
  <header class="topbar">
    <div class="brand">
      <p class="eyebrow">Single Room Scrum Poker</p>
      <h1>Scrummer</h1>
    </div>
  </header>

  {#if !isConnected}
    <section class="join-view panel">
      <h2>Join planning room</h2>
      <p>Enter your name and join. Returning users connect automatically.</p>
      <form class="join-form" on:submit={submitJoin}>
        <label for="join-display-name">Display name</label>
        <input
          id="join-display-name"
          maxlength="40"
          bind:value={nameInput}
          placeholder="Your display name"
          autocomplete="name"
          on:input={handleNameInput}
        />
        <button type="submit" class="primary" disabled={isConnecting}>
          {isConnecting ? 'Connecting...' : 'Join'}
        </button>
      </form>
    </section>
  {:else}
    <section class="workspace">
      <div class="middle-scroll" bind:this={middleScrollElement}>
        <section class="panel summary issue-editor" bind:this={ticketWorkspaceElement}>
          <div class="panel-heading">
            <h2>Ticket Workspace</h2>
            <p>{votedCount} of {totalCount} participants have voted.</p>
          </div>

        {#if selectedIssueId}
          <div class="issue-header">
            <div>
              <strong>{selectedIssueKey}</strong>
              <p>{selectedIssueSummary}</p>
            </div>
            <div class="issue-header-actions">
              <button type="button" class="text-button compact" on:click={() => (isRawTicketDataOpen = !isRawTicketDataOpen)}>
                {isRawTicketDataOpen ? 'Hide raw data' : 'View raw data'}
              </button>
              {#if selectedIssueUrl}
                <a href={selectedIssueUrl} target="_blank" rel="noreferrer">Open in Jira</a>
              {/if}
            </div>
          </div>

          <div class="issue-meta">
            <span>{selectedIssueType}</span>
            <span>Status: {selectedIssueStatus}</span>
            <span>Priority: {selectedIssuePriority}</span>
            <span>Assignee: {selectedIssueAssignee}</span>
            <span>Reporter: {selectedIssueReporter}</span>
          </div>

          {#if isRawTicketDataOpen}
            <section class="raw-ticket-data">
              <h3>Raw ticket data</h3>
              <pre>{selectedIssueRawData}</pre>
            </section>
          {/if}

          {#if selectedIssueDraft}
            <div class="issue-fields">
              {#each selectedIssueDraft.fields as field (field.id)}
                {@const fieldPresenceTarget = fieldPresenceTargetId(field.id)}
                {@const fieldPresenceLabel = getPresenceLabelForTarget(fieldPresenceTarget)}
                <div class="issue-field" class:busy={isTargetEditedByOthers(fieldPresenceTarget)}>
                  <label for={`issue-field-${field.id}`}>{field.label}</label>
                  {#if fieldPresenceLabel}
                    <p class="presence-indicator" class:others={isTargetEditedByOthers(fieldPresenceTarget)}>{fieldPresenceLabel}</p>
                  {/if}
                  <textarea
                    id={`issue-field-${field.id}`}
                    rows={field.id === 'description' ? 6 : 3}
                    value={field.value}
                    on:focus={() => setIssuePresence(fieldPresenceTarget, true)}
                    on:blur={() => setIssuePresence(fieldPresenceTarget, false)}
                    on:input={(event) => setIssueField(field, (event.currentTarget as HTMLTextAreaElement).value)}
                  ></textarea>
                </div>
              {/each}
            </div>
          {:else}
            <p class="jira-empty">Issue details are loading into the shared workspace.</p>
          {/if}

          <section class="subtasks">
            <div class="subtasks-header">
              <h3>Subtasks</h3>
              <div class="subtask-add">
                <input
                  value={newSubtaskTitle}
                  placeholder="Add subtask title"
                  on:input={(event) => (newSubtaskTitle = (event.currentTarget as HTMLInputElement).value)}
                  on:keydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addIssueSubtask()
                    }
                  }}
                />
                <button type="button" class="secondary" on:click={addIssueSubtask}>Add</button>
              </div>
            </div>

            {#if selectedIssueDraft && selectedIssueDraft.subtasks.length > 0}
              <ul class="subtask-list">
                {#each selectedIssueDraft.subtasks as subtask (subtask.id)}
                  {@const subtaskTitlePresenceTarget = subtaskPresenceTargetId(subtask.id, 'title')}
                  {@const subtaskDescriptionPresenceTarget = subtaskPresenceTargetId(subtask.id, 'description')}
                  {@const subtaskTitlePresenceLabel = getPresenceLabelForTarget(subtaskTitlePresenceTarget)}
                  {@const subtaskDescriptionPresenceLabel = getPresenceLabelForTarget(subtaskDescriptionPresenceTarget)}
                  <li>
                    <div class="subtask-row">
                      <label class="subtask-done-toggle">
                        <input
                          type="checkbox"
                          checked={subtask.done}
                          on:change={(event) =>
                            toggleIssueSubtaskDone(subtask, (event.currentTarget as HTMLInputElement).checked)}
                        />
                        Done
                      </label>
                      <button type="button" class="text-button compact" on:click={() => removeIssueSubtask(subtask)}>
                        Remove
                      </button>
                    </div>

                    <input
                      class:busy={isTargetEditedByOthers(subtaskTitlePresenceTarget)}
                      value={subtask.title}
                      placeholder="Subtask title"
                      on:focus={() => setIssuePresence(subtaskTitlePresenceTarget, true)}
                      on:blur={() => setIssuePresence(subtaskTitlePresenceTarget, false)}
                      on:input={(event) => updateIssueSubtaskTitle(subtask, (event.currentTarget as HTMLInputElement).value)}
                    />
                    {#if subtaskTitlePresenceLabel}
                      <p class="presence-indicator subtask" class:others={isTargetEditedByOthers(subtaskTitlePresenceTarget)}>
                        {subtaskTitlePresenceLabel}
                      </p>
                    {/if}

                    <textarea
                      class:busy={isTargetEditedByOthers(subtaskDescriptionPresenceTarget)}
                      rows="3"
                      value={subtask.description}
                      placeholder="Subtask description"
                      on:focus={() => setIssuePresence(subtaskDescriptionPresenceTarget, true)}
                      on:blur={() => setIssuePresence(subtaskDescriptionPresenceTarget, false)}
                      on:input={(event) =>
                        updateIssueSubtaskDescription(subtask, (event.currentTarget as HTMLTextAreaElement).value)}
                    ></textarea>
                    {#if subtaskDescriptionPresenceLabel}
                      <p class="presence-indicator subtask" class:others={isTargetEditedByOthers(subtaskDescriptionPresenceTarget)}>
                        {subtaskDescriptionPresenceLabel}
                      </p>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="jira-empty">No subtasks yet. Add one to break the work down.</p>
            {/if}
          </section>

          {#if selectedIssueUpdatedAt}
            <p class="issue-update-meta">
              Last update {selectedIssueUpdatedAt}
              {#if selectedIssueUpdatedBy}
                {' by ' + selectedIssueUpdatedBy}
              {/if}
              .
            </p>
          {/if}
        {:else}
          <div class="ticket-placeholder">
            <h3>No ticket selected</h3>
            <p>Pick a ticket from the left list to open it in the shared workspace.</p>
          </div>
        {/if}

          <p>
            {#if roomState.revealed}
              Votes are revealed and remain editable until someone selects <strong>Next ticket</strong>.
            {:else}
              Votes stay hidden until any participant reveals.
            {/if}
          </p>
        </section>
      </div>

      <section class="participants">
        <h2>Participants</h2>
        <ul>
          {#each roomState.participants as participant}
            <li class:me={participant.id === roomState.myId} style={`--user-hue: ${participant.colorHue};`}>
              <div class="person">
                {#if participant.id === roomState.myId}
                  <button
                    type="button"
                    class="color-swatch mini"
                    aria-label="Get a new participant color"
                    title="Get a new color"
                    on:click={requestNewColor}
                  ></button>
                  {#if isProfileEditing}
                    <input
                      bind:this={participantNameInputElement}
                      class="participant-name-input"
                      maxlength="40"
                      bind:value={nameInput}
                      aria-label="Edit your display name"
                      autocomplete="name"
                      on:blur={handleProfileBlur}
                      on:keydown={handleProfileKeydown}
                      on:input={handleNameInput}
                    />
                  {:else}
                    <span>{participant.name}</span>
                  {/if}
                {:else}
                  <span class="avatar-dot" aria-hidden="true"></span>
                  <span>{participant.name}</span>
                {/if}
              </div>

              <div class="participant-controls">
                {#if roomState.revealed}
                  <strong>{participant.vote ?? '-'}</strong>
                {:else}
                  <em>{participant.hasVoted ? 'Voted' : 'Waiting'}</em>
                {/if}

                {#if participant.id === roomState.myId && !isProfileEditing}
                  <button
                    type="button"
                    class="edit-name-button"
                    aria-label="Edit your display name"
                    title="Edit your display name"
                    on:click={startInlineProfileEdit}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path
                        d="M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8.2 8.2-3.8.9.9-3.8zM2.5 14.5h11"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      ></path>
                    </svg>
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>

        <section class="participant-vote-panel" aria-label="Estimation options">
          <button
            type="button"
            class="primary participant-action-button"
            on:click={revealOrNextTicket}
            disabled={!roomState.revealed && !canReveal}
          >
            {roomState.revealed ? 'Next ticket' : 'Reveal'}
          </button>

          <div class="participant-vote-grid" role="group" aria-label="Vote cards">
            {#each ESTIMATE_OPTIONS as option}
              <button
                type="button"
                class:selected={roomState.myVote === option}
                class="vote-card participant-vote-card"
                on:click={() => setVote(option)}
              >
                {option}
              </button>
            {/each}
          </div>
        </section>

        {#if roomState.revealed}
          <section class="participant-breakdown">
            <h3>Revealed breakdown</h3>
            <div class="breakdown-grid compact">
              {#each revealBuckets as bucket}
                <article class="estimate-group">
                  <h3>{bucket.estimate}</h3>
                  <div class="badge-list">
                    {#each bucket.voters as voter}
                      <span class="user-badge" style={`--user-hue: ${voter.colorHue};`}>{voter.name}</span>
                    {/each}
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/if}
      </section>

      <section class="jira-panel">
        <div class="panel-heading">
          <h2>Jira Tickets</h2>
          <div class="jira-panel-actions">
            <button
              type="button"
              class="text-button compact"
              on:click={() => (isJiraConfigCollapsed = !isJiraConfigCollapsed)}
            >
              {isJiraConfigCollapsed ? 'Show config' : 'Hide config'}
            </button>
            <button type="button" class="secondary" on:click={() => void loadJiraIssues()} disabled={isJiraLoading}>
              {isJiraLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {#if isJiraConfigCollapsed}
          <p class="jira-config-note">Jira configuration is collapsed while loaded tickets are available.</p>
        {:else}
          <form class="jira-form" on:submit|preventDefault={() => void loadJiraIssues()}>
            <label for="jira-url">Jira URL</label>
            <input
              id="jira-url"
              placeholder="your-team.atlassian.net"
              bind:value={jiraConfig.baseUrl}
              on:input={handleJiraConfigInput}
            />

            <label for="jira-email">Jira account email</label>
            <input
              id="jira-email"
              type="email"
              placeholder="team.member@company.com"
              bind:value={jiraConfig.email}
              on:input={handleJiraConfigInput}
            />

            <label for="jira-token">Jira API token</label>
            <input
              id="jira-token"
              type="password"
              placeholder="Paste API token"
              bind:value={jiraConfig.apiToken}
              on:input={handleJiraConfigInput}
            />

            <label for="jira-ticket-prefix">Ticket prefix</label>
            <input
              id="jira-ticket-prefix"
              placeholder="TEAM"
              bind:value={jiraConfig.ticketPrefix}
              on:input={handleJiraConfigInput}
            />

            <div class="jira-actions">
              <button type="submit" class="secondary" disabled={isJiraLoading}>
                {isJiraLoading ? 'Loading...' : 'Load tickets'}
              </button>
              <button type="button" class="text-button" on:click={clearJiraConfig}>Clear</button>
            </div>
          </form>
        {/if}

        {#if jiraError}
          <p class="jira-error">{jiraError}</p>
        {:else if jiraMessage}
          <p class="jira-message">{jiraMessage}</p>
        {/if}

        <div class="jira-list-scroll" bind:this={jiraListScrollElement}>
          {#if jiraIssues}
            {#if jiraIssues.groups.length > 0}
              <div class="jira-buckets">
                {#each jiraIssues.groups as group (group.id)}
                  <article class="jira-bucket">
                    <h3>
                      {group.name}
                      <span>{jiraCategoryLabel(group.category)} - {formatJiraIssueCount(group.issues.length)}</span>
                    </h3>
                    <ul class="jira-list">
                      {#each group.issues as issue}
                        <li class:selected={selectedIssueId === issue.id}>
                          <button type="button" class="jira-issue-select" on:click={() => selectIssue(issue, group)}>
                            <div class="jira-issue-head">
                              <strong>{issue.key}</strong>
                              <span class="status-badge">{issue.status}</span>
                              {#if issue.isEstimated}
                                <span class="estimated-badge">Estimated</span>
                              {/if}
                            </div>
                            <p>{issue.summary}</p>
                          </button>
                        </li>
                      {/each}
                    </ul>
                  </article>
                {/each}
              </div>
            {:else}
              <p class="jira-empty">No Jira tickets found for current/future sprints or backlog.</p>
            {/if}
          {:else}
            <p class="jira-empty">No Jira tickets loaded yet.</p>
          {/if}
        </div>
      </section>
    </section>

  {/if}

  {#if connectionMessage}
    <p class="message">{connectionMessage}</p>
  {/if}
</main>
