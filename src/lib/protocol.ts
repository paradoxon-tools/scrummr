export const ESTIMATE_OPTIONS = ['0', '1', '2', '3', '5', '8', '13', '21', '?'] as const

export type EstimateOption = (typeof ESTIMATE_OPTIONS)[number]

export type ClientEvent =
  | { type: 'join'; name: string }
  | { type: 'update_name'; name: string }
  | { type: 'reroll_color' }
  | { type: 'set_vote'; vote: EstimateOption | null }
  | { type: 'reveal' }
  | { type: 'next_ticket' }

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
}

export type ServerEvent =
  | { type: 'state_snapshot'; state: RoomStateSnapshot }
  | { type: 'server_error'; message: string }
