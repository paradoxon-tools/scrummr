import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import ThemeToggle from '../components/ThemeToggle'
import '../src/app.css'

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
      <body>
        <ClerkProvider>
          <header
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 1rem',
            }}
          >
            <nav style={{ display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
              <Link href="/" className="text-button button-link" style={{ padding: '0.42rem 0.62rem', borderStyle: 'solid' }}>
                Planning room
              </Link>
              <Link href="/dashboard" className="secondary button-link" style={{ padding: '0.42rem 0.62rem' }}>
                Dashboard
              </Link>
            </nav>
            <div style={{ display: 'inline-flex', gap: '0.75rem', alignItems: 'center' }}>
              <ThemeToggle />
              <Show when="signed-out">
                <SignInButton />
                <SignUpButton />
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </div>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
