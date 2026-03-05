import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Geist, Geist_Mono } from 'next/font/google'
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import { Button, buttonVariants } from '../components/ui/button'
import ThemeToggle from '../components/ThemeToggle'
import '../src/app.css'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'Scrummer',
  description: 'Shared planning poker with Jira ticket workspace',
}

type RootLayoutProps = {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-neutral-50 text-neutral-900 antialiased`}>
        <ClerkProvider>
          <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/85 backdrop-blur">
            <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4">
              <nav className="inline-flex items-center gap-2">
                <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Planning room
                </Link>
                <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Dashboard
                </Link>
              </nav>
              <div className="inline-flex items-center gap-2">
                <ThemeToggle />
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <Button variant="ghost" size="sm" type="button">
                      Sign in
                    </Button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <Button size="sm" type="button">
                      Sign up
                    </Button>
                  </SignUpButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px]">{children}</main>
        </ClerkProvider>
      </body>
    </html>
  )
}
