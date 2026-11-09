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
- [ ] **T4.4 Opening-principle rules** (M) — early queen, same piece twice, no castle by move 10, no central pawn, undeveloped minors.
- [ ] **T4.5 Template phrase bank** (S) — finding → sentence with variables; wire into drill panel.
- [ ] **T4.6 Repertoire sanity check** (S) — flag chosen moves losing > ~0.5 pawns vs best in the builder.
- [ ] **T4.7 Play out from book** (M) — after a line ends, 10 moves vs limited-skill Stockfish with grading.

## Phase 5 — Import games

**Phase done when:** syncing a username lists each game's deviation ply; misplayed positions show up as due cards.

- [ ] **T5.1 Archive fetch + sync** (M) — sequential month fetch, store immutable past months, refetch current only, proxy if CORS blocks.
- [ ] **T5.2 PGN parse + filters** (S) — `loadPgn`, keep user's color and chosen time classes.
- [ ] **T5.3 Deviation detection** (M) — walk game vs tree, record who left book and at which ply. Fixture tests.
- [ ] **T5.4 Auto-cards** (M) — user left book → card failed + due now; opponent left book and user lost eval → card from engine best.
- [ ] **T5.5 Coverage gaps report** (S) — frequent missing opponent replies, button to extend tree.

## Phase 6 — Concept lessons

**Phase done when:** two packs of 5 play end to end with hints; solved lessons join the review queue.

- [ ] **T6.1 Lesson schema + player** (M) — JSON `{ id, concept, fen, prompt, accepted[], hints[], explanation }`; player reuses board + panel.
- [ ] **T6.2 Authoring tool** (M) — set up/paste FEN, multi-PV Stockfish, auto-accept moves within ~30cp of best, export JSON.
- [ ] **T6.3 Position mining** (M) — find concept-matching positions in imported games + explorer.
- [ ] **T6.4 First packs** (L, mostly you) — strike the center, develop before attacking, castle early, punish early queen. Claude drafts candidates; you approve.
- [ ] **T6.5 Lessons into FSRS** (S) — solved challenge → card.
