function SetupScreen({
    nameInput,
    onNameInputChange,
    onAddPlayer,
    players,
    onRemovePlayer,
    imposterCount,
    maxImposters,
    onChangeImposterCount,
    onStart,
}) {
    const canStart = players.length >= 2 && players.length <= 10

    return (
        <section className="panel">
            <h1>Abdullah Sexy</h1>
            <p className="subtitle">Build the lobby, then pass the phone around for private reveals.</p>

            <div className="block">
                <h2>Players ({players.length}/10)</h2>
                <div className="row">
                    <input
                        type="text"
                        value={nameInput}
                        onChange={(event) => onNameInputChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault()
                                onAddPlayer()
                            }
                        }}
                        maxLength={24}
                        placeholder="Add player name"
                        aria-label="Add player name"
                    />
                    <button type="button" className="btn" onClick={onAddPlayer}>
                        Add
                    </button>
                </div>

                <ul className="player-list">
                    {players.map((player) => (
                        <li key={player.id}>
                            <span>{player.name}</span>
                            <button
                                type="button"
                                className="ghost-btn"
                                onClick={() => onRemovePlayer(player.id)}
                                aria-label={`Remove ${player.name}`}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="block">
                <h2>Imposters</h2>
                <div className="option-row">
                    <button
                        type="button"
                        className={`option ${imposterCount === 1 ? 'active' : ''}`}
                        onClick={() => onChangeImposterCount(1)}
                    >
                        1
                    </button>
                    <button
                        type="button"
                        className={`option ${imposterCount === 2 ? 'active' : ''}`}
                        onClick={() => onChangeImposterCount(2)}
                        disabled={maxImposters < 2}
                    >
                        2
                    </button>
                </div>
                <p className="hint">2 imposters unlocks when there are at least 4 players.</p>
            </div>

            <button type="button" className="btn primary full" onClick={onStart} disabled={!canStart}>
                Start Game
            </button>
        </section>
    )
}

export default SetupScreen
