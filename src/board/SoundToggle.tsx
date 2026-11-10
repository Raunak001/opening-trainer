import { useEffect, useState } from 'react'
import { getDb, getSettings, updateSettings, type TrainerDB } from '../db'
import { configureSound, primeAudio } from './audio'

/** Loads the saved sound setting into the player and lets the user turn sounds on or off. */
export function SoundToggle({ db: dbProp }: { db?: TrainerDB }) {
  const db = dbProp ?? getDb()
  const [on, setOn] = useState<boolean>()
  useEffect(() => {
    let live = true
    getSettings(db)
      .then((s) => {
        configureSound(s.sound)
        if (live) setOn(s.sound.enabled)
      })
      .catch(() => {
        // Sounds stay on their defaults.
      })
    return () => {
      live = false
    }
  }, [db])

  // Wake the audio output on the first click or key press, before the first move needs it.
  useEffect(() => {
    if (!on) return
    const prime = () => primeAudio()
    const opts = { once: true, capture: true } as const
    window.addEventListener('pointerdown', prime, opts)
    window.addEventListener('keydown', prime, opts)
    return () => {
      window.removeEventListener('pointerdown', prime, opts)
      window.removeEventListener('keydown', prime, opts)
    }
  }, [on])

  if (on === undefined) return null
  const toggle = () => {
    const next = !on
    setOn(next)
    configureSound({ enabled: next })
    updateSettings(db, { sound: { enabled: next } }).catch(() => {})
  }
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      title={on ? 'Turn sounds off' : 'Turn sounds on'}
      onClick={toggle}
    >
      {on ? 'Sound on' : 'Sound off'}
    </button>
  )
}
