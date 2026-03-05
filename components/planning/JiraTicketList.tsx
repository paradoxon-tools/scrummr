'use client'

import { Link } from '@tanstack/react-router'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import type { JiraIssue, JiraIssueCategory, JiraIssueGroup, JiraIssueResult } from '../../src/lib/protocol'
import type { RefCallback } from 'react'

type JiraTicketListProps = {
  jiraIssues: JiraIssueResult | null
  visibleJiraGroups: JiraIssueGroup[]
  selectedIssueId: string | null
  jiraError: string
  jiraMessage: string
  quickFilterBadges: Array<{
    id: string
    fieldId: string
    fieldLabel: string
    value: string
    count: number
  }>
  activeQuickFilterBadgeId: string | null
  activeQuickFilterBadge: { fieldLabel: string; value: string } | null
  onSelectIssue: (issue: JiraIssue, group: JiraIssueGroup) => void
  onSetQuickFilter: (badgeId: string | null) => void
  jiraListScrollRef: RefCallback<HTMLElement>
}

const jiraCategoryLabel = (category: JiraIssueCategory): string => {
  if (category === 'current') return 'Current sprint'
  if (category === 'future') return 'Future sprint'
  return 'Backlog'
}

export default function JiraTicketList({
  jiraIssues,
  visibleJiraGroups,
  selectedIssueId,
  jiraError,
  jiraMessage,
  quickFilterBadges,
  activeQuickFilterBadgeId,
  activeQuickFilterBadge,
  onSelectIssue,
  onSetQuickFilter,
  jiraListScrollRef,
}: JiraTicketListProps) {
  return (
    <>
      {/* Sidebar header */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Tickets
          </h2>
          <Link
            to="/dashboard"
            className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--color-accent-subtle)]"
            style={{ color: 'var(--color-accent)' }}
          >
            Dashboard
          </Link>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Select a ticket to discuss and estimate.
        </p>
      </div>

      {/* Messages */}
      {jiraError ? (
        <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: 'var(--color-danger-subtle)', color: 'var(--color-danger)' }}>
          {jiraError}
        </div>
      ) : jiraMessage ? (
        <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
          {jiraMessage}
        </div>
      ) : null}

      {/* Quick filters */}
      {jiraIssues && quickFilterBadges.length > 0 ? (
        <div className="shrink-0 px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onSetQuickFilter(null)}
              className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
              style={{
                borderColor: !activeQuickFilterBadgeId ? 'var(--color-accent)' : 'var(--color-border)',
                background: !activeQuickFilterBadgeId ? 'var(--color-accent-subtle)' : 'transparent',
                color: !activeQuickFilterBadgeId ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              }}
            >
              All
            </button>
            {quickFilterBadges.map((badge) => (
              <button
                key={badge.id}
                type="button"
                onClick={() => onSetQuickFilter(badge.id)}
                className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
                style={{
                  borderColor: activeQuickFilterBadgeId === badge.id ? 'var(--color-accent)' : 'var(--color-border)',
                  background: activeQuickFilterBadgeId === badge.id ? 'var(--color-accent-subtle)' : 'transparent',
                  color: activeQuickFilterBadgeId === badge.id ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                }}
              >
                {badge.value} ({badge.count})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Ticket list */}
      <div
        className="flex-1 overflow-y-auto px-2 pb-4"
        ref={jiraListScrollRef}
        style={{
          maskImage: 'linear-gradient(180deg, #000 0%, #000 90%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 90%, transparent 100%)',
        }}
      >
        {jiraIssues ? (
          visibleJiraGroups.length > 0 ? (
            <div className="space-y-3">
              {visibleJiraGroups.map((group) => (
                <div key={group.id}>
                  <div
                    className="sticky top-0 z-10 flex items-baseline justify-between gap-2 px-2 py-1.5 text-xs font-semibold"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                  >
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
                      {jiraCategoryLabel(group.category)} ({group.issues.length})
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {group.issues.map((issue) => {
                      const isSelected = selectedIssueId === issue.id
                      return (
                        <button
                          key={issue.id}
                          type="button"
                          onClick={() => onSelectIssue(issue, group)}
                          className="w-full rounded-lg px-2.5 py-2 text-left transition-colors"
                          style={{
                            background: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                              {issue.key}
                            </span>
                            <Badge className="text-[10px]">{issue.status}</Badge>
                            {issue.isEstimated ? (
                              <Badge variant="success" className="text-[10px]">Done</Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                            {issue.summary}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {activeQuickFilterBadge
                ? `No tickets match ${activeQuickFilterBadge.fieldLabel}: ${activeQuickFilterBadge.value}.`
                : 'No Jira tickets found.'}
            </p>
          )
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div
              className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-accent-subtle)' }}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" style={{ color: 'var(--color-accent)' }} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="14" height="14" rx="2" />
                <path d="M7 7h6M7 10h6M7 13h4" />
              </svg>
            </div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>No tickets loaded</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Start a session from the dashboard.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
