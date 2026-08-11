import { useEffect, useRef, useState } from 'react'
import './App.css'

const WS_PORT = 3001
const CLIENT_ID_STORAGE_KEY = 'imposter-client-id'

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getStoredClientId() {
  if (typeof window === 'undefined') {
    return createClientId()
  }

  const storedClientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (storedClientId) {
    return storedClientId
  }

  const nextClientId = createClientId()
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, nextClientId)
  return nextClientId
}

function getSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:${WS_PORT}`
}

function App() {
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const pendingMessagesRef = useRef([])
  const previousVoteSnapshotRef = useRef({})
  const audioContextRef = useRef(null)
  const lastTapSoundTimeRef = useRef(0)
  const clientIdRef = useRef(getStoredClientId())
  const [view, setView] = useState({ kind: 'home' })
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [errorMessage, setErrorMessage] = useState('')
  const [screen, setScreen] = useState('home')
  const [joinCode, setJoinCode] = useState('')
  const [joinName, setJoinName] = useState('')
  const [roleRevealed, setRoleRevealed] = useState(false)
  const [recentlyVotedIds, setRecentlyVotedIds] = useState([])
  const [currentTime, setCurrentTime] = useState(Date.now())

  const isHostView = view.kind === 'host'
  const isPlayerView = view.kind === 'player'
  const hostCanStart = isHostView && view.phase === 'lobby' && view.roster.length >= 2
  const hostCanInitiateVoting = Boolean(isHostView && view.canInitiateVoting)

  useEffect(() => {
    function connect() {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      setConnectionStatus('connecting')
      const socket = new WebSocket(getSocketUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        setConnectionStatus('connected')
        socket.send(
          JSON.stringify({
            type: 'hello',
            clientId: clientIdRef.current,
          }),
        )

        const pendingMessages = pendingMessagesRef.current
        pendingMessagesRef.current = []
        for (const pendingMessage of pendingMessages) {
          socket.send(JSON.stringify(pendingMessage))
        }
      })

      socket.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }

        if (message.type === 'connected' || message.type === 'view') {
          setView(message.view || { kind: 'home' })
        }

        if (message.type === 'error') {
          setErrorMessage(message.message)
        }
      })

      socket.addEventListener('close', () => {
        setConnectionStatus('disconnected')
        reconnectTimerRef.current = window.setTimeout(connect, 1500)
      })

      socket.addEventListener('error', () => {
        setConnectionStatus('disconnected')
      })
    }

    connect()

    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      socketRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (view.phase !== 'reveal') {
      setRoleRevealed(false)
    }
  }, [view.phase])

  useEffect(() => {
    if (view.kind !== 'player' || view.phase !== 'voting') {
      previousVoteSnapshotRef.current = {}
      setRecentlyVotedIds([])
      return
    }

    const previousSnapshot = previousVoteSnapshotRef.current
    const currentSnapshot = Object.fromEntries(
      (view.players || []).map((player) => [player.id, player.votes || 0]),
    )

    const increasedIds = Object.keys(currentSnapshot).filter(
      (playerId) => currentSnapshot[playerId] > (previousSnapshot[playerId] || 0),
    )

    previousVoteSnapshotRef.current = currentSnapshot

    if (increasedIds.length === 0) {
      return
    }

    setRecentlyVotedIds(increasedIds)
    const timeoutId = window.setTimeout(() => {
      setRecentlyVotedIds([])
    }, 700)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [view])

  useEffect(() => {
    const deadlineAt =
      view.phase === 'discussion'
        ? view.discussionDeadlineAt
        : view.phase === 'voting'
          ? view.votingDeadlineAt
          : 0

    if (!deadlineAt) {
      return undefined
    }

    setCurrentTime(Date.now())
    const intervalId = window.setInterval(() => {
      setCurrentTime(Date.now())
    }, 250)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [view.phase, view.discussionDeadlineAt, view.votingDeadlineAt])

  useEffect(() => {
    function getAudioContext() {
      if (audioContextRef.current) {
        return audioContextRef.current
      }

      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextConstructor) {
        return null
      }

      audioContextRef.current = new AudioContextConstructor()
      return audioContextRef.current
    }

    function playTapSound() {
      const context = getAudioContext()
      if (!context) {
        return
      }

      if (context.state === 'suspended') {
        context.resume().catch(() => { })
      }

      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(920, now)
      oscillator.frequency.exponentialRampToValueAtTime(650, now + 0.08)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.1)
    }

    function handlePointerDown(event) {
      if (event.button !== 0) {
        return
      }

      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      const button = target.closest('button')
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return
      }

      const currentTime = performance.now()
      if (currentTime - lastTapSoundTimeRef.current < 40) {
        return
      }
      lastTapSoundTimeRef.current = currentTime

      playTapSound()
    }

    document.addEventListener('pointerdown', handlePointerDown, { capture: true })

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })

      const context = audioContextRef.current
      if (context && context.state !== 'closed') {
        context.close().catch(() => { })
      }
      audioContextRef.current = null
    }
  }, [])

  function sendMessage(message) {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pendingMessagesRef.current.push(message)
      return
    }

    socket.send(JSON.stringify(message))
  }

  function createLobby() {
    setErrorMessage('')
    sendMessage({ type: 'createLobby' })
  }

  function startGame() {
    setErrorMessage('')
    sendMessage({ type: 'startGame' })
  }

  function kickPlayer(playerId) {
    setErrorMessage('')
    sendMessage({ type: 'removePlayer', playerId })
  }

  function initiateVoting() {
    setErrorMessage('')
    sendMessage({ type: 'initiateVoting' })
  }

  function joinLobby() {
    const trimmedCode = joinCode.trim().toUpperCase()
    const trimmedName = joinName.trim()

    if (!trimmedCode || !trimmedName) {
      return
    }

    setErrorMessage('')
    sendMessage({
      type: 'joinLobby',
      code: trimmedCode,
      name: trimmedName,
    })
  }

  function markRevealReady() {
    setErrorMessage('')
    sendMessage({ type: 'revealReady' })
  }

  function castVote(targetId) {
    setErrorMessage('')
    sendMessage({ type: 'castVote', targetId })
  }

  function resetLobby() {
    setErrorMessage('')
    sendMessage({ type: 'resetLobby' })
  }

  function leaveLobby() {
    setErrorMessage('')
    setView({ kind: 'home' })
    setScreen('home')
    setJoinCode('')
    setJoinName('')
    sendMessage({ type: 'leaveLobby' })
  }

  async function copyPartyCode(code) {
    try {
      await navigator.clipboard.writeText(code)
      setErrorMessage('')
    } catch {
      setErrorMessage('Copy the party ID manually if needed.')
    }
  }

  function formatCountdown(deadlineAt) {
    if (!deadlineAt) {
      return '0s'
    }

    const remainingMs = Math.max(deadlineAt - currentTime, 0)
    const totalSeconds = Math.ceil(remainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    if (minutes === 0) {
      return `${seconds}s`
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  function renderHomeScreen() {
    return (
      <section className="panel hero-panel">
        <h1>Imposter</h1>
        <p className="subtitle">
          Create a lobby for the host, or join a game from your phone with a party ID.
        </p>

        <div className="home-actions">
          <button type="button" className="btn primary full" onClick={createLobby}>
            Start Game
          </button>
          <button type="button" className="btn full" onClick={() => setScreen('join')}>
            Join Game
          </button>
        </div>
      </section>
    )
  }

  function renderJoinScreen() {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="step">Join a lobby</p>
            <h1>Join Game</h1>
          </div>
          <button type="button" className="ghost-btn" onClick={() => setScreen('home')}>
            Back
          </button>
        </div>

        <p className="subtitle">
          Enter the party ID from the host and join directly with your name.
        </p>

        <div className="block">
          <div className="row">
            <input
              type="text"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="Party ID"
              aria-label="Party ID"
              maxLength={6}
            />
            <input
              type="text"
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              maxLength={24}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  joinLobby()
                }
              }}
            />
          </div>
          <button type="button" className="btn primary full" onClick={joinLobby}>
            Join Game
          </button>
        </div>
      </section>
    )
  }

  function renderHostLobby() {
    if (view.kind !== 'host') {
      return null
    }

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="step">Party ID</p>
            <h1 className="code-chip">{view.code}</h1>
          </div>
          <button type="button" className="ghost-btn" onClick={() => copyPartyCode(view.code)}>
            Copy ID
          </button>
        </div>

        <p className="subtitle">
          Share the party ID and let players join directly from their phones.
        </p>

        {view.phase === 'lobby' ? (
          <>
            <div className="block">
              <h2>Joined players ({view.roster.length})</h2>

              <ul className="player-list">
                {view.roster.length > 0 ? (
                  view.roster.map((player) => (
                    <li key={player.id}>
                      <div>
                        <span>{player.name}</span>
                        <p className="list-meta">Joined from a phone</p>
                      </div>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => kickPlayer(player.id)}
                        aria-label={`Kick ${player.name}`}
                      >
                        Kick
                      </button>
                    </li>
                  ))
                ) : (
                  <li>
                    <div>
                      <span>No players yet</span>
                      <p className="list-meta">Share the party ID so people can join</p>
                    </div>
                  </li>
                )}
              </ul>
            </div>

            <div className="block">
              <h2>Imposters</h2>
              <div className="option-row">
                <button
                  type="button"
                  className={`option ${view.imposterCount === 1 ? 'active' : ''}`}
                  onClick={() => sendMessage({ type: 'setImposterCount', count: 1 })}
                >
                  1
                </button>
                <button
                  type="button"
                  className={`option ${view.imposterCount === 2 ? 'active' : ''}`}
                  onClick={() => sendMessage({ type: 'setImposterCount', count: 2 })}
                  disabled={view.roster.length < 4}
                >
                  2
                </button>
              </div>
              <p className="hint">2 imposters unlocks when the lobby has at least 4 players.</p>
            </div>

            <button
              type="button"
              className="btn primary full"
              onClick={startGame}
              disabled={!hostCanStart}
            >
              Start Game
            </button>

            <p className="hint">
              {hostCanStart
                ? 'Everyone has joined. Start the round when you are ready.'
                : 'Waiting for every added player to join before the game can start.'}
            </p>

            <button type="button" className="ghost-btn full-ghost" onClick={leaveLobby}>
              Leave Lobby
            </button>
          </>
        ) : (
          <>
            <div className="block">
              <h2>Game status</h2>
              <p className="hint">
                {view.phase === 'reveal'
                  ? 'Players are revealing their roles on their own phones.'
                  : view.phase === 'discussion'
                    ? 'The selected player will start the discussion.'
                    : view.phase === 'voting'
                      ? 'Voting is open on each player phone.'
                      : 'The round is complete.'}
              </p>
              <div className="summary-grid">
                <div>
                  <span className="summary-label">Players</span>
                  <strong>{view.activeCount}</strong>
                </div>
                <div>
                  <span className="summary-label">Ready</span>
                  <strong>{view.readyCount}</strong>
                </div>
                <div>
                  <span className="summary-label">Votes</span>
                  <strong>{view.voteCount}</strong>
                </div>
              </div>
              {view.phase === 'voting' && view.votingDeadlineAt ? (
                <p className="timer-hint">
                  Voting ends in <strong>{formatCountdown(view.votingDeadlineAt)}</strong>.
                </p>
              ) : null}
            </div>

            <div className="block">
              <h2>Lobby roster</h2>
              <ul className="player-list">
                {view.roster.map((player) => (
                  <li key={player.id}>
                    <div>
                      <span>{player.name}</span>
                      <p className="list-meta">
                        {player.active ? 'In game' : player.claimed ? 'Joined' : 'Waiting'}
                      </p>
                    </div>
                    <span className="status-pill">
                      {view.phase === 'voting' ? `${player.votes} votes` : player.revealed ? 'Ready' : 'Pending'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {view.phase === 'discussion' ? (
              <>
                <div className="block">
                  <h2>Discussion</h2>
                  <p className="hint">
                    {view.discussionStarterName
                      ? `${view.discussionStarterName} will start the discussion`
                      : 'Waiting for a discussion starter.'}
                  </p>
                  <div className="summary-grid">
                    <div>
                      <span className="summary-label">Players ready</span>
                      <strong>{view.readyCount}</strong>
                    </div>
                    <div>
                      <span className="summary-label">Starter</span>
                      <strong>{view.discussionStarterName || 'TBD'}</strong>
                    </div>
                    <div>
                      <span className="summary-label">Category</span>
                      <strong>{view.category}</strong>
                    </div>
                  </div>
                  {view.discussionDeadlineAt ? (
                    <p className="timer-hint">
                      Auto voting starts in <strong>{formatCountdown(view.discussionDeadlineAt)}</strong>.
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn primary full"
                  onClick={initiateVoting}
                  disabled={!hostCanInitiateVoting}
                >
                  Initiate Voting
                </button>

                <p className="hint">
                  {hostCanInitiateVoting
                    ? 'Everyone is ready. Start voting when the discussion is done.'
                    : 'Waiting for everyone to tap ready before voting can begin.'}
                </p>
              </>
            ) : null}

            {view.phase === 'result' ? (
              <button type="button" className="btn primary full" onClick={resetLobby}>
                New Round
              </button>
            ) : null}
          </>
        )}
      </section>
    )
  }

  function renderPlayerScreen() {
    if (view.kind !== 'player') {
      return null
    }

    if (view.phase === 'lobby') {
      return (
        <section className="panel">
          <p className="step">Party ID</p>
          <h1>{view.code}</h1>
          <p className="subtitle">You are in the lobby. Wait for the host to start the round.</p>

          <div className="block">
            <h2>Players</h2>
            <ul className="player-list">
              {view.roster.map((player) => (
                <li key={player.id}>
                  <span>{player.name}</span>
                  <span className="status-pill">{player.claimed ? 'Joined' : 'Waiting'}</span>
                </li>
              ))}
            </ul>
          </div>

          <button type="button" className="ghost-btn full-ghost" onClick={leaveLobby}>
            Leave Lobby
          </button>
        </section>
      )
    }

    if (view.phase === 'reveal') {
      return (
        <section className="panel reveal-screen">
          <p className="step">Party {view.code}</p>
          <h1>{view.myName}</h1>
          <p className="subtitle">Keep this screen private.</p>

          <button
            type="button"
            className={`reveal-card ${roleRevealed || view.revealed ? 'is-revealed' : ''}`}
            onClick={roleRevealed || view.revealed ? undefined : () => setRoleRevealed(true)}
          >
            {!roleRevealed && !view.revealed ? (
              <span>Tap to reveal your role</span>
            ) : view.myRole === 'imposter' ? (
              <>
                <span className="imposter-label">YOU ARE THE IMPOSTER</span>
                <small>Blend in and figure out the word.</small>
                <small className="hint">Category hint: {view.myCategory}</small>
              </>
            ) : (
              <>
                <span className="word-label">{view.myWord}</span>
                <small>Use this word in the discussion.</small>
              </>
            )}
          </button>

          {(roleRevealed || view.revealed) && !view.revealed ? (
            <button type="button" className="btn primary full" onClick={markRevealReady}>
              I am ready
            </button>
          ) : null}

          {view.revealed ? <p className="hint">Waiting for the rest of the group to reveal.</p> : null}
        </section>
      )
    }

    if (view.phase === 'voting') {
      const hasVoted = Boolean(view.myVote)
      const maxVotes = view.players.reduce(
        (highest, player) => Math.max(highest, player.votes || 0),
        0,
      )

      return (
        <section className="panel">
          <h1>Vote</h1>
          <p className="subtitle">Choose who you think the imposter is.</p>

          <p className="step">
            Votes cast: {view.votesCastCount} / {view.totalVoters}
          </p>

          {view.votingDeadlineAt ? (
            <p className="timer-hint">
              Voting ends in <strong>{formatCountdown(view.votingDeadlineAt)}</strong>.
            </p>
          ) : null}

          {hasVoted ? (
            <p className="hint">You already voted. Wait for the rest of the players.</p>
          ) : null}

          <div className="vote-grid">
            {view.players.map((player) => (
              <button
                key={player.id}
                type="button"
                className={`vote-card ${view.myVote === player.id ? 'selected' : ''} ${maxVotes > 0 && player.votes === maxVotes ? 'majority' : ''} ${recentlyVotedIds.includes(player.id) ? 'vote-flash' : ''}`}
                onClick={() => castVote(player.id)}
                disabled={hasVoted}
              >
                <span>{player.name}</span>
                <strong>{player.votes} votes</strong>
              </button>
            ))}
          </div>
        </section>
      )
    }

    if (view.phase === 'discussion') {
      return (
        <section className="panel discussion-screen">
          <p className="step">Party {view.code}</p>
          <h1>Discussion</h1>
          <p className="subtitle">Wait for the host to start voting.</p>

          <div className="result-box discussion-box">
            <h2>{view.discussionStarterName} will start the discussion</h2>
            <p>
              {view.myName === view.discussionStarterName
                ? 'You start the discussion.'
                : 'Listen for the first clue and join the conversation.'}
            </p>
            {view.discussionDeadlineAt ? (
              <p className="timer-hint">
                Voting starts automatically in <strong>{formatCountdown(view.discussionDeadlineAt)}</strong>.
              </p>
            ) : null}
          </div>
        </section>
      )
    }

    return (
      <section className="panel result-screen">
        <h1>Result</h1>
        <p className="subtitle">
          Secret word: <strong>{view.word}</strong>
        </p>

        <div className="result-box">
          <p className="step">Eliminated</p>
          <h2>{view.eliminatedPlayers.map((player) => player.name).join(', ') || 'Nobody'}</h2>
          {view.eliminatedPlayers.length === 0 ? (
            <p className="result-status result-safe">No player was eliminated.</p>
          ) : (
            <p className={`result-status ${view.wasImposter ? 'result-danger' : 'result-safe'}`}>
              {view.wasImposter ? 'They were an Imposter.' : 'They were not an Imposter.'}
            </p>
          )}

          {!view.wasImposter ? (
            <p className="result-imposter-reveal">
              Imposter: <strong>{(view.imposterNames || []).join(', ') || 'Hidden'}</strong>
            </p>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <main className="app-shell">
      {connectionStatus !== 'connected' ? (
        <div className="voter-banner" role="status" aria-live="polite">
          {connectionStatus === 'connecting' ? 'Connecting to lobby server...' : 'Lobby server disconnected.'}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="voter-banner error-banner" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {screen === 'join' && view.kind === 'home' ? renderJoinScreen() : null}
      {view.kind === 'home' && screen === 'home' ? renderHomeScreen() : null}
      {isHostView ? renderHostLobby() : null}
      {isPlayerView ? renderPlayerScreen() : null}

    </main>
  )
}

export default App
