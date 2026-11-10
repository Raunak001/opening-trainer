/// <reference lib="webworker" />
import { buildOpeningIndex, parseOpeningsTsv } from './openings'
import a from './openings/a.tsv?raw'
import b from './openings/b.tsv?raw'
import c from './openings/c.tsv?raw'
import d from './openings/d.tsv?raw'
import e from './openings/e.tsv?raw'

// Builds the opening-name index off the main thread: replaying ~3,900 lines with chess.js
// takes a few hundred milliseconds, which would otherwise freeze the page.
try {
  const index = buildOpeningIndex([a, b, c, d, e].flatMap(parseOpeningsTsv))
  self.postMessage({ index })
} catch (err) {
  self.postMessage({ error: err instanceof Error ? err.message : String(err) })
}
