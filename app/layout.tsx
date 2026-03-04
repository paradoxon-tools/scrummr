import type { Metadata } from 'next'
import type { ReactNode } from 'react'
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
      <body>{children}</body>
    </html>
  )
}
