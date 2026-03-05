'use client'

import type { RefCallback } from 'react'
import CodeMirrorField from '../CodeMirrorField'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type {
  IssueEditorField,
  IssueDraftSnapshot,
  JiraIssue,
  RoomStateSnapshot,
} from '../../src/lib/protocol'

type TicketWorkspaceProps = {
  selectedIssueId: string | null
  selectedIssueKey: string
  selectedIssueDraft: IssueDraftSnapshot | null
  selectedIssueFromJira: JiraIssue | null
  visibleIssueFields: IssueEditorField[]
  votedCount: number
  totalCount: number
  revealed: boolean
  isRawTicketDataOpen: boolean
  isCrdtDebugOpen: boolean
  selectedIssueRawData: string
  selectedIssueCrdtSync: Array<{ id: string; label: string; synced: boolean; docLength: number; draftLength: number }>
  selectedIssueCrdtSyncedCount: number
  orchestratorColorHue: number
  followedFieldTargetId: string | null
  newSubtaskTitle: string
  onToggleRawData: () => void
  onToggleCrdtDebug: () => void
  onFieldInput: (issueId: string, issueKey: string, issueUrl: string, field: IssueEditorField, value: string) => void
  onFieldFocus: (targetId: string) => void
  onFieldBlur: (targetId: string) => void
  onNewSubtaskTitleChange: (value: string) => void
  onAddSubtask: () => void
  getPresenceLabelForTarget: (targetId: string) => string
  isTargetEditedByOthers: (targetId: string) => boolean
  getIssueFieldYText: (issueId: string, field: IssueEditorField) => unknown
  shouldUseMarkdownEditor: (fieldId: string) => boolean
  fieldPresenceTargetId: (fieldId: string) => string
  ticketWorkspaceRef: RefCallback<HTMLElement>
}

export default function TicketWorkspace({
  selectedIssueId,
  selectedIssueKey,
  selectedIssueDraft,
  selectedIssueFromJira,
  visibleIssueFields,
  votedCount,
  totalCount,
  revealed,
  isRawTicketDataOpen,
  isCrdtDebugOpen,
  selectedIssueRawData,
  selectedIssueCrdtSync,
  selectedIssueCrdtSyncedCount,
  orchestratorColorHue,
  followedFieldTargetId,
  newSubtaskTitle,
  onToggleRawData,
  onToggleCrdtDebug,
  onFieldInput,
  onFieldFocus,
  onFieldBlur,
  onNewSubtaskTitleChange,
  onAddSubtask,
  getPresenceLabelForTarget,
  isTargetEditedByOthers,
  getIssueFieldYText,
  shouldUseMarkdownEditor,
  fieldPresenceTargetId,
  ticketWorkspaceRef,
}: TicketWorkspaceProps) {
  return (
    <div className="p-6" ref={ticketWorkspaceRef}>
      {/* Header bar */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Ticket Workspace
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {votedCount} of {totalCount} voted
          </p>
        </div>
        <div
          className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
          style={{
            borderColor: revealed ? 'var(--color-success)' : 'var(--color-border)',
            background: revealed ? 'var(--color-success-subtle)' : 'var(--color-surface-elevated)',
            color: revealed ? 'var(--color-success)' : 'var(--color-text-tertiary)',
          }}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${revealed ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          {revealed ? 'Revealed' : 'Voting'}
        </div>
      </div>

      {selectedIssueId ? (
        <div className="space-y-5">
          {/* Issue header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-sm font-bold"
                  style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                >
                  {selectedIssueKey}
                </span>
                {selectedIssueDraft?.issueUrl ? (
                  <a
                    href={selectedIssueDraft.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    Open in Jira
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 3h7v7M13 3L7 9" />
                    </svg>
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={onToggleRawData}>
                {isRawTicketDataOpen ? 'Hide raw' : 'Raw data'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onToggleCrdtDebug}>
                {isCrdtDebugOpen ? 'Hide CRDT' : 'CRDT'}
              </Button>
            </div>
          </div>

          {/* Raw data panel */}
          {isRawTicketDataOpen ? (
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-elevated)' }}
            >
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Raw ticket data
              </h3>
              <pre
                className="max-h-72 overflow-auto rounded-md border p-3 text-[11px] leading-relaxed"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {selectedIssueRawData}
              </pre>
            </div>
          ) : null}

          {/* CRDT debug panel */}
          {isCrdtDebugOpen ? (
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-elevated)' }}
            >
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                CRDT sync - {selectedIssueCrdtSyncedCount}/{selectedIssueCrdtSync.length} synced
              </h3>
              <div className="space-y-1">
                {selectedIssueCrdtSync.map((entry) => (
                  <div
                    key={`${selectedIssueId}:sync:${entry.id}`}
                    className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px]"
                    style={{
                      borderColor: 'var(--color-border)',
                      background: entry.synced ? 'var(--color-success-subtle)' : 'var(--color-warning-subtle)',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-secondary)' }}>{entry.label}</span>
                    <span
                      className="font-medium"
                      style={{ color: entry.synced ? 'var(--color-success)' : 'var(--color-warning)' }}
                    >
                      {entry.synced ? 'synced' : 'resyncing'} ({entry.docLength}/{entry.draftLength})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Issue fields */}
          {selectedIssueDraft ? (
            <div className="space-y-3" style={{ ['--follow-hue' as string]: String(orchestratorColorHue) }}>
              {visibleIssueFields.map((field) => {
                const presenceTarget = fieldPresenceTargetId(field.id)
                const presenceLabel = getPresenceLabelForTarget(presenceTarget)
                const editedByOthers = isTargetEditedByOthers(presenceTarget)
                const isFollowed = followedFieldTargetId === presenceTarget

                return (
                  <div
                    key={`${selectedIssueId}:${field.id}`}
                    className="rounded-lg border p-3 transition-colors"
                    style={{
                      borderColor: editedByOthers
                        ? 'var(--color-warning)'
                        : isFollowed
                          ? `hsl(${orchestratorColorHue} 60% 50%)`
                          : 'var(--color-border)',
                      background: editedByOthers
                        ? 'var(--color-warning-subtle)'
                        : isFollowed
                          ? `hsl(${orchestratorColorHue} 80% 97%)`
                          : 'var(--color-surface)',
                    }}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                        {field.label}
                      </label>
                      {presenceLabel ? (
                        <span
                          className="text-[11px] font-medium"
                          style={{ color: editedByOthers ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}
                        >
                          {presenceLabel}
                        </span>
                      ) : null}
                    </div>
                    <CodeMirrorField
                      value={field.value}
                      yText={null}
                      minRows={field.id === 'description' ? 6 : 3}
                      busy={editedByOthers}
                      markdownMode={shouldUseMarkdownEditor(field.id)}
                      onInput={(value) => {
                        if (!selectedIssueId || !selectedIssueKey) return
                        onFieldInput(
                          selectedIssueId,
                          selectedIssueKey,
                          selectedIssueDraft?.issueUrl ?? selectedIssueFromJira?.url ?? '',
                          field,
                          value,
                        )
                      }}
                      onFocus={() => onFieldFocus(presenceTarget)}
                      onBlur={() => onFieldBlur(presenceTarget)}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              Loading issue details...
            </p>
          )}

          {/* Subtasks */}
          <div
            className="rounded-lg border p-3"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
              Subtasks
            </h3>

            {selectedIssueDraft && selectedIssueDraft.subtasks.length > 0 ? (
              <div className="mb-3 space-y-0">
                {selectedIssueDraft.subtasks.map((subtask) => {
                  const subtaskIdentifier = subtask.key || subtask.id
                  return (
                    <div
                      key={subtask.id}
                      className="flex items-center justify-between gap-2 border-b py-2 last:border-b-0"
                      style={{ borderColor: 'var(--color-border-subtle)' }}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-xs font-bold" style={{ color: 'var(--color-accent)' }}>
                          {subtaskIdentifier}
                        </span>
                        <span className="truncate text-sm" style={{ color: 'var(--color-text-primary)' }}>
                          {subtask.title}
                        </span>
                      </div>
                      {subtask.url ? (
                        <a
                          href={subtask.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-[var(--color-accent-subtle)]"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
                          title="Open in Jira"
                        >
                          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 3h7v7M13 3L7 9" />
                          </svg>
                        </a>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                No subtasks yet.
              </p>
            )}

            <div className="flex gap-2">
              <Input
                value={newSubtaskTitle}
                placeholder="Add subtask..."
                onChange={(event) => onNewSubtaskTitleChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onAddSubtask()
                  }
                }}
                className="flex-1"
              />
              <Button type="button" variant="secondary" size="sm" onClick={onAddSubtask}>
                Add
              </Button>
            </div>
          </div>

          {/* Status message */}
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {revealed
              ? 'Votes are revealed. Select Next ticket to continue.'
              : 'Votes are hidden until revealed.'}
          </p>
        </div>
      ) : (
        /* Empty state */
        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
        >
          <svg viewBox="0 0 24 24" className="mb-3 h-10 w-10 opacity-40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h6M9 13h6M9 17h4" />
          </svg>
          <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>No ticket selected</h3>
          <p className="mt-1 text-xs">Pick a ticket from the sidebar to get started.</p>
        </div>
      )}
    </div>
  )
}
