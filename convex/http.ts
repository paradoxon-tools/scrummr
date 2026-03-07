import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

const appendStatus = (returnTo: string, status: string, message?: string): string => {
  const url = new URL(returnTo);
  url.searchParams.set("jira", status);
  if (message) {
    url.searchParams.set("jira_message", message.slice(0, 240));
  } else {
    url.searchParams.delete("jira_message");
  }
  return url.toString();
};

http.route({
  path: "/jira/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const oauthError = url.searchParams.get("error")?.trim() ?? "";

    if (!state) {
      return new Response("Missing Jira OAuth state.", { status: 400 });
    }

    const storedState = await ctx.runQuery(internal.jiraAuth.getOAuthStateInternal, { state });
    if (!storedState) {
      return new Response("Jira OAuth state is invalid or expired.", { status: 400 });
    }

    const redirect = (status: string, message?: string) =>
      Response.redirect(appendStatus(storedState.returnTo, status, message), 302);

    try {
      if (oauthError) {
        return redirect("error", oauthError.replace(/_/g, " "));
      }

      if (!code) {
        return redirect("error", "Missing Jira authorization code.");
      }

      const expiresAtMs = Date.parse(storedState.expiresAt);
      if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
        return redirect("error", "Jira authorization expired. Try connecting again.");
      }

      const config = await ctx.runQuery(internal.jiraAuth.getOAuthCallbackConfigInternal, {});
      if (!config) {
        return redirect("error", "Missing Atlassian OAuth environment variables.");
      }

      const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.callbackUrl,
          code_verifier: storedState.codeVerifier,
        }),
      });
      const tokenPayload = await tokenResponse.json().catch(() => null);
      if (!tokenResponse.ok || !tokenPayload || typeof tokenPayload.access_token !== "string" || typeof tokenPayload.refresh_token !== "string") {
        return redirect("error", "Could not exchange Jira authorization for tokens.");
      }

      const resourcesResponse = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
          Accept: "application/json",
        },
      });
      const resourcesPayload = await resourcesResponse.json().catch(() => null);
      if (!resourcesResponse.ok) {
        return redirect("error", "Could not load Jira site access.");
      }

      const availableSites = await ctx.runQuery(internal.jiraAuth.normalizeAccessibleSitesInternal, {
        resources: resourcesPayload,
      });
      if (availableSites.length === 0) {
        return redirect("error", "No Jira Cloud sites were available for this Atlassian account.");
      }

      const selectedSite = availableSites.length === 1 ? availableSites[0] : null;
      const expiresInSeconds = typeof tokenPayload.expires_in === "number" && Number.isFinite(tokenPayload.expires_in)
        ? tokenPayload.expires_in
        : 3600;
      const scopes = typeof tokenPayload.scope === "string"
        ? tokenPayload.scope.split(/\s+/).map((scope: string) => scope.trim()).filter(Boolean)
        : config.scopes;

      await ctx.runMutation(internal.jiraAuth.upsertConnectionInternal, {
        ownerUserId: storedState.ownerUserId,
        ownerName: storedState.ownerName,
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        scopes,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        availableSites,
        cloudId: selectedSite?.id ?? null,
        siteUrl: selectedSite?.url ?? null,
        siteName: selectedSite?.name ?? null,
        lastError: null,
      });

      return redirect(selectedSite ? "connected" : "site_selection");
    } finally {
      await ctx.runMutation(internal.jiraAuth.consumeOAuthStateInternal, { state });
    }
  }),
});

export default http;
