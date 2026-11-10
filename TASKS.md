# Opening Trainer — Tasks

One ticket = one Claude Code session = one commit. Size: S < 2h, M 2–6h, L > 6h (L tickets are split into a/b parts).
Prompt to start a ticket: `Do T1.3. Follow CLAUDE.md. Stop and ask if anything is ambiguous.`

---

## Phase 0 — Setup

**Phase done when:** `npm run dev` shows a page, `npm test` passes, token loads from `.env.local`.

- [x] **T0.1 Scaffold** (S) — Vite `react-ts` template, TS strict, ESLint, Prettier, Vitest, `typecheck` script. Done when: all four commands in CLAUDE.md run clean.
- [x] **T0.2 Dependencies + engine files** (S) — install `chess.js chessground dexie dexie-react-hooks ts-fsrs stockfish`, pin versions; add a `postinstall` script that copies the lite single-threaded `.js`/`.wasm` into `public/engine/`. Done when: fresh `npm i` populates `public/engine/`.
- [x] **T0.3 Env + folders** (S) — `.env.example` with `VITE_LICHESS_TOKEN=`, confirm `.env.local` gitignored, create `src/` folders from CLAUDE.md with an `index.ts` each. Done when: `import.meta.env.VITE_LICHESS_TOKEN` is typed (`vite-env.d.ts`) and defined at runtime.
- **Manual (you):** create the no-scope Lichess token and put it in `.env.local`.

## Phase 1 — Playable drill

**Phase done when:** a hardcoded Italian line plays end to end as White and as Black; wrong moves snap back; hint arrow works.

- [x] **T1.1 Board component** (M) — React wrapper around chessground; props: `fen`, `orientation`, `onMove`, `shapes`; `movable.dests` from chess.js. Done when: legal-only dragging works on a test page.
- [x] **T1.2 Theme + pieces** (M) — cream/green squares, inner coordinates, yellow last-move, orange arrow brush; cburnett SVGs with license noted in `public/pieces/LICENSE`. Done when: visually matches reference screenshot layout.
- [x] **T1.3 Side panel shell** (M) — coach bubble, prompt text, "Challenge n/N", progress bar, hint, back/forward. Static props only. Done when: renders beside the board at desktop and narrow widths.
- [x] **T1.4a Drill engine (logic)** (M) — pure state machine: `Line` type (SAN), expected-move check, opponent auto-reply, miss counter, hint state. Unit-tested. Done when: tests cover correct, wrong once, wrong twice, line complete.
- [x] **T1.4b Drill loop (UI)** (M) — wire state machine to board + panel: delayed opponent moves, red flash + snap back, arrow on second miss, input locked during animation. Done when: phase check passes.
- [x] **T1.5 Edge cases** (S) — promotion picker, castling by king drag, en passant. Done when: a test line with each plays correctly.

## Phase 2 — Repertoire builder

**Phase done when:** 1.e4 at 1600–1800 blitz/rapid builds a tree under ~300 positions; rebuilding makes zero network calls.

- [x] **T2.1 Explorer client + cache** (M) — sequential queue, Bearer token, 429 → 60s backoff, Dexie cache by position key + params, mockable fetch. Done when: unit tests for queueing, backoff, cache hit.
- [x] **T2.2 CORS check** (S) — try from the browser; if blocked, add Vite proxy with header injection. Done when: live call succeeds from `npm run dev`.
- [x] **T2.3 Tree model** (M) — nodes keyed by position key, edges with SAN + counts + W/D/B; transposition merging. Done when: test proves two move orders reach one node.
- [x] **T2.4a Pruning algorithm** (M) — pure function over explorer responses using CLAUDE.md defaults + max depth. Done when: fixture-based tests for user-move choice, coverage cutoff, floor cutoff.
- [x] **T2.4b Builder run** (M) — BFS over the tree calling the client, progress callback, cancellable, persists tree. Done when: phase check passes.
- [x] **T2.5 Builder settings UI** (M) — color, start moves, rating band, speeds, coverage %, floor, depth; save as named repertoire.
- [x] **T2.6 Opening names** (S) — bundle Lichess chess-openings TSVs, label nodes by position key.
- [x] **T2.7 Tree viewer + overrides** (M) — collapsible tree with stats; swap chosen move at a node and rebuild that subtree.

## Phase 3 — Spaced repetition

**Phase done when:** reviews push due dates out, a miss returns same session, backup file restores everything.

- [x] **T3.1 Dexie schema** (M) — `repertoires`, `nodes`, `cards`, `reviewLogs`, `settings`, `explorerCache`, `evalCache`; `cards` indexed on `due`. Migrate any Phase 2 tables.
- [x] **T3.2 Cards + FSRS** (M) — generate cards from user-move nodes; `createEmptyCard`, `fsrs().next`, write review log. Done when: unit tests for each rating path.
- [x] **T3.3 Auto-grading** (S) — map outcome + time + hint to rating, thresholds from settings. Unit-tested.
- [x] **T3.4a Due queue** (M) — query due cards, new/review daily caps, same-session requeue for Again. Pure + tested.
- [x] **T3.4b Line-context playback** (M) — for each card walk parent links to root, fast-play prefix, then prompt. Reuses drill UI.
- [x] **T3.5 Progress view** (M) — due today, new left, streak, mastery per line from mean stability.
- [x] **T3.6 Backup/restore** (S) — export all tables to JSON, import with confirmation. **Do this before using the app daily.**

## Phase 4 — Engine feedback

**Phase done when:** off-book moves get a grade and a sentence like "Best was Nxe5, winning a pawn (+1.2)"; repeat positions load evals from cache.

- [x] **T4.1 Engine worker** (M) — Promise API over UCI (`uci`, `isready`, `position fen`, `go depth N`), parse `info score cp|mate pv` and `bestmove`, single in-flight search with cancel. Parser unit-tested.
- [x] **T4.2 Eval cache + grading** (M) — Dexie cache by position key + depth; cp → win% (Lichess formula) → grade.
- [x] **T4.3a Material/hanging checks** (M) — play PV with chess.js, material swing; attackers vs defenders for hanging pieces. Fixture tests.
- [x] **T4.3b Fork/missed-mate checks** (M) — port ideas from lichess-puzzler tagger. Fixture tests.
- [x] **T4.4 Opening-principle rules** (M) — early queen, same piece twice, no castle by move 10, no central pawn, undeveloped minors.
- [x] **T4.5 Template phrase bank** (S) — finding → sentence with variables; wire into drill panel.
- [x] **T4.6 Repertoire sanity check** (S) — flag chosen moves losing > ~0.5 pawns vs best in the builder.
- [x] **T4.7 Play out from book** (M) — after a line ends, 10 moves vs limited-skill Stockfish with grading.

## Phase 5 — Import games

**Phase done when:** syncing a username lists each game's deviation ply; misplayed positions show up as due cards.

- [x] **T5.1 Archive fetch + sync** (M) — sequential month fetch, store immutable past months, refetch current only, proxy if CORS blocks.
- [x] **T5.2 PGN parse + filters** (S) — `loadPgn`, keep user's color and chosen time classes.
- [x] **T5.3 Deviation detection** (M) — walk game vs tree, record who left book and at which ply. Fixture tests.
- [x] **T5.4 Auto-cards** (M) — user left book → card failed + due now; opponent left book and user lost eval → card from engine best.
- [x] **T5.5 Coverage gaps report** (S) — frequent missing opponent replies, button to extend tree.

## Phase 6 — Concept lessons

**Phase done when:** two packs of 5 play end to end with hints; solved lessons join the review queue.

- [x] **T6.1 Lesson schema + player** (M) — JSON `{ id, concept, fen, prompt, accepted[], hints[], explanation }`; player reuses board + panel.
- [x] **T6.2 Authoring tool** (M) — set up/paste FEN, multi-PV Stockfish, auto-accept moves within ~30cp of best, export JSON.
- [x] **T6.3 Position mining** (M) — find concept-matching positions in imported games + explorer.
- [x] **T6.4 First packs** (L, mostly you) — strike the center, develop before attacking, castle early, punish early queen. Claude drafts candidates; you approve.
- [x] **T6.5 Lessons into FSRS** (S) — solved challenge → card.

## Phase 7 — Opening library & Learn mode

Goal: learn openings like a course library (layout inspired by chessreps.com; mimic the flow only, copy nothing). Pick an opening from a catalog, see what it looks like, have each new line shown to you before you must play it, then practice it.

Today's problems this fixes: the Drill tab is stuck on hardcoded sample lines (Italian), and nothing shows you the moves of a line before you are asked to play them.

**Phase done when:** from the Library, pick the Caro-Kann at Essentials depth; its course builds from the explorer; the first line is shown move by move with narration, then played back by you; the course page shows it as learned; the next day it comes up in that course's Practice. No hardcoded line is reachable from the UI.

**Decisions to confirm before starting:**
- Catalog contents: the proposed list in T7.1 (edit freely).
- Depth tiers: Essentials ≈ 8 plies / 70% coverage, Advanced ≈ 12 / 85%, Full ≈ 16 / 90% (T7.3).
- "Systems" (London, King's Indian Attack) — where your move is the same against most replies — need forced user moves across the tree. Deferred to T7.9; not in the first catalog.

**Decided while building (2026-11-09):**
- Tier plies count from the end of the catalog start moves (Caro-Kann Essentials = maxPly 2 + 8).
- Line status: *new* while any of the line's cards is unstudied (lines share first moves); *learned* once every card is studied and none has lapsed (taught in Learn = learned, not strict FSRS Review state); *learning* = a lapsed card being relearned.
- New cards of library courses never enter Practice queues (course or "Practice all"); new lines enter only through Learn. Non-course repertoires (Advanced → Build) keep the old behaviour.
- Moves played with the Learn arrow are graded without time (Good at best), so following an arrow fast never gives Easy.

- [x] **T7.1 Opening catalog** (S) — `src/repertoire/catalog.ts`: curated entries `{ id, name, color, startMoves, blurb, family }`. Names checked against the bundled Lichess openings TSVs; lines still come from the explorer (CLAUDE.md), the catalog only fixes the start. First list — White: Italian, Ruy Lopez, Scotch, Vienna, Queen's Gambit, English. Black: 1…e5, Sicilian, Caro-Kann, French, Scandinavian, QGD, Slav, King's Indian, Nimzo-Indian. Done when: unit test validates every entry (legal start moves, name matches the TSV label of the final position, side to move after the start moves makes sense for the color).
- [x] **T7.2 Move list + line preview** (M) — a move-list panel (numbered SAN, current move highlighted) shown beside the board in Drill, Review, Learn and lessons, so the line so far is always visible. Plus a view-only `LinePreview` (board + move list, ‹ › and arrow keys) for stepping through any line. Done when: every drilling view shows its moves so far, and a preview steps forward/back through a line.
- [x] **T7.3 Courses** (M) — a course = a repertoire built from a catalog entry at a depth tier. Tier → pruning preset; rating band and speeds from settings. "Start course" builds via the existing builder (progress, cancel, explorer cache, 429 backoff) and syncs cards. `RepertoireRow.courseId` + `tier` (optional fields; Dexie version bump with a no-op upgrade only if indexed). Changing tier rebuilds and re-syncs, keeping card history. Done when: building the Caro-Kann at each tier gives nested trees (Essentials ⊂ Advanced ⊂ Full) and rebuilding hits only the cache.
- [x] **T7.4 Lines** (M) — pure: enumerate root-to-leaf lines of a course tree (transpositions: each leaf once, via its most popular path), name each by its deepest opening label, order by how often you will meet it (product of opponent move shares). Line status from its cards: new / learning / learned (all user cards past FSRS learning). Done when: fixture tests for enumeration, naming, ordering, status.
- [x] **T7.5 Library page** (M) — new home view: grid of cards (static mini-board of the start position, name, color, start moves as text, blurb, lines count and learned progress once started), search and filters (color, first move). Click → course page: tier picker on first open, line list from T7.4 with status and preview (T7.2), buttons Learn / Practice. Done when: renders at desktop and narrow widths; starting a course from it works end to end.
- [x] **T7.6a Learn mode (logic)** (M) — pure state machine per line: **show** phase (both sides' moves auto-play one at a time, ‹ › to step, your moves drawn as arrows first), then **play** phase (you play your moves; moves of this line you have not been shown in a learned line get the arrow on the first try; wrong → snap back as in drills). Moves already learned in an earlier line (shared prefix) are fast-played, not re-shown. On completion the line's new cards get their first FSRS review (graded as in Review). Next line = the most frequent line not yet learned, within the daily new-card cap. Done when: tests cover show stepping, play with/without arrows, shared-prefix skip, completion → cards reviewed.
- [x] **T7.6b Learn mode (UI + narration)** (M) — wire T7.6a to board, side panel and move list. Narration from templates only (no LLM): opening name when the position gets a new name; for opponent moves "Black's most common reply here (58% of games)" from tree stats; for your moves its score and share ("scores 55% for White") plus concept tags from `lessons/concepts.ts` (strikes the center, develops, castles, hits the queen) and the cached engine eval when present. Done when: Learn on a fresh course shows then plays its first line with narration on every move.
- [x] **T7.7 Practice per course** (S) — Practice button runs the due queue for that course only (`loadDueQueue` already takes a repertoire id), cards shown in line context with the move list. Library card and course page show due counts. Review tab stays as "Practice all". Done when: a learned line's cards come back in the course's Practice when due.
- [x] **T7.8 Navigation cleanup** (S) — tabs become Library (home), Practice all, Lessons, Progress, Import, Backup, plus Advanced (Build, Tree). Remove the hardcoded-sample Drill page from the UI (sample lines stay as test fixtures). Progress page lists courses by name with per-course mastery. Done when: phase check passes and no UI path leads to `SAMPLE_LINES`.
- [x] **T7.9 Systems** (M) — forced user moves for a course ("always Bf4 when legal") applied as overrides during the build, enabling London / KIA style entries. Add London and KIA to the catalog. Done when: London course plays Bf4 against both 1…d5 and 1…Nf6.
- [x] **T7.10 Chapters** (M) — group a course's lines into chapters by variation, like a course library: chapter = the line's opening name at variation level (`Family: Variation`, sub-variations after the comma dropped); lines named only by the family go to "Other lines". Chapters ordered by how often you meet them. Course page shows each chapter with its lines, learned/total, a progress bar and its own Learn button (next unlearned line in that chapter). Done when: pure grouping is fixture-tested and the Caro-Kann course page shows chapters (Advance, Exchange, …) each learnable on its own.
- [x] **T7.11 Library progress bars** (S) — every library card shows a prominent progress bar with a percentage of lines learned (0% for courses not started), plus due count. Done when: renders at desktop and narrow widths.

## Phase 8 — Puzzles

Goal: rated tactics puzzles like chess.com's puzzle mode, free and offline. Mimic the look only; puzzles come from the Lichess puzzle database (CC0).

**Decided (2026-11-09):** a rating-stratified 21.7k-puzzle subset (ratings 500–2600, low RD, popular) taken from the first ~16 MB of the Lichess file, bundled as `public/puzzles/puzzles.json` and loaded into IndexedDB on first visit. Glicko-2 rating starting at 1000 (RD 350, RD floor 60). A wrong move, a hint or the solution scores the puzzle as a loss. Rated mode only; Puzzle Rush is a later ticket.

- [x] **T8.1 Rated puzzles** (L) — `src/puzzles/`: pure Glicko-2 update, selection near the rating (unseen first, widening window), solution checking (setup move auto-played; an alternative mate counts as correct); Dexie v5 adds `puzzles` and `puzzleAttempts` (backed up); Puzzles tab with a chess.com-style solver (feedback, Hint → square then arrow, Retry, Solution, Next puzzle, rating change) and a History view (rating graph, totals, themes, recent attempts). Done when: typecheck/lint/tests pass and the tab works in the running app.

## Phase 9 — Game review

Goal: a chess.com-style review of imported games, free and offline: every move gets a mark, each side an accuracy.

**Decided (2026-11-09):** marks come from Stockfish (two lines per position, depth in `settings.analysis`) by mover's win% lost, using chess.com's published bands — Excellent < 2, Good < 5, Inaccuracy < 10, Mistake < 20, Blunder ≥ 20. Book = moves up to the last position the bundled Lichess openings name. Great = the best move when the runner-up drops ≥ 20 and leaves ≤ 50% (not a plain recapture). Brilliant = a best/excellent move that gives up ≥ 2 pawns of material (piece left en prise or down after the engine line) while not already winning (< 95%) and still ≥ 50% after. Miss = a mistake/blunder right after the opponent's error that only hands the advantage back. Accuracy uses the Lichess formula. Evals are stored (Dexie v6 `analyses`, backed up); marks are recomputed so thresholds can change.

- [x] **T9.1 Game review** (L) — `src/analysis/`: pure classification + accuracy, engine runner, review page opened from each game on the Import tab (Analyze / Review button, accuracy shown once analysed): board with mark icon and tinted squares on the move, best-move arrow, eval bar, eval graph with key-moment dots, move list with icons, coach text from the explainers, next/previous key moment, per-side mark counts. Done when: typecheck/lint/tests pass and a game analyses and reviews in the running app.

## Phase 10 — Board vision

Goal: learn the board's coordinates until square names are automatic, from both sides, then practise seeing moves without the board.

**Decided (2026-11-09):** a Coordinates tab with four drills. Find the square and Name the square are timed rounds (length in `settings.coordinates`); Play the move and Visualize are 10-question rounds. Each round picks White's or Black's view. Squares are picked with extra weight for the ones you miss or answer slowly (per-square stats, Dexie v7 `coordStats` + `coordRuns`, both backed up). Piece reach in Visualize comes from chess.js on a kingless board, not hand-rolled geometry. Play the move uses positions from your course cards, falling back to the catalog's start moves.

- [x] **T10.1 Coordinate logic** (S) — `src/coordinates/`: squares and square colour, weighted square picking, per-square stat updates, heatmap scores, visualization questions (square colour, same diagonal, knight/bishop reach), Play-the-move prompts from cards. Done when: unit tests cover each.
- [x] **T10.2 Storage** (S) — Dexie v7 `coordStats` and `coordRuns` (new tables, no-op upgrade), added to backup/restore, `settings.coordinates`. Done when: db and backup tests cover the new tables.
- [x] **T10.3 Coordinates tab** (M) — the four drills on a coordinate-free board, view toggle (White/Black), live score and timer, best scores per drill and view. Done when: each drill runs a full round in the app and saves its stats.
- [x] **T10.4 Square heatmap** (S) — 8×8 heatmap of accuracy and speed from your stats, from either side, on the Coordinates tab and the Progress page. Done when: renders after a few rounds and shows weak squares.
