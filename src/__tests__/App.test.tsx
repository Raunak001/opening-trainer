import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('App', () => {
  it('renders the board test page', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Flip board' })).toBeInTheDocument()
    expect(screen.getByTestId('moves')).toHaveTextContent('Start position')
  })
})
