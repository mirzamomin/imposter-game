import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'
import { everydayWords } from '../src/data/words.js'

const PORT = 3001
const MIN_PLAYERS = 2
const MAX_IMPOSTERS = 2
const AUTO_VOTING_DELAY_MS = 30_000
const VOTING_DURATION_MS = 30_000

const lobbies = new Map()
const clients = new Map()

function pickRandomWord() {
    const randomIndex = Math.floor(Math.random() * everydayWords.length)
    return everydayWords[randomIndex]
}

function shuffleArray(items) {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
            ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
    }
    return copy
}

function createLobbyCode() {
    let code = ''
    do {
        code = Math.random().toString(36).slice(2, 6).toUpperCase()
    } while (lobbies.has(code))
    return code
}

function createLobby(hostClientId) {
    const code = createLobbyCode()
    const lobby = {
        code,
        hostClientId,
        phase: 'lobby',
        imposterCount: 1,
        word: '',
        category: '',
        discussionStarterId: '',
        imposterIds: [],
        roster: [],
        activePlayerIds: [],
        readyPlayerIds: [],
        votesByPlayerId: {},
        eliminatedIds: [],
        autoVotingDeadlineAt: 0,
        votingDeadlineAt: 0,
        autoVotingTimerId: null,
        votingTimerId: null,
    }

    lobbies.set(code, lobby)
    return lobby
}

function getLobbyForClient(clientId) {
    const record = clients.get(clientId)
    if (!record) {
        return null
    }

    return lobbies.get(record.lobbyCode) || null
}

function findActivePlayers(lobby) {
    return lobby.roster.filter((player) => lobby.activePlayerIds.includes(player.id))
}

function getVoteCounts(lobby) {
    return lobby.activePlayerIds.reduce((counts, playerId) => {
        counts[playerId] = 0
        return counts
    }, {})
}

function updateVoteCounts(lobby) {
    const counts = getVoteCounts(lobby)
    for (const targetId of Object.values(lobby.votesByPlayerId)) {
        if (counts[targetId] === undefined) {
            continue
        }
        counts[targetId] += 1
    }
    return counts
}

function buildRosterView(lobby) {
    const voteCounts = updateVoteCounts(lobby)
    return lobby.roster.map((player) => ({
        id: player.id,
        name: player.name,
        claimed: Boolean(player.clientId),
        active: lobby.activePlayerIds.includes(player.id),
        revealed: lobby.readyPlayerIds.includes(player.id),
        votes: voteCounts[player.id] || 0,
    }))
}

function buildHostView(lobby) {
    const discussionStarter = lobby.roster.find(
        (player) => player.id === lobby.discussionStarterId,
    )

    return {
        kind: 'host',
        code: lobby.code,
        phase: lobby.phase,
        imposterCount: lobby.imposterCount,
        roster: buildRosterView(lobby),
        claimedCount: lobby.roster.filter((player) => player.clientId).length,
        totalCount: lobby.roster.length,
        activeCount: lobby.activePlayerIds.length,
        readyCount: lobby.readyPlayerIds.length,
        voteCount: Object.keys(lobby.votesByPlayerId).length,
        word: lobby.word,
        category: lobby.category,
        discussionDeadlineAt: lobby.phase === 'discussion' ? lobby.autoVotingDeadlineAt : 0,
        votingDeadlineAt: lobby.phase === 'voting' ? lobby.votingDeadlineAt : 0,
        discussionStarterName: discussionStarter ? discussionStarter.name : '',
        canInitiateVoting:
            lobby.phase === 'discussion' &&
            lobby.activePlayerIds.every((playerId) => lobby.readyPlayerIds.includes(playerId)),
        eliminatedNames: lobby.eliminatedIds
            .map((playerId) => lobby.roster.find((player) => player.id === playerId)?.name)
            .filter(Boolean),
    }
}

function buildPlayerView(lobby, player) {
    const activePlayers = findActivePlayers(lobby)
    const myVote = lobby.votesByPlayerId[player.id] || null
    const eliminatedPlayers = lobby.eliminatedIds
        .map((playerId) => activePlayers.find((entry) => entry.id === playerId))
        .filter(Boolean)
    const imposterNames = activePlayers
        .filter((entry) => entry.role === 'imposter')
        .map((entry) => entry.name)

    if (imposterNames.length === 0) {
        imposterNames.push(
            ...lobby.imposterIds
                .map((playerId) => lobby.roster.find((entry) => entry.id === playerId)?.name)
                .filter(Boolean),
        )
    }

    if (lobby.phase === 'lobby') {
        return {
            kind: 'player',
            phase: 'lobby',
            code: lobby.code,
            myName: player.name,
            roster: buildRosterView(lobby),
        }
    }

    if (lobby.phase === 'reveal') {
        return {
            kind: 'player',
            phase: 'reveal',
            code: lobby.code,
            myName: player.name,
            myRole: player.role,
            myWord: player.word,
            myCategory: lobby.category,
            revealed: lobby.readyPlayerIds.includes(player.id),
            totalPlayers: activePlayers.length,
            revealedCount: lobby.readyPlayerIds.length,
        }
    }

    if (lobby.phase === 'discussion') {
        const discussionStarter = lobby.roster.find(
            (entry) => entry.id === lobby.discussionStarterId,
        )

        return {
            kind: 'player',
            phase: 'discussion',
            code: lobby.code,
            myName: player.name,
            discussionStarterName: discussionStarter ? discussionStarter.name : '',
            totalPlayers: activePlayers.length,
            discussionDeadlineAt: lobby.autoVotingDeadlineAt,
        }
    }

    if (lobby.phase === 'voting') {
        return {
            kind: 'player',
            phase: 'voting',
            code: lobby.code,
            myName: player.name,
            players: activePlayers.map((entry) => ({
                id: entry.id,
                name: entry.name,
                votes: updateVoteCounts(lobby)[entry.id] || 0,
            })),
            myVote,
            totalVoters: activePlayers.length,
            votesCastCount: Object.keys(lobby.votesByPlayerId).length,
            votingDeadlineAt: lobby.votingDeadlineAt,
        }
    }

    return {
        kind: 'player',
        phase: 'result',
        code: lobby.code,
        myName: player.name,
        word: lobby.word,
        category: lobby.category,
        imposterNames,
        eliminatedPlayers: eliminatedPlayers.map((entry) => ({
            id: entry.id,
            name: entry.name,
        })),
        wasImposter: eliminatedPlayers.some((entry) => entry.role === 'imposter'),
    }
}

function buildViewForClient(clientId) {
    const record = clients.get(clientId)
    if (!record) {
        return { kind: 'home' }
    }

    const lobby = lobbies.get(record.lobbyCode)
    if (!lobby) {
        return { kind: 'home' }
    }

    if (record.role === 'host') {
        return buildHostView(lobby)
    }

    const player = lobby.roster.find((entry) => entry.id === record.playerId)
    if (!player) {
        return { kind: 'home' }
    }

    return buildPlayerView(lobby, player)
}

function send(ws, payload) {
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload))
    }
}

function sendView(clientId) {
    const record = clients.get(clientId)
    if (!record) {
        return
    }

    send(record.ws, {
        type: 'view',
        view: buildViewForClient(clientId),
    })
}

function broadcastLobby(lobby) {
    for (const [clientId, record] of clients.entries()) {
        if (record.lobbyCode === lobby.code) {
            sendView(clientId)
        }
    }
}

function resetClientRecord(record) {
    record.role = 'guest'
    record.lobbyCode = ''
    record.playerId = ''
    record.hostClientId = ''
}

function clearAutoVotingTimer(lobby) {
    if (lobby.autoVotingTimerId) {
        clearTimeout(lobby.autoVotingTimerId)
        lobby.autoVotingTimerId = null
    }
}

function clearVotingTimer(lobby) {
    if (lobby.votingTimerId) {
        clearTimeout(lobby.votingTimerId)
        lobby.votingTimerId = null
    }
}

function clearLobbyTimers(lobby) {
    clearAutoVotingTimer(lobby)
    clearVotingTimer(lobby)
    lobby.autoVotingDeadlineAt = 0
    lobby.votingDeadlineAt = 0
}

function determineEliminatedIds(lobby) {
    const counts = updateVoteCounts(lobby)
    const sortedResults = Object.entries(counts).sort((left, right) => right[1] - left[1])
    const [leadingEntry, runnerUpEntry] = sortedResults

    if (!leadingEntry || leadingEntry[1] === 0) {
        return []
    }

    if (runnerUpEntry && runnerUpEntry[1] === leadingEntry[1]) {
        return []
    }

    return [leadingEntry[0]]
}

function scheduleAutoVoting(lobby) {
    clearAutoVotingTimer(lobby)

    if (lobby.phase !== 'discussion' || !lobby.autoVotingDeadlineAt) {
        return
    }

    const delay = Math.max(lobby.autoVotingDeadlineAt - Date.now(), 0)
    lobby.autoVotingTimerId = setTimeout(() => {
        const currentLobby = lobbies.get(lobby.code)
        if (!currentLobby || currentLobby.phase !== 'discussion') {
            return
        }

        const result = initiateVoting(currentLobby)
        if (result.ok) {
            broadcastLobby(currentLobby)
        }
    }, delay)
}

function scheduleVotingDeadline(lobby) {
    clearVotingTimer(lobby)

    if (lobby.phase !== 'voting' || !lobby.votingDeadlineAt) {
        return
    }

    const delay = Math.max(lobby.votingDeadlineAt - Date.now(), 0)
    lobby.votingTimerId = setTimeout(() => {
        const currentLobby = lobbies.get(lobby.code)
        if (!currentLobby || currentLobby.phase !== 'voting') {
            return
        }

        revealResult(currentLobby)
        broadcastLobby(currentLobby)
    }, delay)
}

function startGame(lobby) {
    const activePlayers = lobby.roster.filter((player) => player.clientId)
    if (activePlayers.length < MIN_PLAYERS) {
        return { ok: false, error: 'Need at least 2 joined players to start.' }
    }

    const selectedImposterCount = Math.min(
        lobby.imposterCount,
        activePlayers.length >= 4 ? MAX_IMPOSTERS : 1,
    )
    const secret = pickRandomWord()
    const shuffledIds = shuffleArray(activePlayers.map((player) => player.id))
    const imposterIds = new Set(shuffledIds.slice(0, selectedImposterCount))

    lobby.phase = 'reveal'
    lobby.word = secret.word
    lobby.category = secret.category
    lobby.discussionStarterId = ''
    lobby.imposterIds = [...imposterIds]
    lobby.votingDeadlineAt = 0
    lobby.activePlayerIds = activePlayers.map((player) => player.id)
    lobby.readyPlayerIds = []
    lobby.votesByPlayerId = {}
    lobby.eliminatedIds = []
    clearLobbyTimers(lobby)
    lobby.roster = lobby.roster.map((player) => ({
        ...player,
        active: lobby.activePlayerIds.includes(player.id),
        revealed: false,
        role: lobby.activePlayerIds.includes(player.id)
            ? imposterIds.has(player.id)
                ? 'imposter'
                : 'civilian'
            : null,
        word:
            lobby.activePlayerIds.includes(player.id) && !imposterIds.has(player.id)
                ? secret.word
                : '',
    }))

    return { ok: true }
}

function moveToDiscussionIfReady(lobby) {
    if (lobby.phase !== 'reveal') {
        return
    }

    const allReady = lobby.activePlayerIds.every((playerId) =>
        lobby.readyPlayerIds.includes(playerId),
    )

    if (allReady) {
        const civilianPlayers = lobby.roster.filter(
            (player) =>
                lobby.activePlayerIds.includes(player.id) &&
                player.role !== 'imposter',
        )
        const randomStarter = civilianPlayers[Math.floor(Math.random() * civilianPlayers.length)]
        lobby.discussionStarterId = randomStarter ? randomStarter.id : ''
        lobby.phase = 'discussion'
        lobby.autoVotingDeadlineAt = Date.now() + AUTO_VOTING_DELAY_MS

        scheduleAutoVoting(lobby)
    }
}

function initiateVoting(lobby) {
    if (lobby.phase !== 'discussion') {
        return { ok: false, error: 'Discussion has not started yet.' }
    }

    const allReady = lobby.activePlayerIds.every((playerId) =>
        lobby.readyPlayerIds.includes(playerId),
    )

    if (!allReady) {
        return { ok: false, error: 'Wait until everyone is ready.' }
    }

    clearAutoVotingTimer(lobby)
    lobby.phase = 'voting'
    lobby.votesByPlayerId = {}
    lobby.votingDeadlineAt = Date.now() + VOTING_DURATION_MS
    scheduleVotingDeadline(lobby)
    return { ok: true }
}

function revealResult(lobby) {
    const activePlayers = findActivePlayers(lobby)
    const eliminatedIds = determineEliminatedIds(lobby)

    clearLobbyTimers(lobby)
    lobby.phase = 'result'
    lobby.eliminatedIds = eliminatedIds
    lobby.roster = lobby.roster.map((player) => ({
        ...player,
        revealed: player.revealed,
        role: player.role,
    }))

    return {
        eliminatedPlayers: eliminatedIds
            .map((playerId) => activePlayers.find((entry) => entry.id === playerId))
            .filter(Boolean),
    }
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
    let clientId = randomUUID()
    clients.set(clientId, {
        ws,
        role: 'guest',
        lobbyCode: '',
        playerId: '',
        hostClientId: '',
    })

    send(ws, {
        type: 'connected',
        clientId,
        view: { kind: 'home' },
    })

    ws.on('message', (rawMessage) => {
        let message
        try {
            message = JSON.parse(rawMessage.toString())
        } catch {
            send(ws, { type: 'error', message: 'Invalid message format.' })
            return
        }

        if (message.type === 'hello') {
            if (message.clientId) {
                clientId = message.clientId
            }

            const existingRecord = clients.get(clientId)
            if (!existingRecord) {
                clients.set(clientId, {
                    ws,
                    role: 'guest',
                    lobbyCode: '',
                    playerId: '',
                    hostClientId: '',
                })
            } else {
                existingRecord.ws = ws
            }

            send(ws, {
                type: 'connected',
                clientId,
                view: buildViewForClient(clientId),
            })
            return
        }

        const record = clients.get(clientId)
        if (!record) {
            send(ws, { type: 'error', message: 'Client not registered.' })
            return
        }

        if (message.type === 'createLobby') {
            const lobby = createLobby(clientId)
            record.role = 'host'
            record.lobbyCode = lobby.code
            record.playerId = ''
            record.hostClientId = clientId
            sendView(clientId)
            return
        }

        if (message.type === 'addPlayer') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            if (record.role !== 'host' || lobby.phase !== 'lobby') {
                send(ws, { type: 'error', message: 'Only the host can edit the lobby.' })
                return
            }

            const name = String(message.name || '').trim()
            if (!name) {
                send(ws, { type: 'error', message: 'Enter a player name.' })
                return
            }

            const duplicate = lobby.roster.some(
                (player) => player.name.toLowerCase() === name.toLowerCase(),
            )
            if (duplicate) {
                send(ws, { type: 'error', message: 'That player name is already in the lobby.' })
                return
            }

            lobby.roster.push({
                id: randomUUID(),
                name,
                clientId: '',
                active: false,
                revealed: false,
                role: null,
                word: '',
            })
            broadcastLobby(lobby)
            return
        }

        if (message.type === 'removePlayer') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            if (record.role !== 'host' || lobby.phase !== 'lobby') {
                send(ws, { type: 'error', message: 'Only the host can edit the lobby.' })
                return
            }

            lobby.roster = lobby.roster.filter((player) => player.id !== message.playerId)
            broadcastLobby(lobby)
            return
        }

        if (message.type === 'setImposterCount') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            if (record.role !== 'host' || lobby.phase !== 'lobby') {
                send(ws, { type: 'error', message: 'Only the host can edit the lobby.' })
                return
            }

            const count = Number(message.count)
            if (count === 1 || count === 2) {
                lobby.imposterCount = count
                broadcastLobby(lobby)
            }
            return
        }

        if (message.type === 'joinLobby') {
            const joinCode = String(message.code || '').trim().toUpperCase()
            const lobby = lobbies.get(joinCode)
            if (!lobby) {
                send(ws, { type: 'error', message: 'That party ID was not found.' })
                return
            }

            if (lobby.phase !== 'lobby') {
                send(ws, { type: 'error', message: 'This lobby has already started.' })
                return
            }

            const name = String(message.name || '').trim()
            if (!name) {
                send(ws, { type: 'error', message: 'Enter your name.' })
                return
            }

            const duplicate = lobby.roster.find(
                (entry) => entry.name.toLowerCase() === name.toLowerCase(),
            )
            if (duplicate && duplicate.clientId !== clientId) {
                send(ws, { type: 'error', message: 'That name is already connected on another device.' })
                return
            }

            const existingPlayer = lobby.roster.find(
                (entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.clientId === clientId,
            )

            let player = existingPlayer

            if (player) {
                player.clientId = clientId
                player.active = false
            } else {
                player = {
                    id: randomUUID(),
                    name,
                    clientId,
                    active: false,
                    revealed: false,
                    role: null,
                    word: '',
                }

                lobby.roster.push(player)
            }

            record.role = 'player'
            record.lobbyCode = lobby.code
            record.playerId = player.id
            record.hostClientId = lobby.hostClientId
            sendView(clientId)
            broadcastLobby(lobby)
            return
        }

        if (message.type === 'leaveLobby') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                resetClientRecord(record)
                sendView(clientId)
                return
            }

            if (lobby.phase !== 'lobby') {
                send(ws, { type: 'error', message: 'You can only leave while the lobby is open.' })
                return
            }

            if (record.role === 'host') {
                clearLobbyTimers(lobby)
                for (const [otherClientId, otherRecord] of clients.entries()) {
                    if (otherRecord.lobbyCode !== lobby.code) {
                        continue
                    }

                    resetClientRecord(otherRecord)
                    sendView(otherClientId)
                }

                lobbies.delete(lobby.code)
                return
            }

            if (record.role === 'player') {
                lobby.roster = lobby.roster.filter((player) => player.id !== record.playerId)
                resetClientRecord(record)
                sendView(clientId)
                broadcastLobby(lobby)
                return
            }

            resetClientRecord(record)
            sendView(clientId)
            return
        }

        if (message.type === 'startGame') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            if (record.role !== 'host' || lobby.phase !== 'lobby') {
                send(ws, { type: 'error', message: 'Only the host can start the game.' })
                return
            }

            const joinedPlayers = lobby.roster.filter((player) => player.clientId)
            if (joinedPlayers.length < MIN_PLAYERS) {
                send(ws, {
                    type: 'error',
                    message: 'Wait until at least 2 players have joined before starting.',
                })
                return
            }

            const result = startGame(lobby)
            if (!result.ok) {
                send(ws, { type: 'error', message: result.error })
                return
            }

            broadcastLobby(lobby)
            return
        }

        if (message.type === 'revealReady') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            const player = lobby.roster.find((entry) => entry.id === record.playerId)
            if (!player || lobby.phase !== 'reveal') {
                send(ws, { type: 'error', message: 'You cannot reveal right now.' })
                return
            }

            if (!lobby.readyPlayerIds.includes(player.id)) {
                lobby.readyPlayerIds.push(player.id)
            }
            player.revealed = true
            moveToDiscussionIfReady(lobby)
            broadcastLobby(lobby)
            return
        }

        if (message.type === 'initiateVoting') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            if (record.role !== 'host') {
                send(ws, { type: 'error', message: 'Only the host can initiate voting.' })
                return
            }

            const result = initiateVoting(lobby)
            if (!result.ok) {
                send(ws, { type: 'error', message: result.error })
                return
            }

            broadcastLobby(lobby)
            return
        }

        if (message.type === 'castVote') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            const player = lobby.roster.find((entry) => entry.id === record.playerId)
            if (!player || lobby.phase !== 'voting') {
                send(ws, { type: 'error', message: 'Voting is not open.' })
                return
            }

            if (lobby.votesByPlayerId[player.id]) {
                send(ws, { type: 'error', message: 'You have already voted.' })
                return
            }

            const targetId = String(message.targetId || '')
            const target = lobby.roster.find((entry) => entry.id === targetId && lobby.activePlayerIds.includes(entry.id))
            if (!target) {
                send(ws, { type: 'error', message: 'Choose a valid player to vote for.' })
                return
            }

            lobby.votesByPlayerId[player.id] = targetId
            if (Object.keys(lobby.votesByPlayerId).length === lobby.activePlayerIds.length) {
                revealResult(lobby)
            }
            broadcastLobby(lobby)
            return
        }

        if (message.type === 'resetLobby') {
            const lobby = getLobbyForClient(clientId)
            if (!lobby) {
                send(ws, { type: 'error', message: 'Lobby not found.' })
                return
            }

            if (record.role !== 'host' || lobby.phase !== 'result') {
                send(ws, { type: 'error', message: 'Only the host can reset the lobby.' })
                return
            }

            lobby.phase = 'lobby'
            clearLobbyTimers(lobby)
            lobby.word = ''
            lobby.category = ''
            lobby.discussionStarterId = ''
            lobby.imposterIds = []
            lobby.activePlayerIds = []
            lobby.readyPlayerIds = []
            lobby.votesByPlayerId = {}
            lobby.eliminatedIds = []
            lobby.roster = lobby.roster.map((player) => ({
                ...player,
                active: false,
                revealed: false,
                role: null,
                word: '',
            }))
            broadcastLobby(lobby)
        }
    })

    ws.on('close', () => {
        const record = clients.get(clientId)
        if (record && record.ws === ws) {
            record.ws = null
        }
    })
})

console.log(`Lobby server running on ws://localhost:${PORT}`)
