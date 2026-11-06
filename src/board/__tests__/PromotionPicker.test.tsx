import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PromotionPicker } from '../PromotionPicker'

function setup(props: Partial<Parameters<typeof PromotionPicker>[0]> = {}) {
  const onPick = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <PromotionPicker
      color="white"
      dest="e8"
      orientation="white"
      onPick={onPick}
      onCancel={onCancel}
      {...props}
    />,
  )
  const column = view.container.querySelector('.promotion__column') as HTMLElement
  return { onPick, onCancel, column }
}

describe('PromotionPicker', () => {
  it('offers queen, knight, rook, bishop in the pawn color, queen focused', () => {
    setup()
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Queen', 'Knight', 'Rook', 'Bishop', 'Cancel'])
    const img = screen.getByRole('button', { name: 'Queen' }).querySelector('img')
    expect(img).toHaveAttribute('src', '/pieces/wQ.svg')
    expect(screen.getByRole('button', { name: 'Queen' })).toHaveFocus()
  })

  it('reports the chosen piece', () => {
    const { onPick } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Knight' }))
    expect(onPick).toHaveBeenCalledWith('n')
  })

  it('cancels on the close button, Escape, or a click outside the column', () => {
    const { onCancel, column } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Queen' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(3)

    fireEvent.click(column)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('places the column over the promotion square', () => {
    expect(setup().column).toHaveStyle({ left: '50%' })
    expect(setup().column).toHaveClass('promotion__column--top')
  })

  it('anchors to the bottom when the promotion square is at the bottom edge', () => {
    // Black promotes on h1; seen from White, h1 is the bottom-right square.
    const { column } = setup({ color: 'black', dest: 'h1' })
    expect(column).toHaveStyle({ left: '87.5%' })
    expect(column).toHaveClass('promotion__column--bottom')
    const img = screen.getByRole('button', { name: 'Queen' }).querySelector('img')
    expect(img).toHaveAttribute('src', '/pieces/bQ.svg')
  })

  it('mirrors the file when the board is flipped', () => {
    // Black promotes on h1 with Black at the bottom: h1 is the top-left square.
    const { column } = setup({ color: 'black', dest: 'h1', orientation: 'black' })
    expect(column).toHaveStyle({ left: '0%' })
    expect(column).toHaveClass('promotion__column--top')
  })
})
