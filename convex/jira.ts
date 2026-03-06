import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { IssueSubtask, JiraIssue, JiraIssueGroup, JiraIssueResult, JiraSprint } from "../src/lib/protocol";

type JiraIssueWithSprint = JiraIssue & {
  sprint: JiraSprint | null;
  subtasks: IssueSubtask[];
};

type JiraActionError = {
  ok: false;
  message: string;
};

const jiraPageSize = 100;
const jiraMaxPages = 40;
const jiraAllowedIssueTypes = new Set(["bug", "story", "task"]);
const jiraAllowedIssueStatuses = new Set(["to do", "in progress", "for testing"]);
const jiraToDoStatusCategoryNames = new Set(["new", "todo", "to do"]);
const jiraInProgressStatusCategoryNames = new Set(["indeterminate", "in progress"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const normalizeComparableText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeIssueId = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, 80) : "");

const normalizeTicketPrefix = (value: unknown): string =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 20) : "";

const normalizeQuickFilterFieldId = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 80);
};

const normalizeParticipantId = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().slice(0, 80);
  if (!/^[a-z0-9-]+$/i.test(normalized)) {
    return "";
  }
  return normalized;
};

const parseQuickFilterFieldIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeQuickFilterFieldId(entry);
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }

  return [...unique];
};

const normalizeJiraOrigin = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

const toSafeString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const normalizeJiraStatus = (status: string, statusCategory: string): string => {
  const normalizedStatus = normalizeComparableText(status);
  const normalizedStatusCategory = normalizeComparableText(statusCategory);

  if (normalizedStatus === "for testing") {
    return "For Testing";
  }

  if (jiraToDoStatusCategoryNames.has(normalizedStatusCategory)) {
    return "To Do";
  }

  if (jiraInProgressStatusCategoryNames.has(normalizedStatusCategory)) {
    return "In Progress";
  }

  return status.trim() || "Unknown";
};

const adfNodeToText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return "";
  }

  if (value.type === "hardBreak") {
    return "\n";
  }

  const nodeText = typeof value.text === "string" ? value.text : "";
  const childText = Array.isArray(value.content) ? value.content.map(adfNodeToText).join("") : "";
  const combined = `${nodeText}${childText}`;

  if (value.type === "paragraph" || value.type === "heading") {
    return `${combined}\n`;
  }

  if (value.type === "listItem") {
    return `- ${combined}\n`;
  }

  return combined;
};

const toJiraDescriptionText = (value: unknown): string => {
  if (typeof value === "string") {
    return value.replace(/\r\n/g, "\n").slice(0, 16000);
  }

  if (!isRecord(value) || !Array.isArray(value.content)) {
    return "";
  }

  return value.content.map(adfNodeToText).join("").replace(/\n{3,}/g, "\n\n").trim().slice(0, 16000);
};

const extractJiraFieldText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.replace(/\r\n/g, "\n").slice(0, 16000);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractJiraFieldText(entry)).filter((entry) => entry !== "").join("\n").slice(0, 16000);
  }

  if (!isRecord(value)) {
    return "";
  }

  if (typeof value.displayName === "string" && value.displayName.trim()) {
    return value.displayName;
  }
  if (typeof value.name === "string" && value.name.trim()) {
    return value.name;
  }
  if (typeof value.value === "string" && value.value.trim()) {
    return value.value;
  }

  if (value.type === "doc" && Array.isArray(value.content)) {
    return toJiraDescriptionText(value);
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, 16000);
  } catch {
    return "";
  }
};

const parseJiraSprint = (value: unknown): JiraSprint | null => {
  if (isRecord(value)) {
    const id = Number.parseInt(String(value.id ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }

    return {
      id,
      name: toSafeString(value.name, `Sprint ${id}`),
      state: typeof value.state === "string" ? value.state.toLowerCase() : "unknown",
      startDate: typeof value.startDate === "string" ? value.startDate : null,
      endDate: typeof value.endDate === "string" ? value.endDate : null,
      completeDate: typeof value.completeDate === "string" ? value.completeDate : null,
    };
  }

  if (typeof value !== "string") {
    return null;
  }

  const readField = (fieldName: string): string | null => {
    const match = value.match(new RegExp(`\\b${fieldName}=([^,\\]]+)`));
    if (!match) {
      return null;
    }
    const parsed = match[1].trim();
    if (!parsed || parsed === "<null>") {
      return null;
    }
    return parsed;
  };

  const rawId = readField("id");
  const id = rawId === null ? Number.NaN : Number.parseInt(rawId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    name: readField("name") ?? `Sprint ${id}`,
    state: (readField("state") ?? "unknown").toLowerCase(),
    startDate: readField("startDate"),
    endDate: readField("endDate"),
    completeDate: readField("completeDate"),
  };
};

const parseIssueSprint = (value: unknown): JiraSprint | null => {
  if (Array.isArray(value)) {
    const parsed = value.map(parseJiraSprint).filter((entry): entry is JiraSprint => entry !== null);
    if (parsed.length === 0) {
      return null;
    }

    const active = parsed.find((entry) => entry.state === "active");
    if (active) {
      return active;
    }
    const future = parsed.find((entry) => entry.state === "future");
    if (future) {
      return future;
    }
    return parsed[parsed.length - 1];
  }

  return parseJiraSprint(value);
};

const normalizeJiraSubtaskStatusCategory = (value: unknown): string => {
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.key === "string" && value.key.trim()) {
    return normalizeComparableText(value.key);
  }
  if (typeof value.name === "string" && value.name.trim()) {
    return normalizeComparableText(value.name);
  }
  return "";
};

const parseJiraSubtasks = (jiraOrigin: string, value: unknown): IssueSubtask[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const subtasksById = new Map<string, IssueSubtask>();
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }

    const subtaskId = normalizeIssueId(candidate.id);
    if (!subtaskId || subtasksById.has(subtaskId)) {
      continue;
    }

    const fields = isRecord(candidate.fields) ? candidate.fields : {};
    const subtaskKey = typeof candidate.key === "string" ? candidate.key.trim() : "";
    const fallbackTitle = subtaskKey || "Subtask";
    const title = toSafeString(fields.summary, fallbackTitle).slice(0, 240);
    if (!title) {
      continue;
    }

    const statusField = isRecord(fields.status) ? fields.status : {};
    const statusCategory = normalizeJiraSubtaskStatusCategory(statusField.statusCategory);
    subtasksById.set(subtaskId, {
      id: subtaskId,
      key: subtaskKey,
      url: subtaskKey ? `${jiraOrigin}/browse/${encodeURIComponent(subtaskKey)}` : null,
      title,
      description: toJiraDescriptionText(fields.description),
      done: statusCategory === "done",
    });
  }

  return [...subtasksById.values()].slice(0, 100);
};

const buildIssueFields = (
  fields: Record<string, unknown>,
  normalizedStatus: string,
  quickFilterFieldIds: string[],
): JiraIssue["fields"] => {
  const candidates: Array<{ id: string; label: string; value: unknown }> = [
    { id: "summary", label: "Summary", value: fields.summary },
    { id: "description", label: "Description", value: fields.description },
    { id: "status", label: "Status", value: normalizedStatus },
    { id: "priority", label: "Priority", value: fields.priority },
    { id: "assignee", label: "Assignee", value: fields.assignee },
    { id: "issue_type", label: "Issue Type", value: fields.issuetype },
    { id: "reporter", label: "Reporter", value: fields.reporter },
    { id: "created", label: "Created", value: fields.created },
    { id: "updated", label: "Updated", value: fields.updated },
  ];

  const existingIds = new Set(candidates.map((entry) => entry.id));
  for (const fieldId of quickFilterFieldIds) {
    if (existingIds.has(fieldId)) {
      continue;
    }

    candidates.push({
      id: fieldId,
      label: fieldId,
      value: fields[fieldId],
    });
    existingIds.add(fieldId);
  }

  return candidates
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      value: extractJiraFieldText(entry.value),
    }))
    .filter((entry) => entry.value !== "" || entry.id === "description");
};

const mapJiraIssues = (jiraOrigin: string, payload: unknown, quickFilterFieldIds: string[]): JiraIssueWithSprint[] | null => {
  if (!isRecord(payload) || !Array.isArray(payload.issues)) {
    return null;
  }

  return payload.issues
    .filter((issue): issue is Record<string, unknown> => isRecord(issue))
    .map((issue) => {
      const key = toSafeString(issue.key, "UNKNOWN");
      const id = toSafeString(issue.id, key);
      const fields = isRecord(issue.fields) ? issue.fields : {};
      const statusField = isRecord(fields.status) ? fields.status : {};
      const statusCategoryField = isRecord(statusField.statusCategory) ? statusField.statusCategory : {};
      const assigneeField = isRecord(fields.assignee) ? fields.assignee : {};
      const priorityField = isRecord(fields.priority) ? fields.priority : {};
      const issueTypeField = isRecord(fields.issuetype) ? fields.issuetype : {};
      const reporterField = isRecord(fields.reporter) ? fields.reporter : {};
      const rawStatus = toSafeString(statusField.name, "Unknown");
      const rawStatusCategory =
        typeof statusCategoryField.key === "string"
          ? statusCategoryField.key
          : typeof statusCategoryField.name === "string"
            ? statusCategoryField.name
            : "";
      const normalizedStatus = normalizeJiraStatus(rawStatus, rawStatusCategory);

      return {
        id,
        key,
        summary: toSafeString(fields.summary, "(no summary)"),
        description: toJiraDescriptionText(fields.description),
        status: normalizedStatus,
        assignee: typeof assigneeField.displayName === "string" ? assigneeField.displayName : null,
        priority: typeof priorityField.name === "string" ? priorityField.name : null,
        issueType: toSafeString(issueTypeField.name, "Issue"),
        reporter: typeof reporterField.displayName === "string" ? reporterField.displayName : null,
        createdAt: typeof fields.created === "string" ? fields.created : null,
        updatedAt: typeof fields.updated === "string" ? fields.updated : null,
        url: `${jiraOrigin}/browse/${encodeURIComponent(key)}`,
        isEstimated: false,
        fields: buildIssueFields(fields, normalizedStatus, quickFilterFieldIds),
        sprint: parseIssueSprint(fields.sprint),
        subtasks: parseJiraSubtasks(jiraOrigin, fields.subtasks),
      };
    });
};

const jiraErrorMessage = (status: number, payload: unknown): string => {
  if (isRecord(payload)) {
    if (Array.isArray(payload.errorMessages) && typeof payload.errorMessages[0] === "string") {
      return payload.errorMessages[0];
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  }

  return `Jira returned HTTP ${status}.`;
};

const jiraRequestHeaders = (authorization: string): Record<string, string> => ({
  Authorization: `Basic ${authorization}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

const encodeBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const toDateMs = (value: string | null): number => {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

const withoutSprint = (issue: JiraIssueWithSprint): JiraIssue => ({
  id: issue.id,
  key: issue.key,
  summary: issue.summary,
  description: issue.description,
  status: issue.status,
  assignee: issue.assignee,
  priority: issue.priority,
  issueType: issue.issueType,
  reporter: issue.reporter,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
  url: issue.url,
  isEstimated: issue.isEstimated,
  fields: issue.fields.map((field: JiraIssue["fields"][number]) => ({ ...field })),
});

const groupIssuesBySprint = (issues: JiraIssueWithSprint[], category: "current" | "future"): JiraIssueGroup[] => {
  const grouped = new Map<string, JiraIssueGroup>();

  for (const issue of issues) {
    const groupId = issue.sprint ? `${category}-${issue.sprint.id}` : `${category}-unspecified`;
    const existing = grouped.get(groupId);
    if (existing) {
      existing.issues.push(withoutSprint(issue));
      continue;
    }

    grouped.set(groupId, {
      id: groupId,
      name: issue.sprint?.name ?? (category === "current" ? "Current sprint" : "Future sprint"),
      category,
      sprint: issue.sprint,
      issues: [withoutSprint(issue)],
    });
  }

  return [...grouped.values()].sort((a, b) => {
    const aStartDate = toDateMs(a.sprint?.startDate ?? null);
    const bStartDate = toDateMs(b.sprint?.startDate ?? null);
    if (aStartDate !== bStartDate) {
      return aStartDate - bStartDate;
    }
    return a.name.localeCompare(b.name);
  });
};

const fetchAllSearchIssues = async (
  jiraOrigin: string,
  authorization: string,
  jql: string,
  quickFilterFieldIds: string[],
): Promise<{ ok: true; issues: JiraIssueWithSprint[] } | JiraActionError> => {
  let nextPageToken: string | null = null;
  let page = 0;
  const issues: JiraIssueWithSprint[] = [];

  while (page < jiraMaxPages) {
    let response: Response;
    let payload: unknown;
    try {
      response = await fetch(`${jiraOrigin}/rest/api/3/search/jql`, {
        method: "POST",
        headers: jiraRequestHeaders(authorization),
        body: JSON.stringify({
          jql,
          maxResults: jiraPageSize,
          fields: ["*all"],
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      });

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } catch {
      return { ok: false, message: "Could not reach Jira while loading board issues." };
    }

    if (!response.ok) {
      return { ok: false, message: jiraErrorMessage(response.status, payload) };
    }

    const pageIssues = mapJiraIssues(jiraOrigin, payload, quickFilterFieldIds);
    if (!pageIssues) {
      return { ok: false, message: "Unexpected Jira issue response format." };
    }

    issues.push(...pageIssues);

    const returnedNextPageToken = isRecord(payload) && typeof payload.nextPageToken === "string" ? payload.nextPageToken : null;
    const isLastPage = isRecord(payload) && payload.isLast === true;
    if (pageIssues.length === 0) {
      break;
    }
    if (isLastPage || !returnedNextPageToken) {
      break;
    }

    nextPageToken = returnedNextPageToken;
    page += 1;
  }

  return { ok: true, issues };
};

const isAllowedJiraIssueType = (issueType: string): boolean => jiraAllowedIssueTypes.has(issueType.trim().toLowerCase());
const isAllowedJiraIssueStatus = (status: string): boolean => jiraAllowedIssueStatuses.has(normalizeComparableText(status));

const splitQuickFilterValues = (value: string): string[] => {
  if (!value.trim()) {
    return [];
  }

  const unique = new Map<string, string>();
  for (const part of value.split(/[\n,]/g)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (!unique.has(normalized)) {
      unique.set(normalized, trimmed);
    }
  }

  return [...unique.values()];
};

const buildQuickFilterData = (
  groups: JiraIssueGroup[],
  quickFilterFieldIds: string[],
): NonNullable<JiraIssueResult["quickFilters"]> => {
  const fieldLabels = new Map<string, string>();
  const countsByField = new Map<string, Map<string, { value: string; count: number }>>();

  for (const fieldId of quickFilterFieldIds) {
    fieldLabels.set(fieldId, fieldId);
    countsByField.set(fieldId, new Map());
  }

  for (const group of groups) {
    for (const issue of group.issues) {
      for (const fieldId of quickFilterFieldIds) {
        const issueField = issue.fields.find((field) => normalizeQuickFilterFieldId(field.id) === fieldId);
        if (!issueField) {
          continue;
        }

        if (issueField.label.trim()) {
          fieldLabels.set(fieldId, issueField.label.trim());
        }

        const fieldCounts = countsByField.get(fieldId);
        if (!fieldCounts) {
          continue;
        }

        for (const filterValue of splitQuickFilterValues(issueField.value)) {
          const key = filterValue.toLowerCase();
          const existing = fieldCounts.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            fieldCounts.set(key, { value: filterValue, count: 1 });
          }
        }
      }
    }
  }

  const badges = quickFilterFieldIds
    .flatMap((fieldId) => {
      const fieldLabel = fieldLabels.get(fieldId) ?? fieldId;
      const values = countsByField.get(fieldId);
      if (!values) {
        return [];
      }

      return [...values.values()].map((entry) => ({
        id: `${fieldId}:${entry.value.toLowerCase()}`,
        fieldId,
        fieldLabel,
        value: entry.value,
        count: entry.count,
      }));
    })
    .sort((a, b) => {
      if (a.fieldLabel !== b.fieldLabel) {
        return a.fieldLabel.localeCompare(b.fieldLabel);
      }
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.value.localeCompare(b.value);
    });

  return {
    fields: quickFilterFieldIds.map((fieldId) => ({
      id: fieldId,
      label: fieldLabels.get(fieldId) ?? fieldId,
    })),
    badges,
  };
};

export const loadIssues = action({
  args: {
    baseUrl: v.string(),
    email: v.string(),
    apiToken: v.string(),
    ticketPrefix: v.string(),
    participantId: v.optional(v.string()),
    quickFilterFieldIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ ok: true; jiraIssues: JiraIssueResult } | JiraActionError> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        message:
          "You are signed into the UI, but Convex did not receive a Clerk token. Configure Clerk JWT template 'convex' and verify CLERK_JWT_ISSUER_DOMAIN in Convex.",
      };
    }

    const jiraOrigin = normalizeJiraOrigin(args.baseUrl);
    const email = args.email.trim();
    const apiToken = args.apiToken.trim();
    const ticketPrefix = normalizeTicketPrefix(args.ticketPrefix);
    const quickFilterFieldIds = parseQuickFilterFieldIds(args.quickFilterFieldIds);

    if (!jiraOrigin || !email || !apiToken || !ticketPrefix) {
      return { ok: false, message: "Jira URL, email, API token, and ticket prefix are required." };
    }

    const authorization = encodeBase64(`${email}:${apiToken}`);
    const projectClause = `project = "${ticketPrefix}"`;
    const currentSprintJql = `${projectClause} AND sprint in openSprints() ORDER BY Rank ASC, created ASC`;
    const nextSprintJql = `${projectClause} AND sprint in futureSprints() ORDER BY Rank ASC, created ASC`;
    const backlogJql = `${projectClause} AND sprint is EMPTY ORDER BY Rank ASC, created ASC`;

    const [currentIssuesResult, nextIssuesResult, backlogIssuesResult] = await Promise.all([
      fetchAllSearchIssues(jiraOrigin, authorization, currentSprintJql, quickFilterFieldIds),
      fetchAllSearchIssues(jiraOrigin, authorization, nextSprintJql, quickFilterFieldIds),
      fetchAllSearchIssues(jiraOrigin, authorization, backlogJql, quickFilterFieldIds),
    ]);

    if (!currentIssuesResult.ok) {
      return currentIssuesResult;
    }
    if (!nextIssuesResult.ok) {
      return nextIssuesResult;
    }
    if (!backlogIssuesResult.ok) {
      return backlogIssuesResult;
    }

    const filteredCurrentIssues = currentIssuesResult.issues.filter(
      (issue: JiraIssueWithSprint) => isAllowedJiraIssueType(issue.issueType) && isAllowedJiraIssueStatus(issue.status),
    );
    const filteredNextIssues = nextIssuesResult.issues.filter(
      (issue: JiraIssueWithSprint) => isAllowedJiraIssueType(issue.issueType) && isAllowedJiraIssueStatus(issue.status),
    );
    const filteredBacklogIssues = backlogIssuesResult.issues.filter(
      (issue: JiraIssueWithSprint) => isAllowedJiraIssueType(issue.issueType) && isAllowedJiraIssueStatus(issue.status),
    );

    const groups: JiraIssueGroup[] = [
      ...groupIssuesBySprint(filteredCurrentIssues, "current"),
      ...groupIssuesBySprint(filteredNextIssues, "future"),
    ];
    if (filteredBacklogIssues.length > 0) {
      groups.push({
        id: "backlog",
        name: "Backlog / No sprint",
        category: "backlog",
        sprint: null,
        issues: filteredBacklogIssues.map(withoutSprint),
      });
    }

    const quickFilters = buildQuickFilterData(groups, quickFilterFieldIds);
    const jiraIssues: JiraIssueResult = { groups, quickFilters };

    const jiraSubtasksByIssueId: Record<string, IssueSubtask[]> = {};
    const registerIssueSubtasks = (issue: JiraIssueWithSprint): void => {
      const issueId = normalizeIssueId(issue.id);
      if (!issueId) {
        return;
      }

      jiraSubtasksByIssueId[issueId] = issue.subtasks.map((subtask: IssueSubtask) => ({ ...subtask })).slice(0, 100);
    };

    for (const issue of filteredCurrentIssues) {
      registerIssueSubtasks(issue);
    }
    for (const issue of filteredNextIssues) {
      registerIssueSubtasks(issue);
    }
    for (const issue of filteredBacklogIssues) {
      registerIssueSubtasks(issue);
    }

    const participantId = normalizeParticipantId(args.participantId);
    const stored = await ctx.runMutation(api.room.setJiraIssues, {
      participantId,
      jiraIssues,
      jiraSubtasksByIssueId,
      jiraConnection: {
        baseUrl: jiraOrigin,
        email,
        apiToken,
        ticketPrefix,
        quickFilterFieldIds,
        ownerTokenIdentifier: identity.tokenIdentifier,
        ownerName: identity.name ?? identity.email ?? "Facilitator",
        updatedAt: new Date().toISOString(),
      },
    });

    if (!stored || typeof stored !== "object" || stored.ok !== true) {
      return { ok: false, message: "Failed to store Jira tickets in room state." };
    }

    return { ok: true, jiraIssues };
  },
});

const normalizeIssueKey = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase().slice(0, 80) : "";

const normalizeJiraFieldId = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .slice(0, 120)
    .replace(/[^a-zA-Z0-9_.-]/g, "");
};

const normalizeFieldValue = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\r\n/g, "\n").slice(0, 16000) : "";

const toAdf = (value: string): Record<string, unknown> => {
  const lines = value.split("\n");
  const content = lines.map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));

  return {
    version: 1,
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
};

const toJiraFieldValue = (fieldId: string, value: string): unknown => {
  if (fieldId.toLowerCase() === "description") {
    return toAdf(value);
  }
  return value;
};

export const syncIssueField = action({
  args: {
    participantId: v.optional(v.string()),
    issueId: v.string(),
    issueKey: v.string(),
    fieldId: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true } | JiraActionError> => {
    const syncContext = await ctx.runQuery(api.room.getJiraSyncContext, {
      participantId: normalizeParticipantId(args.participantId),
    });
    if (!syncContext) {
      return { ok: false, message: "Only the signed-in orchestrator can sync Jira changes." };
    }

    const jiraOrigin = normalizeJiraOrigin(syncContext.baseUrl);
    const email = syncContext.email.trim();
    const apiToken = syncContext.apiToken.trim();
    const issueId = normalizeIssueId(args.issueId);
    const issueKey = normalizeIssueKey(args.issueKey);
    const fieldId = normalizeJiraFieldId(args.fieldId);
    const value = normalizeFieldValue(args.value);

    if (!jiraOrigin || !email || !apiToken || !issueId || !issueKey || !fieldId) {
      return {
        ok: false,
        message: "Stored Jira connection, issue, and field details are required.",
      };
    }

    await ctx.runMutation(api.room.markIssueFieldSyncing, {
      issueId,
      issueKey,
      issueUrl: `${jiraOrigin}/browse/${encodeURIComponent(issueKey)}`,
      fieldId,
      label: fieldId,
      value,
    });

    const authorization = encodeBase64(`${email}:${apiToken}`);
    let response: Response;
    let payload: unknown;

    try {
      response = await fetch(`${jiraOrigin}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
        method: "PUT",
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            [fieldId]: toJiraFieldValue(fieldId, value),
          },
        }),
      });

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } catch {
      await ctx.runMutation(api.room.markIssueFieldSyncResult, {
        issueId,
        issueKey,
        issueUrl: `${jiraOrigin}/browse/${encodeURIComponent(issueKey)}`,
        fieldId,
        label: fieldId,
        value,
        ok: false,
        failureMessage: "Could not reach Jira while syncing field updates.",
      });
      return { ok: false, message: "Could not reach Jira while syncing field updates." };
    }

    if (!response.ok) {
      const message = jiraErrorMessage(response.status, payload);
      await ctx.runMutation(api.room.markIssueFieldSyncResult, {
        issueId,
        issueKey,
        issueUrl: `${jiraOrigin}/browse/${encodeURIComponent(issueKey)}`,
        fieldId,
        label: fieldId,
        value,
        ok: false,
        failureMessage: message,
      });
      return { ok: false, message };
    }

    await ctx.runMutation(api.room.markIssueFieldSyncResult, {
      issueId,
      issueKey,
      issueUrl: `${jiraOrigin}/browse/${encodeURIComponent(issueKey)}`,
      fieldId,
      label: fieldId,
      value,
      ok: true,
    });

    return { ok: true };
  },
});
