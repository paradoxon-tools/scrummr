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
  baseUrl: v.string(),
  email: v.string(),
  apiToken: v.string(),
  ticketPrefix: v.string(),
  quickFilterFieldIds: v.array(v.string()),
  ownerTokenIdentifier: v.string(),
  ownerName: v.string(),
  updatedAt: v.string(),
});

export default defineSchema({
  participants: defineTable({
    clientId: v.string(),
    name: v.string(),
    colorHue: v.number(),
    vote: v.union(v.string(), v.null()),
    isFollowingOrchestrator: v.boolean(),
    lastSeenAt: v.number(),
  }).index("by_client_id", ["clientId"]),

  rooms: defineTable({
    revealed: v.boolean(),
    selectedIssueId: v.union(v.string(), v.null()),
    orchestratorId: v.union(v.string(), v.null()),
    settings: v.object({
      allowParticipantEditingOutsideFocus: v.boolean(),
    }),
    orchestratorView: v.object({
      issueId: v.union(v.string(), v.null()),
      targetId: v.union(v.string(), v.null()),
      scrollTop: v.number(),
    }),
    issueDrafts: v.array(issueDraftSnapshot),
    issueSubtasks: v.array(issueSubtasksSnapshot),
    issueSync: v.array(issueSyncSnapshot),
    issueCrdt: v.array(issueCrdtSnapshot),
    issuePresence: v.array(issuePresenceSnapshot),
    jiraIssues: v.union(v.any(), v.null()),
    jiraConnection: v.union(jiraConnectionSnapshot, v.null()),
    estimatedIssueIds: v.array(v.string()),
  }),
});
