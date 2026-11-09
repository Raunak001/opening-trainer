import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidePanel, type SidePanelProps } from '../SidePanel'

const base: SidePanelProps = {
  coachMessage: 'Nice, that develops a piece.',
  prompt: 'Play the main line for White.',
  challenge: 3,
  challengeCount: 10,
  completed: 2,
}

describe('SidePanel', () => {
  it('shows coach message, prompt and challenge counter', () => {
    render(<SidePanel {...base} />)
    expect(screen.getByText('Nice, that develops a piece.')).toBeInTheDocument()
    expect(screen.getByText('Play the main line for White.')).toBeInTheDocument()
    expect(screen.getByText('Challenge 3/10')).toBeInTheDocument()
  })

  it('shows the line so far when given moves', () => {
    render(<SidePanel {...base} moves={{ moves: ['e4', 'c6'] }} />)
    expect(screen.getByRole('list', { name: 'Moves' })).toHaveTextContent('1.e4c6')
  })

  it('reports progress from completed challenges', () => {
    render(<SidePanel {...base} />)
    const bar = screen.getByRole('progressbar', { name: 'Progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(bar.firstElementChild).toHaveStyle({ width: '20%' })
  })

  it('keeps the progress bar in range', () => {
    const { rerender } = render(<SidePanel {...base} completed={12} />)
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '100%' })
    rerender(<SidePanel {...base} challengeCount={0} completed={0} />)
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '0%' })
  })

  it('calls the button handlers', () => {
    const onHint = vi.fn()
    const onBack = vi.fn()
    const onForward = vi.fn()
    render(
      <SidePanel
        {...base}
        onHint={onHint}
        onBack={onBack}
        onForward={onForward}
        canGoBack
        canGoForward
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(onHint).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onForward).toHaveBeenCalledOnce()
  })

  it('disables navigation by default and hint on request', () => {
    render(<SidePanel {...base} hintDisabled />)
    expect(screen.getByRole('button', { name: 'Hint' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })
})
