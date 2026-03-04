export const ESTIMATE_OPTIONS = ['0', '1', '2', '3', '5', '8', '13', '20', '?'] as const

export type EstimateOption = (typeof ESTIMATE_OPTIONS)[number]

export type JiraIssueField = {
  id: string
  label: string
  value: string
}

export type JiraIssue = {
  id: string
  key: string
  summary: string
  description: string
  status: string
  assignee: string | null
  priority: string | null
  issueType: string
  reporter: string | null
  createdAt: string | null
  updatedAt: string | null
  url: string
  isEstimated: boolean
  fields: JiraIssueField[]
}

export type JiraSprint = {
  id: number
  name: string
  state: string
  startDate: string | null
  endDate: string | null
  completeDate: string | null
}

export type JiraIssueCategory = 'current' | 'future' | 'backlog'

export type JiraIssueGroup = {
  id: string
  name: string
  category: JiraIssueCategory
  sprint: JiraSprint | null
  issues: JiraIssue[]
}

export type JiraIssueResult = {
  groups: JiraIssueGroup[]
}

export type IssueEditorField = {
  id: string
  label: string
  value: string
}

export type IssueSubtask = {
  id: string
  key: string
  url: string | null
  title: string
  description: string
  done: boolean
}

export type IssueDraftSnapshot = {
  issueId: string
  issueKey: string
  issueUrl: string
  fields: IssueEditorField[]
  subtasks: IssueSubtask[]
  updatedBy: string | null
  updatedAt: string
}

export type IssueFieldCrdtSnapshot = {
  fieldId: string
  label: string
  update: string
}

export type IssuePresenceSnapshot = {
  issueId: string
  targetId: string
  participantIds: string[]
}

export type IssueWorkspaceSnapshot = {
  selectedIssueId: string | null
  drafts: IssueDraftSnapshot[]
  presence: IssuePresenceSnapshot[]
}

export type OrchestratorViewSnapshot = {
  issueId: string | null
  targetId: string | null
  scrollTop: number
}

export type ClientEvent =
  | { type: 'join'; name: string }
  | { type: 'update_name'; name: string }
  | { type: 'reroll_color' }
  | { type: 'set_vote'; vote: EstimateOption | null }
  | { type: 'reveal' }
  | { type: 'next_ticket' }
  | {
      type: 'select_issue'
      issueId: string
      issueKey: string
      issueUrl: string
      fields: IssueEditorField[]
    }
  | {
      type: 'set_issue_field'
      issueId: string
      issueKey: string
      issueUrl: string
      field: IssueEditorField
    }
  | {
      type: 'issue_crdt_delta'
      issueId: string
      fieldId: string
      label: string
      update: string
    }
  | {
      type: 'add_issue_subtask'
      issueId: string
      issueKey: string
      issueUrl: string
      title: string
    }
  | {
      type: 'update_issue_subtask'
      issueId: string
      subtaskId: string
      title?: string
      description?: string
      done?: boolean
    }
  | {
      type: 'remove_issue_subtask'
      issueId: string
      subtaskId: string
    }
  | {
      type: 'set_issue_presence'
      issueId: string
      targetId: string
      active: boolean
    }
  | {
      type: 'set_orchestrator_view'
      issueId: string | null
      targetId: string | null
      scrollTop: number
    }
  | {
      type: 'set_follow_orchestrator'
      following: boolean
    }

export type ParticipantView = {
  id: string
  name: string
  colorHue: number
  isOrchestrator: boolean
  isFollowingOrchestrator: boolean
  hasVoted: boolean
  vote: EstimateOption | null
}

export type RoomStateSnapshot = {
  revealed: boolean
  myId: string
  myVote: EstimateOption | null
  orchestratorId: string | null
  orchestratorView: OrchestratorViewSnapshot
  participants: ParticipantView[]
  issueWorkspace: IssueWorkspaceSnapshot
  jiraIssues: JiraIssueResult | null
}

export type ServerEvent =
  | { type: 'state_snapshot'; state: RoomStateSnapshot }
  | {
      type: 'issue_crdt_bootstrap'
      issueId: string
      fields: IssueFieldCrdtSnapshot[]
    }
  | {
      type: 'issue_crdt_delta'
      issueId: string
      fieldId: string
      label: string
      update: string
      updatedBy: string | null
      updatedAt: string
    }
  | { type: 'server_error'; message: string }
