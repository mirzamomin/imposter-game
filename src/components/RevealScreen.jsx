function RevealScreen({ players, currentRevealIndex, revealed, onReveal, onNext }) {
    const currentPlayer = players[currentRevealIndex]
    const total = players.length

    if (!currentPlayer) {
        return null
    }

    return (
        <section className="panel reveal-screen">
            <p className="step">Reveal {currentRevealIndex + 1} of {total}</p>
            <h1>{currentPlayer.name}</h1>
            <p className="subtitle">Make sure nobody else can see your screen.</p>

            <button
                type="button"
                className={`reveal-card ${revealed ? 'is-revealed' : ''}`}
                onClick={revealed ? undefined : onReveal}
            >
                {!revealed ? (
                    <span>Tap to reveal your role</span>
                ) : currentPlayer.isImposter ? (
                    <>
                        <span className="imposter-label">YOU ARE THE IMPOSTER</span>
                        <small>Blend in and figure out the word.</small>
                    </>
                ) : (
                    <>
                        <span className="word-label">{currentPlayer.word}</span>
                        <small>Use this word in the discussion.</small>
                    </>
                )}
            </button>

            {revealed ? (
                <button type="button" className="btn primary" onClick={onNext}>
                    Done, pass to next player
                </button>
            ) : null}
        </section>
    )
}

export default RevealScreen
