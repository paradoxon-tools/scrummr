import { ClerkProvider, UserButton, useUser } from "@clerk/tanstack-react-start";
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import ThemeToggle from "../../components/ThemeToggle";
import { ConvexClientProvider } from "../../src/lib/convex";
import appCss from "../../src/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Scrummr" },
      { name: "description", content: "Shared planning poker with Jira ticket workspace" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const publishableKey =
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
    import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <RootDocument>{children}</RootDocument>
    </ClerkProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <ConvexClientProvider>
          <AppChrome>{children}</AppChrome>
        </ConvexClientProvider>
        <Scripts />
      </body>
    </html>
  );
}

function AppChrome({ children }: { children: ReactNode }) {
  const { isSignedIn } = useUser();

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b px-4"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div className="flex items-center gap-1">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-[var(--color-accent-subtle)]"
            style={{ color: 'var(--color-text-primary)' }}
          >
            <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" style={{ color: 'var(--color-accent)' }} fill="currentColor">
              <path d="M10 2L3 7v9a2 2 0 002 2h10a2 2 0 002-2V7l-7-5z" opacity="0.15" />
              <path d="M10 2L3 7v9a2 2 0 002 2h10a2 2 0 002-2V7l-7-5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            Scrummr
          </Link>
          <span className="mx-1 text-[var(--color-text-tertiary)]">/</span>
          <Link
            to="/"
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-text-primary)]"
          >
            Room
          </Link>
          <Link
            to="/dashboard"
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-text-primary)]"
          >
            Dashboard
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isSignedIn ? (
            <UserButton />
          ) : (
            <div className="flex items-center gap-1">
              <Link
                to="/sign-in"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-text-primary)]"
              >
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors"
                style={{ background: 'var(--color-accent)' }}
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
