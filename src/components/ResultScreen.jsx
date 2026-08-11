function ResultScreen({ eliminatedPlayers, wasImposter, word, onPlayAgain, onReset }) {
    const names = eliminatedPlayers.map((player) => player.name).join(', ')

    return (
        <section className="panel result-screen">
            <h1>Result</h1>
            <p className="subtitle">Secret word: <strong>{word}</strong></p>

            <div className="result-box">
                <p className="step">Eliminated</p>
                <h2>{names || 'Nobody'}</h2>
                <p>
                    {eliminatedPlayers.length > 1
                        ? wasImposter
                            ? 'At least one eliminated player was an Imposter.'
                            : 'No eliminated players were Imposters.'
                        : wasImposter
                            ? 'They were an Imposter.'
                            : 'They were not an Imposter.'}
                </p>
            </div>

            <div className="row">
                <button type="button" className="btn primary" onClick={onPlayAgain}>
                    Play Again
                </button>
                <button type="button" className="btn" onClick={onReset}>
                    New Game
                </button>
            </div>
        </section>
    )
}

export default ResultScreen
