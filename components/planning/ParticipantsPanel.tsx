'use client'

import type { RefObject } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { EstimateOption, ParticipantView } from '../../src/lib/protocol'
import { ESTIMATE_OPTIONS } from '../../src/lib/protocol'

type ParticipantsPanelProps = {
  participants: ParticipantView[]
  myId: string
  orchestratorId: string | null
  revealed: boolean
  myVote: EstimateOption | null
  canReveal: boolean
  isFollowingOrchestrator: boolean
  canFollowOrchestrator: boolean
  isProfileEditing: boolean
  nameInput: string
  joinedName: string
  isConnected: boolean
  orchestratorParticipant: ParticipantView | null
  revealBuckets: Array<{ estimate: string; voters: Array<{ id: string; name: string; colorHue: number }> }>
  participantNameInputRef: RefObject<HTMLInputElement | null>
  onRevealOrNext: () => void
  onVote: (option: EstimateOption) => void
  onRequestNewColor: () => void
  onFollowOrchestrator: () => void
  onStartEditing: () => void
  onStopEditing: () => void
  onNameChange: (value: string) => void
  onNameSubmit: () => void
  onNameCancel: () => void
}

export default function ParticipantsPanel({
  participants,
  myId,
  orchestratorId,
  revealed,
  myVote,
  canReveal,
  isFollowingOrchestrator,
  canFollowOrchestrator,
  isProfileEditing,
  nameInput,
  joinedName,
  isConnected,
  orchestratorParticipant,
  revealBuckets,
  participantNameInputRef,
  onRevealOrNext,
  onVote,
  onRequestNewColor,
  onFollowOrchestrator,
  onStartEditing,
  onStopEditing,
  onNameChange,
  onNameSubmit,
  onNameCancel,
}: ParticipantsPanelProps) {
  return (
    <>
      {/* Panel header */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Participants
        </h2>
        {orchestratorParticipant ? (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Led by <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{orchestratorParticipant.name}</span>
            </p>
            {isConnected && canFollowOrchestrator ? (
              <button
                type="button"
                onClick={onFollowOrchestrator}
                disabled={isFollowingOrchestrator}
                className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-60"
                style={{
                  borderColor: isFollowingOrchestrator ? 'var(--color-success)' : 'var(--color-border)',
                  background: isFollowingOrchestrator ? 'var(--color-success-subtle)' : 'transparent',
                  color: isFollowingOrchestrator ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                }}
              >
                {isFollowingOrchestrator ? 'Following' : 'Re-follow'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Participant list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {participants.map((participant) => {
            const isMe = participant.id === myId
            const isOrchestrator = participant.id === orchestratorId
            return (
              <li
                key={participant.id}
                className="group rounded-lg px-2.5 py-2 transition-colors"
                style={{
                  background: isMe ? 'var(--color-accent-subtle)' : 'transparent',
                  ['--user-hue' as string]: String(participant.colorHue),
                }}
              >
                <div className="flex items-center gap-2">
                  {/* Avatar dot / color swatch */}
                  <div className="relative shrink-0">
                    {isMe ? (
                      <button
                        type="button"
                        onClick={onRequestNewColor}
                        className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110 cursor-pointer"
                        style={{ background: `hsl(${participant.colorHue} 55% 55%)` }}
                        aria-label="Get a new participant color"
                        title="Get a new color"
                      />
                    ) : (
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ background: `hsl(${participant.colorHue} 55% 55%)` }}
                        aria-hidden="true"
                      />
                    )}
                    {isOrchestrator ? (
                      <span
                        className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-amber-500"
                        style={{ background: 'var(--color-surface)', fontSize: '8px' }}
                        title="Orchestrator"
                      >
                        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor">
                          <path d="M2 12h12l-1-6-3 3-2-4-2 4-3-3z" />
                        </svg>
                      </span>
                    ) : null}
                  </div>

                  {/* Name */}
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    {isMe && isProfileEditing ? (
                      <Input
                        ref={participantNameInputRef}
                        className="h-6 rounded-md border-[var(--color-border)] px-1.5 py-0 text-xs"
                        maxLength={40}
                        value={nameInput}
                        aria-label="Edit your display name"
                        autoComplete="name"
                        onBlur={() => {
                          onStopEditing()
                          onNameSubmit()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            onNameCancel()
                            ;(event.currentTarget as HTMLInputElement).blur()
                            return
                          }
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            onNameSubmit()
                            ;(event.currentTarget as HTMLInputElement).blur()
                          }
                        }}
                        onChange={(event) => onNameChange(event.currentTarget.value)}
                      />
                    ) : (
                      <span className="truncate text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {participant.name}
                      </span>
                    )}
                    {isMe && !isProfileEditing ? (
                      <button
                        type="button"
                        onClick={onStartEditing}
                        className="invisible shrink-0 rounded p-0.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text-secondary)] group-hover:visible cursor-pointer"
                        aria-label="Edit your display name"
                        title="Edit your display name"
                      >
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11.7 1.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8.2 8.2-3.8.9.9-3.8zM2.5 14.5h11" />
                        </svg>
                      </button>
                    ) : null}
                  </div>

                  {/* Vote status / result */}
                  <div className="shrink-0">
                    {revealed ? (
                      <span
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-bold"
                        style={{
                          background: participant.vote ? `hsl(${participant.colorHue} 55% 55%)` : 'var(--color-surface-elevated)',
                          color: participant.vote ? '#fff' : 'var(--color-text-tertiary)',
                        }}
                      >
                        {participant.vote ?? '-'}
                      </span>
                    ) : (
                      <span
                        className="inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold"
                        style={{
                          background: participant.hasVoted ? 'var(--color-success-subtle)' : 'var(--color-surface-elevated)',
                          color: participant.hasVoted ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                        }}
                      >
                        {participant.hasVoted ? 'Voted' : 'Waiting'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Follow state label */}
                {orchestratorId !== null ? (
                  <p
                    className="mt-0.5 pl-8 text-[10px]"
                    style={{
                      color: participant.isOrchestrator
                        ? 'var(--color-accent)'
                        : participant.isFollowingOrchestrator
                          ? 'var(--color-text-tertiary)'
                          : 'var(--color-warning)',
                    }}
                  >
                    {participant.isOrchestrator
                      ? 'Orchestrator'
                      : participant.isFollowingOrchestrator
                        ? 'Following'
                        : 'Not following'}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Voting section */}
      <div
        className="shrink-0 border-t px-3 pt-3 pb-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        {/* Action button */}
        <Button
          type="button"
          className="mb-3 w-full"
          onClick={onRevealOrNext}
          disabled={!revealed && !canReveal}
        >
          {revealed ? 'Next ticket' : 'Reveal votes'}
        </Button>

        {/* Vote cards */}
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Vote cards">
          {ESTIMATE_OPTIONS.map((option) => {
            const isSelected = myVote === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => onVote(option)}
                className="flex h-10 items-center justify-center rounded-lg text-sm font-bold transition-all cursor-pointer"
                style={{
                  background: isSelected ? 'var(--color-accent)' : 'var(--color-surface-elevated)',
                  color: isSelected ? '#fff' : 'var(--color-text-primary)',
                  border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  boxShadow: isSelected ? '0 2px 8px var(--color-accent-subtle)' : 'var(--shadow-xs)',
                  transform: isSelected ? 'translateY(-1px)' : 'none',
                }}
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>

      {/* Revealed breakdown */}
      {revealed && revealBuckets.length > 0 ? (
        <div
          className="shrink-0 border-t px-3 pt-3 pb-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h3
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Breakdown
          </h3>
          <div className="space-y-2">
            {revealBuckets.map((bucket) => (
              <div key={bucket.estimate} className="flex items-start gap-2">
                <span
                  className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                  style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                >
                  {bucket.estimate}
                </span>
                <div className="flex flex-wrap gap-1">
                  {bucket.voters.map((voter) => (
                    <span
                      key={voter.id}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                      style={{ background: `hsl(${voter.colorHue} 50% 48%)` }}
                    >
                      {voter.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
