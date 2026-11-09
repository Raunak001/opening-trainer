import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LinePreview } from '../LinePreview'
import { MoveList } from '../MoveList'

const CARO = ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5']

const current = () =>
  within(screen.getByRole('list', { name: 'Moves' }))
    .queryAllByRole('button')
    .find((b) => b.getAttribute('aria-current') === 'true')?.textContent

describe('MoveList', () => {
  it('shows numbered moves with the last one highlighted', () => {
    render(<MoveList moves={CARO} />)
    const list = screen.getByRole('list', { name: 'Moves' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(list).toHaveTextContent('1.e4c62.d4d53.e5Bf5')
    expect(within(list).getByText('Bf5')).toHaveAttribute('aria-current', 'true')
  })

  it('says so when there are no moves', () => {
    render(<MoveList moves={[]} />)
    expect(screen.getByText('No moves yet.')).toBeInTheDocument()
  })
})

describe('LinePreview', () => {
  it('steps back and forward with buttons and arrow keys', () => {
    render(<LinePreview moves={CARO} title="Advance Variation" />)
    expect(screen.getByText('6/6')).toBeInTheDocument()
    expect(current()).toBe('Bf5')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('5/6')).toBeInTheDocument()
    expect(current()).toBe('e5')

    const region = screen.getByRole('region', { name: 'Advance Variation' })
    fireEvent.keyDown(region, { key: 'Home' })
    expect(screen.getByText('0/6')).toBeInTheDocument()
    expect(current()).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()

    fireEvent.keyDown(region, { key: 'ArrowRight' })
    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(screen.getByText('2/6')).toBeInTheDocument()
    expect(current()).toBe('c6')

    fireEvent.click(screen.getByRole('button', { name: 'd5' }))
    expect(screen.getByText('4/6')).toBeInTheDocument()

    fireEvent.keyDown(region, { key: 'End' })
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('opens at the requested move', () => {
    render(<LinePreview moves={CARO} initialPly={0} />)
    expect(screen.getByText('0/6')).toBeInTheDocument()
  })
})
