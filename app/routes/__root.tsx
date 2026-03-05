import { ClerkProvider, UserButton, useUser } from "@clerk/tanstack-react-start";
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import ThemeToggle from "../../components/ThemeToggle";
import { buttonVariants } from "../../components/ui/button";
import { ConvexClientProvider } from "../../src/lib/convex";
import appCss from "../../src/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Scrummer" },
      { name: "description", content: "Shared planning poker with Jira ticket workspace" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
    <>
      <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4">
          <nav className="inline-flex items-center gap-2">
            <Link to="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Planning room
            </Link>
            <Link to="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Dashboard
            </Link>
          </nav>
          <div className="inline-flex items-center gap-2">
            <ThemeToggle />
            {isSignedIn ? (
              <UserButton />
            ) : (
              <>
                <Link to="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Sign in
                </Link>
                <Link to="/sign-up" className={buttonVariants({ size: "sm" })}>
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px]">{children}</main>
    </>
  );
}
