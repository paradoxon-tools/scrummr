import { createFileRoute } from "@tanstack/react-router";
import LegalPage from "../../components/legal/LegalPage";

const repositoryIssuesUrl = "https://github.com/paradoxon-tools/scrummr/issues";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [{ title: "Support | Scrummr" }],
  }),
  component: SupportRoute,
});

function SupportRoute() {
  return (
    <LegalPage
      eyebrow="Support"
      title="Customer Support"
      summary={
        <>
          <p>For support with Scrummr, Jira OAuth setup, or privacy questions, contact paradoxon using the options below.</p>
        </>
      }
      sections={[
        {
          title: "Support channel",
          body: (
            <>
              <p>
                Open a support request at{" "}
                <a href={repositoryIssuesUrl} target="_blank" rel="noreferrer" className="underline">
                  {repositoryIssuesUrl}
                </a>
                .
              </p>
              <p>
                Include the issue you are seeing, the environment you are using, and any relevant Jira or Atlassian
                error messages.
              </p>
            </>
          ),
        },
        {
          title: "Privacy and legal requests",
          body: (
            <>
              <p>
                If your request concerns privacy, data access, or deletion, mention that explicitly in your support
                request so it can be prioritized and routed correctly.
              </p>
            </>
          ),
        },
        {
          title: "Service details",
          body: (
            <>
              <p>Vendor name: paradoxon.</p>
              <p>Product: Scrummr.</p>
            </>
          ),
        },
      ]}
    />
  );
}
