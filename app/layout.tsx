import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
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
          <header style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', padding: '0.75rem 1rem' }}>
            <Show when="signed-out">
              <SignInButton />
              <SignUpButton />
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
