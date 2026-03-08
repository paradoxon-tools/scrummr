import { createFileRoute, Link } from "@tanstack/react-router";
import LegalPage from "../../components/legal/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: "Terms of Service | Scrummr" }],
  }),
  component: TermsRoute,
});

function TermsRoute() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms of Service"
      summary={
        <>
          <p>Effective date: March 8, 2026.</p>
          <p>
            These Terms of Service govern your use of Scrummr, a shared planning poker and Jira collaboration tool
            operated by paradoxon.
          </p>
        </>
      }
      sections={[
        {
          title: "Use of the service",
          body: (
            <>
              <p>
                You may use Scrummr only for lawful internal collaboration and planning activities. You are responsible
                for your own Jira workspace permissions, the data you choose to load into Scrummr, and the actions you
                authorize through your Atlassian account.
              </p>
            </>
          ),
        },
        {
          title: "Account and access",
          body: (
            <>
              <p>
                Some features require authentication through Clerk and Jira authorization through Atlassian OAuth.
                Facilitators are responsible for maintaining control of their accounts and for disconnecting integrations
                that should no longer have access.
              </p>
            </>
          ),
        },
        {
          title: "Customer data",
          body: (
            <>
              <p>
                You retain responsibility for the Jira and collaboration data you make available through Scrummr. You
                represent that you have the necessary rights and permissions to use that data with the service.
              </p>
            </>
          ),
        },
        {
          title: "Acceptable use restrictions",
          body: (
            <>
              <p>
                You may not use Scrummr to violate laws, infringe others&apos; rights, probe or disrupt the service,
                attempt unauthorized access, or misuse Atlassian APIs beyond the permissions granted through the normal
                integration flow.
              </p>
            </>
          ),
        },
        {
          title: "Availability and changes",
          body: (
            <>
              <p>
                Scrummr is provided on an as-available basis. We may update, suspend, or remove features at any time,
                including Jira integration behavior, when required for maintenance, security, or platform changes.
              </p>
            </>
          ),
        },
        {
          title: "Disclaimers and liability",
          body: (
            <>
              <p>
                Scrummr is provided without warranties of any kind to the maximum extent permitted by law. To the same
                extent, paradoxon is not liable for indirect, incidental, special, consequential, or exemplary damages,
                or for loss of data, profits, or business opportunity arising from use of the service.
              </p>
            </>
          ),
        },
        {
          title: "Contact",
          body: (
            <>
              <p>
                Questions about these terms can be directed through the <Link to="/support" className="underline">support page</Link>.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
