import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

type IdentityLike = {
  tokenIdentifier: string;
  name?: string | null;
  email?: string | null;
  subject?: string | null;
};

type JiraAccessibleSite = {
  id: string;
  name: string;
  url: string;
};

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const normalizeOwnerName = (identity: IdentityLike): string => {
  const candidate = typeof identity.name === "string" && identity.name.trim()
    ? identity.name
    : typeof identity.email === "string" && identity.email.trim()
      ? identity.email
      : "Facilitator";
  return candidate.trim().slice(0, 120);
};

export const getIdentityUserId = (identity: IdentityLike): string => {
  if (typeof identity.subject === "string" && identity.subject.trim()) {
    return identity.subject.trim().slice(0, 200);
  }
  return identity.tokenIdentifier.trim().slice(0, 200);
};

const toBase64Url = (value: Uint8Array): string =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const createRandomToken = (size: number): string => toBase64Url(crypto.getRandomValues(new Uint8Array(size)));

const createCodeChallenge = async (verifier: string): Promise<string> => {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
};

const getOAuthConfig = (): { clientId: string; clientSecret: string; callbackUrl: string; scopes: string[] } | null => {
  const clientId = process.env.ATLASSIAN_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.ATLASSIAN_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const callbackBase =
    process.env.CONVEX_SITE_URL?.trim() ??
    process.env.VITE_CONVEX_SITE_URL?.trim() ??
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim() ??
    process.env.VITE_CONVEX_URL?.trim().replace(/\.cloud$/i, ".site") ??
    "";
  const scopes = (process.env.ATLASSIAN_OAUTH_SCOPES?.trim() || "offline_access read:jira-work write:jira-work")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (!clientId || !clientSecret || !callbackBase || scopes.length === 0) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    callbackUrl: `${callbackBase.replace(/\/$/, "")}/jira/oauth/callback`,
    scopes,
  };
};

const normalizeSiteUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  try {
    return new URL(value.trim()).origin;
  } catch {
    return "";
  }
};

const normalizeAccessibleSites = (value: unknown): JiraAccessibleSite[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const sites = new Map<string, JiraAccessibleSite>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = typeof entry.id === "string" ? entry.id.trim().slice(0, 120) : "";
    const url = normalizeSiteUrl(entry.url);
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 120) : url;
    if (!id || !url || sites.has(id)) {
      continue;
    }

    const scopes = Array.isArray(entry.scopes) ? entry.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    const looksLikeJira = scopes.some((scope) => scope.toLowerCase().includes("jira")) || /atlassian\.net$/i.test(new URL(url).hostname);
    if (!looksLikeJira && scopes.length > 0) {
      continue;
    }

    sites.set(id, { id, name, url });
  }

  return [...sites.values()];
};

export const getConnectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { status: "signed_out" as const };
    }

    const ownerUserId = getIdentityUserId(identity);
    const connection = await ctx.db
      .query("jiraConnections")
      .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", ownerUserId))
      .first();

    if (!connection) {
      return { status: "disconnected" as const };
    }

    const availableSites = normalizeAccessibleSites(connection.availableSites);
    const hasSelectedSite = typeof connection.cloudId === "string" && connection.cloudId.trim() && typeof connection.siteUrl === "string" && connection.siteUrl.trim();

    return {
      status: hasSelectedSite ? ("connected" as const) : ("needs_site_selection" as const),
      connectionId: String(connection._id),
      siteName: typeof connection.siteName === "string" ? connection.siteName : null,
      siteUrl: typeof connection.siteUrl === "string" ? connection.siteUrl : null,
      updatedAt: typeof connection.updatedAt === "string" ? connection.updatedAt : null,
      lastError: typeof connection.lastError === "string" ? connection.lastError : null,
      availableSites,
    };
  },
});

export const beginOAuth = action({
  args: {
    returnTo: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true; authorizeUrl: string } | { ok: false; message: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { ok: false, message: "Sign in before connecting Jira." };
    }

    const config = getOAuthConfig();
    if (!config) {
      return { ok: false, message: "Missing Atlassian OAuth environment variables." };
    }

    let returnTo = args.returnTo.trim();
    try {
      returnTo = new URL(returnTo).toString();
    } catch {
      return { ok: false, message: "Dashboard return URL is invalid." };
    }

    const state = createRandomToken(24);
    const codeVerifier = createRandomToken(48);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const ownerUserId = getIdentityUserId(identity);
    const ownerName = normalizeOwnerName(identity);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString();

    await ctx.runMutation(api.jiraAuth.storeOAuthState, {
      state,
      ownerUserId,
      ownerName,
      returnTo,
      codeVerifier,
      createdAt: now.toISOString(),
      expiresAt,
    });

    const authorizeUrl = new URL("https://auth.atlassian.com/authorize");
    authorizeUrl.searchParams.set("audience", "api.atlassian.com");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
    authorizeUrl.searchParams.set("redirect_uri", config.callbackUrl);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("prompt", "consent");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return { ok: true, authorizeUrl: authorizeUrl.toString() };
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<{ ok: true } | { ok: false; message: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { ok: false, message: "Sign in before disconnecting Jira." };
    }

    const ownerUserId = getIdentityUserId(identity);
    const connection = await ctx.runQuery(internal.jiraAuth.getConnectionForCurrentUserInternal, { ownerUserId });
    if (!connection) {
      return { ok: true };
    }

    const config = getOAuthConfig();
    if (config) {
      try {
        await fetch("https://auth.atlassian.com/oauth/revoke", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: connection.refreshToken || connection.accessToken }),
        });
      } catch {
      }
    }

    await ctx.runMutation(internal.jiraAuth.deleteConnectionForCurrentUserInternal, { ownerUserId });
    await ctx.runMutation(api.room.clearJiraConnectionForOwner, {});
    return { ok: true };
  },
});

export const selectSite = mutation({
  args: {
    siteId: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; message: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { ok: false, message: "Sign in before selecting a Jira site." };
    }

    const ownerUserId = getIdentityUserId(identity);
    const connection = await ctx.db
      .query("jiraConnections")
      .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", ownerUserId))
      .first();
    if (!connection) {
      return { ok: false, message: "Connect Jira before selecting a site." };
    }

    const availableSites = normalizeAccessibleSites(connection.availableSites);
    const nextSite = availableSites.find((site) => site.id === args.siteId.trim());
    if (!nextSite) {
      return { ok: false, message: "Selected Jira site is no longer available." };
    }

    await ctx.db.patch(connection._id, {
      cloudId: nextSite.id,
      siteUrl: nextSite.url,
      siteName: nextSite.name,
      updatedAt: new Date().toISOString(),
      lastError: null,
    });

    return { ok: true };
  },
});

export const storeOAuthState = mutation({
  args: {
    state: v.string(),
    ownerUserId: v.string(),
    ownerName: v.string(),
    returnTo: v.string(),
    codeVerifier: v.string(),
    createdAt: v.string(),
    expiresAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jiraOAuthStates")
      .withIndex("by_state", (query) => query.eq("state", args.state))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    await ctx.db.insert("jiraOAuthStates", args);
    return { ok: true };
  },
});

export const getOAuthStateInternal = internalQuery({
  args: {
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("jiraOAuthStates")
      .withIndex("by_state", (query) => query.eq("state", args.state))
      .first();
    return state ?? null;
  },
});

export const consumeOAuthStateInternal = internalMutation({
  args: {
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jiraOAuthStates")
      .withIndex("by_state", (query) => query.eq("state", args.state))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true };
  },
});

export const upsertConnectionInternal = internalMutation({
  args: {
    ownerUserId: v.string(),
    ownerName: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.string(),
    availableSites: v.array(v.object({ id: v.string(), name: v.string(), url: v.string() })),
    cloudId: v.union(v.string(), v.null()),
    siteUrl: v.union(v.string(), v.null()),
    siteName: v.union(v.string(), v.null()),
    lastError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jiraConnections")
      .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", args.ownerUserId))
      .first();

    const payload = {
      ownerUserId: args.ownerUserId,
      ownerName: args.ownerName,
      siteUrl: args.siteUrl,
      siteName: args.siteName,
      cloudId: args.cloudId,
      availableSites: args.availableSites,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      lastError: args.lastError,
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { connectionId: existing._id };
    }

    const connectionId = await ctx.db.insert("jiraConnections", payload);
    return { connectionId };
  },
});

export const updateConnectionTokensInternal = internalMutation({
  args: {
    connectionId: v.id("jiraConnections"),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.string(),
    scopes: v.array(v.string()),
    lastError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      scopes: args.scopes,
      lastError: args.lastError,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  },
});

export const getConnectionForCurrentUserInternal = internalQuery({
  args: {
    ownerUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("jiraConnections")
      .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", args.ownerUserId))
      .first();
    return connection ?? null;
  },
});

export const getConnectionByIdInternal = internalQuery({
  args: {
    connectionId: v.id("jiraConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    return connection ?? null;
  },
});

export const deleteConnectionForCurrentUserInternal = internalMutation({
  args: {
    ownerUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jiraConnections")
      .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", args.ownerUserId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true };
  },
});

export const getOAuthCallbackConfigInternal = internalQuery({
  args: {},
  handler: async () => getOAuthConfig(),
});

export const normalizeAccessibleSitesInternal = internalQuery({
  args: {
    resources: v.any(),
  },
  handler: async (_ctx, args) => normalizeAccessibleSites(args.resources),
});
