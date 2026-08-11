function VotingScreen({ players, votes, castVotesCount, totalVoters, onVote, onRevealResult }) {
    const canReveal = castVotesCount === totalVoters

    return (
        <section className="panel">
            <h1>Vote</h1>
            <p className="subtitle">Each player casts one vote to eliminate a suspect.</p>

            <p className="step">
                Votes cast: {castVotesCount} / {totalVoters}
            </p>

            <div className="vote-grid">
                {players.map((player) => (
                    <button
                        key={player.id}
                        type="button"
                        className="vote-card"
                        onClick={() => onVote(player.id)}
                    >
                        <span>{player.name}</span>
                        <strong>{votes[player.id] || 0} votes</strong>
                    </button>
                ))}
            </div>

            <button type="button" className="btn primary full" onClick={onRevealResult} disabled={!canReveal}>
                Reveal Result
            </button>
        </section>
    )
}

export default VotingScreen
