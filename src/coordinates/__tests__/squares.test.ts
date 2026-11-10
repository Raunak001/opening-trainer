import { describe, expect, it } from 'vitest'
import { ALL_SQUARES, isSquare, sameDiagonal, squareColor, squaresForView } from '../squares'

describe('squares', () => {
  it('lists 64 distinct squares', () => {
    expect(ALL_SQUARES).toHaveLength(64)
    expect(new Set(ALL_SQUARES).size).toBe(64)
    expect(ALL_SQUARES[0]).toBe('a1')
    expect(ALL_SQUARES[63]).toBe('h8')
  })

  it('colours squares like a real board', () => {
    expect(squareColor('a1')).toBe('dark')
    expect(squareColor('h1')).toBe('light')
    expect(squareColor('d1')).toBe('light') // queen on her colour
    expect(squareColor('e8')).toBe('light')
    expect(squareColor('d8')).toBe('dark')
    expect(squareColor('e4')).toBe('light')
    expect(squareColor('d4')).toBe('dark')
  })

  it('validates square names', () => {
    expect(isSquare('e4')).toBe(true)
    expect(isSquare('i4')).toBe(false)
    expect(isSquare('e9')).toBe(false)
    expect(isSquare('E4')).toBe(false)
  })

  it('finds diagonals', () => {
    expect(sameDiagonal('c1', 'h6')).toBe(true)
    expect(sameDiagonal('a8', 'h1')).toBe(true)
    expect(sameDiagonal('c1', 'h5')).toBe(false)
    expect(sameDiagonal('e4', 'e4')).toBe(false)
  })

  it('orders squares top-left first for each view', () => {
    const white = squaresForView('white')
    const black = squaresForView('black')
    expect(white[0]).toBe('a8')
    expect(white[63]).toBe('h1')
    expect(black[0]).toBe('h1')
    expect(black[63]).toBe('a8')
  })
})
