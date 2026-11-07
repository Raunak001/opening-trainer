import { useState } from 'react'
import { BuilderPage, TreeViewer } from './repertoire'
import { DrillPage, ReviewPage } from './trainer'

type View = 'review' | 'drill' | 'build' | 'tree'

const VIEWS: { id: View; label: string }[] = [
  { id: 'drill', label: 'Drill' },
  { id: 'review', label: 'Review' },
  { id: 'build', label: 'Build' },
  { id: 'tree', label: 'Tree' },
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
      {view === 'review' && <ReviewPage />}
      {view === 'drill' && <DrillPage />}
      {view === 'build' && <BuilderPage />}
      {view === 'tree' && <TreeViewer />}
    </>
  )
}

export default App
