import { spawnSync } from 'node:child_process'

const envName = process.env.VERCEL_ENV?.trim() ?? ''
const previewName = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? ''
const clerkFrontendApiUrl = process.env.CLERK_FRONTEND_API_URL?.trim() ?? ''

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  })

  if (typeof result.status === 'number') {
    if (result.status !== 0) {
      process.exit(result.status)
    }
    return
  }

  console.error(`Failed to run ${command}.`)
  process.exit(1)
}

if (envName === 'preview') {
  if (!previewName) {
    console.error('Missing VERCEL_GIT_COMMIT_REF for Convex preview deploy.')
    process.exit(1)
  }

  if (!clerkFrontendApiUrl) {
    console.error('Missing CLERK_FRONTEND_API_URL for Convex preview deploy.')
    process.exit(1)
  }

  run('bunx', ['convex', 'env', 'set', '--preview-name', previewName, 'CLERK_FRONTEND_API_URL', clerkFrontendApiUrl])
  run('bunx', [
    'convex',
    'deploy',
    '--preview-create',
    previewName,
    '--cmd',
    'bun run build',
    '--cmd-url-env-var-name',
    'VITE_CONVEX_URL',
  ])
  process.exit(0)
}

run('bunx', ['convex', 'deploy', '--cmd', 'bun run build', '--cmd-url-env-var-name', 'VITE_CONVEX_URL'])
