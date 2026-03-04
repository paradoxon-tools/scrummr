'use client'

import { ConvexClient } from 'convex/browser'
import { api } from '../../convex/_generated/api.js'
import type { ClientEvent, ServerEvent } from './protocol'

type RoomSocketListener<K extends keyof RoomSocketEventMap> = (event: RoomSocketEventMap[K]) => void

type RoomSocketEventMap = {
  open: Event
  close: Event
  error: Event
  message: MessageEvent<string>
}

const createServerEventMessage = (event: ServerEvent): MessageEvent<string> =>
  new MessageEvent<string>('message', {
    data: JSON.stringify(event),
  })

export class RoomConnection {
  private client: ConvexClient
  private clientId: string
  private listeners: {
    open: Set<RoomSocketListener<'open'>>
    close: Set<RoomSocketListener<'close'>>
    error: Set<RoomSocketListener<'error'>>
    message: Set<RoomSocketListener<'message'>>
  }

  private unsubscribeSnapshot: (() => void) | null = null
  private closed = false
  private closeStarted = false
  readyState: number = WebSocket.CONNECTING

  constructor(convexUrl: string) {
    this.client = new ConvexClient(convexUrl)
    this.clientId = crypto.randomUUID()
    this.listeners = {
      open: new Set(),
      close: new Set(),
      error: new Set(),
      message: new Set(),
    }

    window.setTimeout(() => {
      if (this.closed) {
        return
      }

      this.readyState = WebSocket.OPEN
      this.startSnapshotSubscription()
      this.emit('open', new Event('open'))
    }, 0)
  }

  addEventListener<K extends keyof RoomSocketEventMap>(type: K, listener: RoomSocketListener<K>): void {
    ;(this.listeners[type] as Set<RoomSocketListener<K>>).add(listener)
  }

  removeEventListener<K extends keyof RoomSocketEventMap>(type: K, listener: RoomSocketListener<K>): void {
    ;(this.listeners[type] as Set<RoomSocketListener<K>>).delete(listener)
  }

  send(payload: string): void {
    if (this.readyState !== WebSocket.OPEN || this.closed) {
      return
    }

    let parsedEvent: ClientEvent | null = null
    try {
      const candidate = JSON.parse(payload)
      if (candidate && typeof candidate === 'object' && typeof candidate.type === 'string') {
        parsedEvent = candidate as ClientEvent
      }
    } catch {
      parsedEvent = null
    }

    if (!parsedEvent) {
      this.emitMessage({ type: 'server_error', message: 'Invalid message format.' })
      return
    }

    void this.client
      .mutation(api.room.sendEvent, {
        clientId: this.clientId,
        event: parsedEvent,
      })
      .then((result) => {
        if (!result || typeof result !== 'object' || result.ok !== true) {
          this.emitMessage({ type: 'server_error', message: result?.message ?? 'Request was rejected.' })
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unexpected backend error.'
        this.emitMessage({ type: 'server_error', message })
        this.emit('error', new Event('error'))
      })
  }

  close(): void {
    if (this.closeStarted || this.closed) {
      return
    }

    this.closeStarted = true
    this.readyState = WebSocket.CLOSING

    this.unsubscribeSnapshot?.()
    this.unsubscribeSnapshot = null

    void this.client
      .mutation(api.room.leave, { clientId: this.clientId })
      .catch(() => undefined)
      .finally(() => {
        void this.client.close().catch(() => undefined)
        this.closed = true
        this.readyState = WebSocket.CLOSED
        this.emit('close', new Event('close'))
      })
  }

  private startSnapshotSubscription(): void {
    this.unsubscribeSnapshot?.()
    this.unsubscribeSnapshot = this.client.onUpdate(
      api.room.snapshot,
      {
        clientId: this.clientId,
      },
      (state) => {
        this.emitMessage({ type: 'state_snapshot', state })
      },
      (error) => {
        const message = error instanceof Error ? error.message : 'Failed to subscribe to room updates.'
        this.emitMessage({ type: 'server_error', message })
        this.emit('error', new Event('error'))
      },
    )
  }

  private emitMessage(event: ServerEvent): void {
    this.emit('message', createServerEventMessage(event))
  }

  private emit<K extends keyof RoomSocketEventMap>(type: K, event: RoomSocketEventMap[K]): void {
    const listeners = this.listeners[type] as Set<RoomSocketListener<K>>
    for (const listener of listeners) {
      listener(event)
    }
  }
}

export const createRoomConnection = (): RoomConnection | null => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? ''
  if (!convexUrl) {
    return null
  }
  return new RoomConnection(convexUrl)
}
