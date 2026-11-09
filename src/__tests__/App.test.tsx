import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('App', () => {
  it('opens on the library', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Opening library' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(await screen.findByRole('button', { name: 'Caro-Kann Defense, Black' }))
    expect(await screen.findByRole('heading', { name: 'Caro-Kann Defense' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '‹ Library' }))
    expect(screen.getByRole('heading', { name: 'Opening library' })).toBeInTheDocument()
  })

  it('switches between the views', async () => {
    render(<App />)
    const main = screen.getByRole('navigation', { name: 'Main' })
    expect(
      within(main)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Library', 'Practice all', 'Lessons', 'Progress', 'Import', 'Backup', 'Advanced'])

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
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
      await screen.findByText(/Loading progress|No courses yet|Due today/, {}, { timeout: 4000 }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lessons' }))
    expect(screen.getByRole('heading', { name: 'Lesson packs' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('heading', { name: 'Import games' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Backup' }))
    expect(screen.getByRole('heading', { name: 'Backup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Practice all' }))
    expect(
      await screen.findByText(/Loading your cards|Nothing is due right now/),
    ).toBeInTheDocument()
    // The hardcoded sample lines are gone from the app.
    expect(screen.queryByRole('button', { name: 'Drill' })).not.toBeInTheDocument()
  })
})
