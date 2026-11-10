import { useState } from 'react'
import { SoundToggle } from './board/SoundToggle'
// Not re-exported from the db index, which pure code imports: keep React out of it.
import { BackupPage } from './db/BackupPage'
import { ImportPage } from './importer'
import { LessonsPage } from './lessons'
// Not re-exported from the puzzles index, which pure code imports: keep React out of it.
import { PuzzlesPage } from './puzzles/PuzzlesPage'
import { BuilderPage, TreeViewer } from './repertoire'
import { CoursePage, LibraryPage, ProgressPage, ReviewPage } from './trainer'

type View =
  'library' | 'practice' | 'puzzles' | 'lessons' | 'progress' | 'import' | 'backup' | 'advanced'
type AdvancedView = 'build' | 'tree'

const VIEWS: { id: View; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'practice', label: 'Practice all' },
  { id: 'puzzles', label: 'Puzzles' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'progress', label: 'Progress' },
  { id: 'import', label: 'Import' },
  { id: 'backup', label: 'Backup' },
  { id: 'advanced', label: 'Advanced' },
]

const ADVANCED: { id: AdvancedView; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'tree', label: 'Tree' },
]

function App() {
  const [view, setView] = useState<View>('library')
  // The open course, when the library shows one.
  const [course, setCourse] = useState<string>()
  const [advanced, setAdvanced] = useState<AdvancedView>('build')

  return (
    <>
      <nav className="app-nav" aria-label="Main">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={view === v.id ? 'page' : undefined}
            onClick={() => {
              setView(v.id)
              setCourse(undefined)
            }}
          >
            {v.label}
          </button>
        ))}
        <SoundToggle />
      </nav>
      {view === 'advanced' && (
        <nav className="app-nav app-nav--sub" aria-label="Advanced">
          {ADVANCED.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={advanced === v.id ? 'page' : undefined}
              onClick={() => setAdvanced(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
      )}
      {view === 'library' &&
        (course ? (
          <CoursePage key={course} entryId={course} onBack={() => setCourse(undefined)} />
        ) : (
          <LibraryPage onOpen={setCourse} />
        ))}
      {view === 'practice' && <ReviewPage />}
      {view === 'puzzles' && <PuzzlesPage />}
      {view === 'progress' && <ProgressPage onStartReview={() => setView('practice')} />}
      {view === 'lessons' && <LessonsPage />}
      {view === 'import' && <ImportPage />}
      {view === 'backup' && <BackupPage />}
      {view === 'advanced' && advanced === 'build' && <BuilderPage />}
      {view === 'advanced' && advanced === 'tree' && <TreeViewer />}
    </>
  )
}

export default App
