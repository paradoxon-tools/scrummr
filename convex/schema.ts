import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  participants: defineTable({
    clientId: v.string(),
    name: v.string(),
    colorHue: v.number(),
    vote: v.union(v.string(), v.null()),
    isFollowingOrchestrator: v.boolean(),
  }).index("by_client_id", ["clientId"]),

  rooms: defineTable({
    revealed: v.boolean(),
    selectedIssueId: v.union(v.string(), v.null()),
    orchestratorId: v.union(v.string(), v.null()),
    orchestratorView: v.object({
      issueId: v.union(v.string(), v.null()),
      targetId: v.union(v.string(), v.null()),
      scrollTop: v.number(),
    }),
    issueDrafts: v.array(v.any()),
    issuePresence: v.array(v.any()),
    jiraIssues: v.union(v.any(), v.null()),
    jiraSubtasksByIssueId: v.record(v.string(), v.array(v.any())),
    estimatedIssueIds: v.array(v.string()),
  }),
});
