<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    ESTIMATE_OPTIONS,
    type ClientEvent,
    type EstimateOption,
    type RoomStateSnapshot,
    type ServerEvent,
  } from './lib/protocol'

  const STORAGE_KEY = 'scrummer.display_name'

  const createEmptyState = (): RoomStateSnapshot => ({
    revealed: false,
    myId: '',
    myVote: null,
    participants: [],
  })

  let roomState: RoomStateSnapshot = createEmptyState()
  let nameInput = ''
  let joinedName = ''
  let connectionMessage = ''
  let isConnected = false
  let isConnecting = false
  let socket: WebSocket | null = null

  const socketUrl = (): string => {
    const configuredUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.trim()
    if (configuredUrl) {
      return configuredUrl
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.hostname}:3001/ws`
  }

  const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').slice(0, 40)

  const saveNameLocally = (name: string): void => {
    window.localStorage.setItem(STORAGE_KEY, name)
  }

  const send = (event: ClientEvent): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }
    socket.send(JSON.stringify(event))
  }

  const readStoredName = (): void => {
    const storedName = window.localStorage.getItem(STORAGE_KEY)
    if (storedName) {
      nameInput = storedName
    }
  }

  const parseServerEvent = (payload: string): ServerEvent | null => {
    try {
      const parsed = JSON.parse(payload)
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
        return null
      }
      return parsed as ServerEvent
    } catch {
      return null
    }
  }

  const connect = (): void => {
    if (isConnecting || isConnected) {
      return
    }

    const normalizedName = normalizeName(nameInput)
    if (!normalizedName) {
      connectionMessage = 'Enter a display name to join.'
      return
    }

    nameInput = normalizedName
    joinedName = normalizedName
    connectionMessage = ''
    saveNameLocally(normalizedName)
    isConnecting = true

    const nextSocket = new WebSocket(socketUrl())
    socket = nextSocket

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) {
        return
      }

      isConnecting = false
      isConnected = true
      send({ type: 'join', name: normalizedName })
    })

    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket || typeof event.data !== 'string') {
        return
      }

      const serverEvent = parseServerEvent(event.data)
      if (!serverEvent) {
        connectionMessage = 'Received an invalid update from the server.'
        return
      }

      if (serverEvent.type === 'state_snapshot') {
        roomState = serverEvent.state
        return
      }

      connectionMessage = serverEvent.message
    })

    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) {
        return
      }

      socket = null
      isConnected = false
      isConnecting = false
      joinedName = ''
      roomState = createEmptyState()
      connectionMessage = 'Connection closed. Rejoin to continue planning.'
    })

    nextSocket.addEventListener('error', () => {
      if (socket !== nextSocket) {
        return
      }

      connectionMessage = 'Could not connect to the planning server.'
    })
  }

  const saveName = (event: SubmitEvent): void => {
    event.preventDefault()
    const normalizedName = normalizeName(nameInput)

    if (!normalizedName) {
      connectionMessage = 'Display name cannot be empty.'
      return
    }

    nameInput = normalizedName
    saveNameLocally(normalizedName)
    connectionMessage = isConnected ? 'Display name updated.' : 'Display name saved.'

    if (isConnected) {
      joinedName = normalizedName
      send({ type: 'update_name', name: normalizedName })
    }
  }

  const setVote = (option: EstimateOption): void => {
    if (roomState.revealed) {
      return
    }

    const nextVote = roomState.myVote === option ? null : option
    send({ type: 'set_vote', vote: nextVote })
  }

  const revealOrNextTicket = (): void => {
    if (roomState.revealed) {
      send({ type: 'next_ticket' })
      return
    }

    send({ type: 'reveal' })
  }

  onMount(readStoredName)

  onDestroy(() => {
    socket?.close()
  })

  $: votedCount = roomState.participants.filter((participant) => participant.hasVoted).length
  $: totalCount = roomState.participants.length
  $: canReveal = votedCount > 0
</script>

<main class="layout">
  <section class="panel">
    <header class="hero">
      <p class="eyebrow">Single Room Scrum Poker</p>
      <h1>Scrummer</h1>
      <p class="subtitle">Vote independently, reveal together, then move to the next ticket.</p>
    </header>

    <form class="name-form" on:submit={saveName}>
      <label for="display-name">Display name</label>
      <div class="row">
        <input
          id="display-name"
          maxlength="40"
          bind:value={nameInput}
          placeholder="Your name"
          autocomplete="name"
        />
        <button type="submit" class="secondary">Save</button>
      </div>
    </form>

    {#if !isConnected}
      <button type="button" class="primary" on:click={connect} disabled={isConnecting}>
        {isConnecting ? 'Connecting...' : 'Join planning room'}
      </button>
    {:else}
      <p class="connected-as">Connected as <strong>{joinedName}</strong></p>

      <section class="card-grid" aria-label="Estimation options">
        {#each ESTIMATE_OPTIONS as option}
          <button
            type="button"
            class:selected={roomState.myVote === option}
            class="vote-card"
            on:click={() => setVote(option)}
            disabled={roomState.revealed}
          >
            {option}
          </button>
        {/each}
      </section>

      <div class="actions">
        <button type="button" class="primary" on:click={revealOrNextTicket} disabled={!roomState.revealed && !canReveal}>
          {roomState.revealed ? 'Next ticket' : 'Reveal'}
        </button>
        <p class="status-line">
          {#if roomState.revealed}
            Estimates are visible to everyone.
          {:else}
            {votedCount} of {totalCount} participants have voted.
          {/if}
        </p>
      </div>

      <section class="participants">
        <h2>Participants</h2>
        <ul>
          {#each roomState.participants as participant}
            <li class:me={participant.id === roomState.myId}>
              <span>{participant.name}</span>
              {#if roomState.revealed}
                <strong>{participant.vote ?? '-'}</strong>
              {:else}
                <em>{participant.hasVoted ? 'Voted' : 'Waiting'}</em>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if connectionMessage}
      <p class="message">{connectionMessage}</p>
    {/if}
  </section>
</main>
