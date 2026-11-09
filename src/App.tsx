import { useState } from 'react'
// Not re-exported from the db index, which pure code imports: keep React out of it.
import { BackupPage } from './db/BackupPage'
import { ImportPage } from './importer'
import { LessonsPage } from './lessons'
import { BuilderPage, TreeViewer } from './repertoire'
import { DrillPage, ProgressPage, ReviewPage } from './trainer'

type View = 'review' | 'progress' | 'drill' | 'lessons' | 'build' | 'tree' | 'import' | 'backup'

const VIEWS: { id: View; label: string }[] = [
  { id: 'drill', label: 'Drill' },
  { id: 'review', label: 'Review' },
  { id: 'progress', label: 'Progress' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'build', label: 'Build' },
  { id: 'tree', label: 'Tree' },
  { id: 'import', label: 'Import' },
  { id: 'backup', label: 'Backup' },
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
      {view === 'progress' && <ProgressPage onStartReview={() => setView('review')} />}
      {view === 'drill' && <DrillPage />}
      {view === 'lessons' && <LessonsPage />}
      {view === 'build' && <BuilderPage />}
      {view === 'tree' && <TreeViewer />}
      {view === 'import' && <ImportPage />}
      {view === 'backup' && <BackupPage />}
    </>
  )
}

export default App
