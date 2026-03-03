export const ESTIMATE_OPTIONS = ['0', '1', '2', '3', '5', '8', '13', '21', '?'] as const

export type EstimateOption = (typeof ESTIMATE_OPTIONS)[number]

export type IssueEditorField = {
  id: string
  label: string
  value: string
}

export type IssueSubtask = {
  id: string
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

export type ParticipantView = {
  id: string
  name: string
  colorHue: number
  hasVoted: boolean
  vote: EstimateOption | null
}

export type RoomStateSnapshot = {
  revealed: boolean
  myId: string
  myVote: EstimateOption | null
  participants: ParticipantView[]
  issueWorkspace: IssueWorkspaceSnapshot
}

export type ServerEvent =
  | { type: 'state_snapshot'; state: RoomStateSnapshot }
  | { type: 'server_error'; message: string }
