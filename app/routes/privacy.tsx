import { createFileRoute, Link } from "@tanstack/react-router";
import LegalPage from "../../components/legal/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy Policy | Scrummr" }],
  }),
  component: PrivacyRoute,
});

function PrivacyRoute() {
  return (
    <LegalPage
      eyebrow="Privacy Policy"
      title="Privacy Policy"
      summary={
        <>
          <p>Effective date: March 8, 2026.</p>
          <p>
            This Privacy Policy explains how paradoxon collects, uses, stores, and shares information when you use
            Scrummr, including its Jira Cloud integration.
          </p>
        </>
      }
      sections={[
        {
          title: "Information we collect",
          body: (
            <>
              <p>
                Scrummr processes account and collaboration data needed to run shared planning sessions. This can
                include your display name, your authentication identifier from Clerk, your Jira-connected facilitator
                identity, Jira issue content loaded into a room, and edits made during a session.
              </p>
              <p>
                When Jira is connected, OAuth access tokens and refresh tokens are stored server-side in Convex. The
                browser does not store those secrets.
              </p>
            </>
          ),
        },
        {
          title: "How we use information",
          body: (
            <>
              <p>
                We use information to authenticate facilitators, connect to Jira on the facilitator&apos;s behalf, load
                issues into shared planning rooms, sync facilitator-approved issue field updates back to Jira, and keep
                collaborative room state consistent for participants.
              </p>
              <p>
                We do not use Jira data for advertising, data brokerage, or unrelated profiling.
              </p>
            </>
          ),
        },
        {
          title: "What is stored",
          body: (
            <>
              <p>
                Scrummr stores Jira OAuth credentials server-side, room state needed for active sessions, non-secret
                Jira metadata such as selected site and ticket prefix, and local browser preferences such as theme and
                dashboard session settings.
              </p>
              <p>
                Loaded Jira issue data may include issue summaries, descriptions, assignees, reporters, priorities,
                subtasks, and custom field values that are returned by the Jira APIs requested by the facilitator.
              </p>
            </>
          ),
        },
        {
          title: "Sharing and disclosures",
          body: (
            <>
              <p>
                Jira issue data loaded for a planning session is shared with participants in that room. Service
                providers used to operate Scrummr, including hosting, authentication, and database infrastructure, may
                process data on our behalf.
              </p>
              <p>
                We may also disclose information when required to comply with law, enforce our terms, or protect the
                security of the service and its users.
              </p>
            </>
          ),
        },
        {
          title: "Retention",
          body: (
            <>
              <p>
                We retain information for as long as needed to operate Scrummr, maintain security, resolve disputes,
                and comply with legal obligations. Jira OAuth tokens remain stored until the facilitator disconnects
                Jira, the credentials expire or are revoked, or they are otherwise deleted from the service.
              </p>
            </>
          ),
        },
        {
          title: "Your choices",
          body: (
            <>
              <p>
                Facilitators can disconnect Jira at any time. If you want data removed or have questions about data
                handling, use the support information on the <Link to="/support" className="underline">support page</Link>.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
