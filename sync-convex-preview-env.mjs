import { spawnSync } from 'node:child_process'

const envName = process.env.VERCEL_ENV?.trim() ?? ''
const previewName = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? ''
const clerkFrontendApiUrl = process.env.CLERK_FRONTEND_API_URL?.trim() ?? ''

if (envName !== 'preview') {
  process.exit(0)
}

if (!previewName) {
  console.error('Missing VERCEL_GIT_COMMIT_REF for Convex preview env sync.')
  process.exit(1)
}

if (!clerkFrontendApiUrl) {
  console.error('Missing CLERK_FRONTEND_API_URL for Convex preview env sync.')
  process.exit(1)
}

const result = spawnSync(
  'bunx',
  ['convex', 'env', 'set', '--preview-name', previewName, 'CLERK_FRONTEND_API_URL', clerkFrontendApiUrl],
  {
    stdio: 'inherit',
    env: process.env,
  },
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}

console.error('Failed to sync CLERK_FRONTEND_API_URL to Convex preview deployment.')
process.exit(1)
