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
  let isProfileEditing = false
  let socket: WebSocket | null = null
  let profileSyncTimer: number | undefined

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
    const trimmed = name.trim()
    if (trimmed) {
      window.localStorage.setItem(STORAGE_KEY, name.slice(0, 40))
      return
    }

    window.localStorage.removeItem(STORAGE_KEY)
  }

  const send = (event: ClientEvent): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    socket.send(JSON.stringify(event))
  }

  const readStoredName = (): boolean => {
    const storedName = window.localStorage.getItem(STORAGE_KEY)
    if (!storedName) {
      return false
    }

    const normalized = normalizeName(storedName)
    if (!normalized) {
      window.localStorage.removeItem(STORAGE_KEY)
      return false
    }

    nameInput = normalized
    saveNameLocally(normalized)
    return true
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

  const commitProfileName = (showError: boolean): void => {
    const normalizedName = normalizeName(nameInput)
    if (!normalizedName) {
      if (showError) {
        connectionMessage = 'Display name cannot be empty.'
      }

      nameInput = joinedName
      return
    }

    nameInput = normalizedName
    saveNameLocally(normalizedName)

    if (!isConnected || normalizedName === joinedName) {
      return
    }

    joinedName = normalizedName
    send({ type: 'update_name', name: normalizedName })
  }

  const scheduleProfileNameSync = (): void => {
    if (!isConnected) {
      return
    }

    window.clearTimeout(profileSyncTimer)
    profileSyncTimer = window.setTimeout(() => {
      commitProfileName(false)
    }, 320)
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
        const me = roomState.participants.find((participant) => participant.id === roomState.myId)
        if (me) {
          joinedName = me.name
          if (!isProfileEditing) {
            nameInput = me.name
          }
        }

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

  const handleNameInput = (): void => {
    nameInput = nameInput.slice(0, 40)
    saveNameLocally(nameInput)
    scheduleProfileNameSync()
  }

  const submitJoin = (event: SubmitEvent): void => {
    event.preventDefault()
    connect()
  }

  const handleProfileBlur = (): void => {
    isProfileEditing = false
    window.clearTimeout(profileSyncTimer)
    if (!isConnected) {
      return
    }

    commitProfileName(true)
  }

  const handleProfileKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    if (!isConnected) {
      return
    }

    window.clearTimeout(profileSyncTimer)
    commitProfileName(true)
    ;(event.currentTarget as HTMLInputElement).blur()
  }

  const setVote = (option: EstimateOption): void => {
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

  const requestNewColor = (): void => {
    if (!isConnected) {
      return
    }

    send({ type: 'reroll_color' })
  }

  onMount(() => {
    const hasStoredName = readStoredName()
    if (hasStoredName) {
      connect()
    }
  })

  onDestroy(() => {
    window.clearTimeout(profileSyncTimer)
    socket?.close()
  })

  $: votedCount = roomState.participants.filter((participant) => participant.hasVoted).length
  $: totalCount = roomState.participants.length
  $: canReveal = votedCount > 0
  $: myParticipant = roomState.participants.find((participant) => participant.id === roomState.myId)
  $: myHue = myParticipant?.colorHue ?? 210
  $: revealBuckets = ESTIMATE_OPTIONS.map((estimate) => ({
    estimate,
    voters: roomState.participants.filter((participant) => participant.vote === estimate),
  })).filter((bucket) => bucket.voters.length > 0)
</script>

<main class="app-shell" class:connected={isConnected}>
  <header class="topbar">
    <div class="brand">
      <p class="eyebrow">Single Room Scrum Poker</p>
      <h1>Scrummer</h1>
    </div>

    <form class="profile" style={`--user-hue: ${myHue};`} on:submit|preventDefault>
      <label for="display-name">Profile</label>
      <div class="profile-input-wrap">
        <button
          type="button"
          class="color-swatch"
          aria-label="Get a new profile color"
          title="Get a new color"
          on:click={requestNewColor}
          disabled={!isConnected}
        ></button>
        <input
          id="display-name"
          maxlength="40"
          bind:value={nameInput}
          placeholder="Your display name"
          autocomplete="name"
          on:focus={() => (isProfileEditing = true)}
          on:blur={handleProfileBlur}
          on:keydown={handleProfileKeydown}
          on:input={handleNameInput}
        />
      </div>
      <small>Saved automatically. Edit anytime; changes sync to the room when connected.</small>
    </form>
  </header>

  {#if !isConnected}
    <section class="join-view panel">
      <h2>Join planning room</h2>
      <p>Enter your name above and join. Returning users connect automatically.</p>
      <form on:submit={submitJoin}>
        <button type="submit" class="primary" disabled={isConnecting}>
          {isConnecting ? 'Connecting...' : 'Join'}
        </button>
      </form>
    </section>
  {:else}
    <section class="workspace">
      <section class="panel summary">
        <div class="panel-heading">
          <h2>Current ticket</h2>
          <p>{votedCount} of {totalCount} participants have voted.</p>
        </div>
        <p>
          {#if roomState.revealed}
            Votes are revealed and remain editable until someone selects <strong>Next ticket</strong>.
          {:else}
            Votes stay hidden until any participant reveals.
          {/if}
        </p>
      </section>

      {#if roomState.revealed}
        <section class="panel breakdown">
          <h2>Revealed breakdown</h2>
          <div class="breakdown-grid">
            {#each revealBuckets as bucket}
              <article class="estimate-group">
                <h3>{bucket.estimate}</h3>
                <div class="badge-list">
                  {#each bucket.voters as voter}
                    <span class="user-badge" style={`--user-hue: ${voter.colorHue};`}>{voter.name}</span>
                  {/each}
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}

      <section class="panel participants">
        <h2>Participants</h2>
        <ul>
          {#each roomState.participants as participant}
            <li class:me={participant.id === roomState.myId} style={`--user-hue: ${participant.colorHue};`}>
              <div class="person">
                {#if participant.id === roomState.myId}
                  <button
                    type="button"
                    class="color-swatch mini"
                    aria-label="Get a new participant color"
                    title="Get a new color"
                    on:click={requestNewColor}
                  ></button>
                {:else}
                  <span class="avatar-dot" aria-hidden="true"></span>
                {/if}
                <span>{participant.name}</span>
              </div>

              {#if roomState.revealed}
                <strong>{participant.vote ?? '-'}</strong>
              {:else}
                <em>{participant.hasVoted ? 'Voted' : 'Waiting'}</em>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    </section>

    <section class="vote-dock" aria-label="Estimation options">
      <div class="vote-dock-inner">
        <button type="button" class="primary action-button" on:click={revealOrNextTicket} disabled={!roomState.revealed && !canReveal}>
          {roomState.revealed ? 'Next ticket' : 'Reveal'}
        </button>

        <div class="dock-cards" role="group" aria-label="Vote cards">
          {#each ESTIMATE_OPTIONS as option}
            <button type="button" class:selected={roomState.myVote === option} class="vote-card" on:click={() => setVote(option)}>
              {option}
            </button>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  {#if connectionMessage}
    <p class="message">{connectionMessage}</p>
  {/if}
</main>
