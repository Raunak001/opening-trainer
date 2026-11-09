import 'fake-indexeddb/auto'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('App', () => {
  it('renders the drill page', () => {
    render(<App />)
    expect(screen.getByText(/drill the Italian Game\. You play White/)).toBeInTheDocument()
    expect(screen.getByText('Challenge 1/8')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Promotion (Black)' })).toBeInTheDocument()
  })

  it('switches between the views', async () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Drill' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    expect(screen.getByRole('heading', { name: 'New repertoire' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText(/Challenge/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText(/No repertoires yet|Start position/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Progress' }))
    expect(screen.getByRole('button', { name: 'Progress' })).toHaveAttribute('aria-current', 'page')
    expect(
      await screen.findByText(
        /Loading progress|No repertoires yet|Due today/,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lessons' }))
    expect(screen.getByRole('heading', { name: 'Lesson packs' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('heading', { name: 'Import games' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Backup' }))
    expect(screen.getByRole('heading', { name: 'Backup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Drill' }))
    expect(screen.getByText('Challenge 1/8')).toBeInTheDocument()
  })
})
