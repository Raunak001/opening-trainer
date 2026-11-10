import { useEffect, useState } from 'react'
import { getDb, getSettings, updateSettings, type TrainerDB } from '../db'
import { configureSound } from './audio'

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
