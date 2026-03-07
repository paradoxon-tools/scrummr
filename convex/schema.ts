import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const issueEditorField = v.object({
  id: v.string(),
  label: v.string(),
  value: v.string(),
});

const issueSubtask = v.object({
  id: v.string(),
  key: v.string(),
  url: v.union(v.string(), v.null()),
  title: v.string(),
  description: v.string(),
  done: v.boolean(),
});

const issueDraftSnapshot = v.object({
  issueId: v.string(),
  issueKey: v.string(),
  issueUrl: v.string(),
  fields: v.array(issueEditorField),
  subtasks: v.optional(v.array(issueSubtask)),
  updatedBy: v.union(v.string(), v.null()),
  updatedAt: v.string(),
});

const issueSubtasksSnapshot = v.object({
  issueId: v.string(),
  subtasks: v.array(issueSubtask),
});

const issueFieldSyncSnapshot = v.object({
  fieldId: v.string(),
  label: v.string(),
  value: v.string(),
  status: v.union(v.literal("clean"), v.literal("dirty"), v.literal("syncing"), v.literal("failed")),
  retryCount: v.number(),
  nextRetryAt: v.union(v.string(), v.null()),
  lastAttemptAt: v.union(v.string(), v.null()),
  lastSyncedAt: v.union(v.string(), v.null()),
  failureMessage: v.union(v.string(), v.null()),
});

const issueSyncSnapshot = v.object({
  issueId: v.string(),
  issueKey: v.string(),
  issueUrl: v.string(),
  fields: v.array(issueFieldSyncSnapshot),
});

const issueFieldCrdtSnapshot = v.object({
  fieldId: v.string(),
  label: v.string(),
  update: v.string(),
});

const issueCrdtSnapshot = v.object({
  issueId: v.string(),
  fields: v.array(issueFieldCrdtSnapshot),
});

const issuePresenceSnapshot = v.object({
  issueId: v.string(),
  targetId: v.string(),
  participantIds: v.array(v.string()),
});

const jiraConnectionSnapshot = v.object({
  connectionId: v.string(),
  baseUrl: v.string(),
  siteName: v.string(),
  ticketPrefix: v.string(),
  quickFilterFieldIds: v.array(v.string()),
  ownerUserId: v.string(),
  ownerName: v.string(),
  updatedAt: v.string(),
});

const jiraAccessibleSite = v.object({
  id: v.string(),
  name: v.string(),
  url: v.string(),
});

export default defineSchema({
  participants: defineTable({
    clientId: v.string(),
    name: v.string(),
    colorHue: v.number(),
    vote: v.union(v.string(), v.null()),
    isFollowingOrchestrator: v.boolean(),
    lastSeenAt: v.optional(v.number()),
  }).index("by_client_id", ["clientId"]),

  rooms: defineTable({
    revealed: v.boolean(),
    selectedIssueId: v.union(v.string(), v.null()),
    orchestratorId: v.union(v.string(), v.null()),
    settings: v.optional(v.object({
      allowParticipantEditingOutsideFocus: v.boolean(),
    })),
    orchestratorView: v.optional(v.object({
      issueId: v.union(v.string(), v.null()),
      targetId: v.union(v.string(), v.null()),
      scrollTop: v.number(),
    })),
    issueDrafts: v.optional(v.array(issueDraftSnapshot)),
    issueSubtasks: v.optional(v.array(issueSubtasksSnapshot)),
    issueSync: v.optional(v.array(issueSyncSnapshot)),
    issueCrdt: v.optional(v.array(issueCrdtSnapshot)),
    issuePresence: v.optional(v.array(issuePresenceSnapshot)),
    jiraIssues: v.union(v.any(), v.null()),
    jiraSubtasksByIssueId: v.optional(v.record(v.string(), v.array(issueSubtask))),
    jiraConnection: v.optional(v.union(jiraConnectionSnapshot, v.null())),
    estimatedIssueIds: v.optional(v.array(v.string())),
  }),

  jiraConnections: defineTable({
    ownerUserId: v.string(),
    ownerName: v.string(),
    siteUrl: v.union(v.string(), v.null()),
    siteName: v.union(v.string(), v.null()),
    cloudId: v.union(v.string(), v.null()),
    availableSites: v.array(jiraAccessibleSite),
    accessToken: v.string(),
    refreshToken: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.string(),
    lastError: v.union(v.string(), v.null()),
    updatedAt: v.string(),
  })
    .index("by_owner_user_id", ["ownerUserId"]),

  jiraOAuthStates: defineTable({
    state: v.string(),
    ownerUserId: v.string(),
    ownerName: v.string(),
    returnTo: v.string(),
    codeVerifier: v.string(),
    createdAt: v.string(),
    expiresAt: v.string(),
  })
    .index("by_state", ["state"]),
});
