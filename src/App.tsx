import { useState } from 'react'
import { BuilderPage } from './repertoire'
import { DrillPage } from './trainer'

type View = 'drill' | 'build'

const VIEWS: { id: View; label: string }[] = [
  { id: 'drill', label: 'Drill' },
  { id: 'build', label: 'Build' },
]

function App() {
  const [view, setView] = useState<View>('drill')

  return (
    <>
      <nav className="app-nav" aria-label="Main">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={view === v.id ? 'page' : undefined}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      {view === 'drill' ? <DrillPage /> : <BuilderPage />}
    </>
  )
}

export default App
