import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

type LegalSection = {
  title: string;
  body: ReactNode;
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
};

const legalLinks = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/support", label: "Support" },
] as const;

export default function LegalPage({ eyebrow, title, summary, sections }: LegalPageProps) {
  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--color-bg)" }}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div
          className="rounded-3xl border p-6 sm:p-8"
          style={{
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]">
            <span style={{ color: "var(--color-accent)" }}>{eyebrow}</span>
            <span style={{ color: "var(--color-text-tertiary)" }}>Scrummr by paradoxon</span>
          </div>

          <div className="mb-8 max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: "var(--color-text-primary)" }}>
              {title}
            </h1>
            <div className="mt-4 text-sm leading-7 sm:text-[15px]" style={{ color: "var(--color-text-secondary)" }}>
              {summary}
            </div>
          </div>

          <div className="mb-8 flex flex-wrap gap-2">
            {legalLinks.map((entry) => (
              <Link
                key={entry.to}
                to={entry.to}
                className="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-accent-subtle)]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {entry.label}
              </Link>
            ))}
          </div>

          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {section.title}
                </h2>
                <div className="mt-3 space-y-3 text-sm leading-7 sm:text-[15px]" style={{ color: "var(--color-text-secondary)" }}>
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
