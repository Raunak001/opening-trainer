import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('App', () => {
  it('renders the drill page', () => {
    render(<App />)
    expect(screen.getByText(/drill the Italian Game\. You play White/)).toBeInTheDocument()
    expect(screen.getByText('Challenge 1/8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play Black' })).toBeInTheDocument()
  })
})
