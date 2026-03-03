import {
  ESTIMATE_OPTIONS,
  type ClientEvent,
  type EstimateOption,
  type RoomStateSnapshot,
  type ServerEvent,
} from './src/lib/protocol'

type UserState = {
  name: string
  colorHue: number
  vote: EstimateOption | null
}

type SocketData = {
  id: string
}

const port = Number(Bun.env.WS_PORT ?? 3001)
const allowedVotes = new Set<string>(ESTIMATE_OPTIONS)
const users = new Map<string, UserState>()
const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>()
const decoder = new TextDecoder()

let revealed = false

const hueDistance = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

const pickDistinctHue = (excludeUserId?: string, avoidHue?: number): number => {
  const usedHues = [...users.entries()]
    .filter(([id]) => id !== excludeUserId)
    .map(([, user]) => user.colorHue)

  if (usedHues.length === 0) {
    const randomHue = Math.floor(Math.random() * 360)
    if (avoidHue === undefined || randomHue !== avoidHue) {
      return randomHue
    }

    return (randomHue + 137) % 360
  }

  let bestHue = Math.floor(Math.random() * 360)
  let bestScore = -1

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const candidate = Math.floor(Math.random() * 360)
    let closestDistance = 180

    for (const usedHue of usedHues) {
      closestDistance = Math.min(closestDistance, hueDistance(candidate, usedHue))
    }

    const score = avoidHue !== undefined && candidate === avoidHue ? closestDistance - 360 : closestDistance

    if (score > bestScore) {
      bestHue = candidate
      bestScore = score
    }
  }

  if (avoidHue !== undefined && bestHue === avoidHue) {
    return (bestHue + 137) % 360
  }

  return bestHue
}

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').slice(0, 40)

const parseClientEvent = (rawMessage: string | Uint8Array | ArrayBuffer): ClientEvent | null => {
  const text =
    typeof rawMessage === 'string'
      ? rawMessage
      : decoder.decode(rawMessage instanceof ArrayBuffer ? new Uint8Array(rawMessage) : rawMessage)

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null
    }
    return parsed as ClientEvent
  } catch {
    return null
  }
}

const makeSnapshot = (clientId: string): RoomStateSnapshot => {
  const participants = [...users.entries()]
    .map(([id, user]) => ({
      id,
      name: user.name,
      colorHue: user.colorHue,
      hasVoted: user.vote !== null,
      vote: revealed ? user.vote : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    revealed,
    myId: clientId,
    myVote: users.get(clientId)?.vote ?? null,
    participants,
  }
}

const send = (ws: Bun.ServerWebSocket<SocketData>, event: ServerEvent): void => {
  ws.send(JSON.stringify(event))
}

const sendSnapshot = (clientId: string): void => {
  const ws = sockets.get(clientId)
  if (!ws) {
    return
  }
  send(ws, { type: 'state_snapshot', state: makeSnapshot(clientId) })
}

const broadcastSnapshots = (): void => {
  for (const clientId of sockets.keys()) {
    sendSnapshot(clientId)
  }
}

const resetRound = (): void => {
  revealed = false
  for (const user of users.values()) {
    user.vote = null
  }
}

const setVote = (clientId: string, vote: EstimateOption | null): boolean => {
  const user = users.get(clientId)
  if (!user) {
    return false
  }

  if (vote === null) {
    user.vote = null
    return true
  }

  if (!allowedVotes.has(vote)) {
    return false
  }

  user.vote = vote
  return true
}

const server = Bun.serve<SocketData>({
  port,
  fetch(request, serverInstance) {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/ws') {
      const id = crypto.randomUUID()
      if (serverInstance.upgrade(request, { data: { id } })) {
        return
      }
      return new Response('WebSocket upgrade failed.', { status: 500 })
    }

    return new Response('Scrummer WebSocket server is running.', { status: 200 })
  },
  websocket: {
    open(ws) {
      sockets.set(ws.data.id, ws)
      sendSnapshot(ws.data.id)
    },
    message(ws, rawMessage) {
      const event = parseClientEvent(rawMessage)
      if (!event) {
        send(ws, { type: 'server_error', message: 'Invalid message format.' })
        return
      }

      const clientId = ws.data.id
      switch (event.type) {
        case 'join': {
          const normalizedName = normalizeName(event.name)
          if (!normalizedName) {
            send(ws, { type: 'server_error', message: 'Display name cannot be empty.' })
            return
          }

          const existingUser = users.get(clientId)
          if (existingUser) {
            existingUser.name = normalizedName
          } else {
            users.set(clientId, { name: normalizedName, colorHue: pickDistinctHue(), vote: null })
          }

          broadcastSnapshots()
          return
        }
        case 'update_name': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before changing your name.' })
            return
          }

          const normalizedName = normalizeName(event.name)
          if (!normalizedName) {
            send(ws, { type: 'server_error', message: 'Display name cannot be empty.' })
            return
          }

          user.name = normalizedName
          broadcastSnapshots()
          return
        }
        case 'reroll_color': {
          const user = users.get(clientId)
          if (!user) {
            send(ws, { type: 'server_error', message: 'Join before changing your color.' })
            return
          }

          user.colorHue = pickDistinctHue(clientId, user.colorHue)
          broadcastSnapshots()
          return
        }
        case 'set_vote': {
          if (!setVote(clientId, event.vote)) {
            send(ws, { type: 'server_error', message: 'Vote was rejected.' })
            return
          }

          broadcastSnapshots()
          return
        }
        case 'reveal': {
          if (users.size === 0 || revealed) {
            return
          }

          revealed = true
          broadcastSnapshots()
          return
        }
        case 'next_ticket': {
          if (users.size === 0) {
            return
          }

          resetRound()
          broadcastSnapshots()
          return
        }
      }
    },
    close(ws) {
      sockets.delete(ws.data.id)
      users.delete(ws.data.id)

      if (users.size === 0) {
        revealed = false
      }

      broadcastSnapshots()
    },
  },
})

console.log(`Scrummer WebSocket server listening on ws://localhost:${server.port}/ws`)
