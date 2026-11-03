import './sidePanel.css'

export interface SidePanelProps {
  /** Coach speech bubble, e.g. feedback on the last move. */
  coachMessage: string
  /** What the user should do now, e.g. "Play the main line for White." */
  prompt: string
  /** 1-based index of the current challenge. */
  challenge: number
  challengeCount: number
  /** Challenges finished so far; drives the progress bar. */
  completed: number
  onHint?: () => void
  hintDisabled?: boolean
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
}

export function SidePanel({
  coachMessage,
  prompt,
  challenge,
  challengeCount,
  completed,
  onHint,
  hintDisabled = false,
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
}: SidePanelProps) {
  const percent = challengeCount > 0 ? Math.min(100, (completed / challengeCount) * 100) : 0

  return (
    <aside className="side-panel" aria-label="Trainer panel">
      <header className="side-panel__header">
        <span className="side-panel__challenge">
          Challenge {challenge}/{challengeCount}
        </span>
        <div
          className="side-panel__progress"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={challengeCount}
          aria-valuenow={completed}
        >
          <div className="side-panel__progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </header>

      <div className="side-panel__coach">
        <img className="side-panel__avatar" src="/pieces/wN.svg" alt="" />
        <p className="side-panel__bubble">{coachMessage}</p>
      </div>

      <p className="side-panel__prompt">{prompt}</p>

      <footer className="side-panel__footer">
        <button type="button" className="side-panel__hint" onClick={onHint} disabled={hintDisabled}>
          Hint
        </button>
        <div className="side-panel__nav">
          <button
            type="button"
            className="side-panel__nav-button"
            aria-label="Back"
            onClick={onBack}
            disabled={!canGoBack}
          >
            ‹
          </button>
          <button
            type="button"
            className="side-panel__nav-button"
            aria-label="Forward"
            onClick={onForward}
            disabled={!canGoForward}
          >
            ›
          </button>
        </div>
      </footer>
    </aside>
  )
}
