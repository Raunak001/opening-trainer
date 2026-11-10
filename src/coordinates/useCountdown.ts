import { useEffect, useRef, useState } from 'react'

/** Milliseconds left of a countdown that starts on mount; calls `onEnd` once at zero. */
export function useCountdown(totalMs: number, onEnd: () => void): number {
  const [left, setLeft] = useState(totalMs)
  const onEndRef = useRef(onEnd)
  useEffect(() => {
    onEndRef.current = onEnd
  }, [onEnd])
  useEffect(() => {
    const start = performance.now()
    let done = false
    const id = window.setInterval(() => {
      const remaining = Math.max(0, totalMs - (performance.now() - start))
      setLeft(remaining)
      if (remaining === 0 && !done) {
        done = true
        window.clearInterval(id)
        onEndRef.current()
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [totalMs])
  return left
}
