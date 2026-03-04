import { NextResponse } from 'next/server'

type JiraSyncPayload = {
  baseUrl?: string
  email?: string
  apiToken?: string
  issueKey?: string
  fieldId?: string
  value?: string
}

const ISSUE_KEY_MAX_LENGTH = 80
const FIELD_ID_MAX_LENGTH = 120
const FIELD_VALUE_MAX_LENGTH = 16000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const normalizeJiraOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (!parsed.hostname) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

const normalizeIssueKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase().slice(0, ISSUE_KEY_MAX_LENGTH) : ''

const normalizeJiraFieldId = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .trim()
    .slice(0, FIELD_ID_MAX_LENGTH)
    .replace(/[^a-zA-Z0-9_.-]/g, '')
}

const normalizeFieldValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').slice(0, FIELD_VALUE_MAX_LENGTH) : ''

const toAdf = (value: string): Record<string, unknown> => {
  const lines = value.split('\n')
  const content = lines.map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }))

  return {
    version: 1,
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
  }
}

const toJiraFieldValue = (fieldId: string, value: string): unknown => {
  if (fieldId.toLowerCase() === 'description') {
    return toAdf(value)
  }
  return value
}

const jiraErrorMessage = (status: number, payload: unknown): string => {
  if (isRecord(payload)) {
    if (Array.isArray(payload.errorMessages) && typeof payload.errorMessages[0] === 'string') {
      return payload.errorMessages[0]
    }
    if (typeof payload.message === 'string') {
      return payload.message
    }
  }

  return `Jira returned HTTP ${status}.`
}

export async function POST(request: Request) {
  let body: JiraSyncPayload
  try {
    body = (await request.json()) as JiraSyncPayload
  } catch {
    return NextResponse.json({ message: 'Invalid JSON payload.' }, { status: 400 })
  }

  const jiraOrigin = normalizeJiraOrigin(body.baseUrl)
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : ''
  const issueKey = normalizeIssueKey(body.issueKey)
  const fieldId = normalizeJiraFieldId(body.fieldId)
  const value = normalizeFieldValue(body.value)

  if (!jiraOrigin || !email || !apiToken || !issueKey || !fieldId) {
    return NextResponse.json(
      { message: 'Jira URL, email, API token, issue key, and field id are required.' },
      { status: 400 },
    )
  }

  const authorization = Buffer.from(`${email}:${apiToken}`).toString('base64')
  let response: Response
  let payload: unknown

  try {
    response = await fetch(`${jiraOrigin}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          [fieldId]: toJiraFieldValue(fieldId, value),
        },
      }),
    })

    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  } catch {
    return NextResponse.json({ message: 'Could not reach Jira while syncing field updates.' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ message: jiraErrorMessage(response.status, payload) }, { status: response.status })
  }

  return NextResponse.json({ ok: true })
}
