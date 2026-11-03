# Opening Trainer

A personal chess opening trainer: drill a repertoire built from Lichess explorer data, scheduled with spaced repetition, graded by Stockfish, with chess.com-style UI. Runs locally only. One user (me).

Work is tracked in `TASKS.md`. Do one ticket per session unless told otherwise.

## Locked decisions (do not revisit without asking)

- **Local only.** `npm run dev` is the product. No backend, no hosting, no auth, no cloud DB.
- **Stack:** React + TypeScript (strict) + Vite. Vitest for tests. ESLint + Prettier.
- **No LLM calls and no paid APIs.** Move explanations come from Stockfish output + rule templates.
- **Board:** `chessground` for UI, `chess.js` for legality/SAN/FEN/PGN. Never hand-roll move generation.
- **Engine:** Stockfish.js **lite single-threaded** WASM build, copied into `public/engine/`, loaded by URL in a Web Worker. Do not bundle it. Do not use the multithreaded build (needs COOP/COEP headers).
- **Storage:** IndexedDB via Dexie (`dexie`, `dexie-react-hooks`). No localStorage for app data.
- **SRS:** `ts-fsrs`, `request_retention: 0.9`.
- **Lines:** generated from the Lichess opening explorer, not hand-authored.
- **Art:** open-licensed Lichess piece set (e.g. cburnett). Never copy chess.com pieces, coach art, or assets — only mimic the look (colors, layout).

## Architecture

```
src/
  board/       chessground React wrapper, theme CSS, promotion picker
  trainer/     drill loop, line-context playback, side panel UI
  engine/      Stockfish worker wrapper (UCI), eval cache, move grading, explainers
  repertoire/  explorer client, tree model, pruning, builder settings, tree viewer
  srs/         card generation, FSRS scheduling, auto-grading, due queue
  importer/    chess.com archive fetch, sync, PGN parsing, deviation detection
  lessons/     lesson JSON packs, lesson player, authoring tool
  db/          Dexie schema, migrations, backup/restore
public/engine/ stockfish lite .js + .wasm
```

Keep modules decoupled: UI calls into `trainer/`, `srs/`, `repertoire/`; pure logic in those folders must not import React.

## Domain rules

- **Position key** = first four FEN fields (placement, side, castling, en passant). Use it for tree nodes, cards, eval cache, explorer cache. Transpositions must merge.
- **Card** = a node where it is the user's move. Card id = `${repertoireId}:${positionKey}`.
- **Auto-grading:** wrong → Again; hint used or > ~15s → Hard; normal → Good; < 2s → Easy. Thresholds live in `settings`, not constants.
- **Pruning defaults:** user move = best-scoring among moves with ≥5% play share; opponent moves kept until 85% of games covered or share < 3%; max depth configurable.
- **Move grading:** cp → win% using the Lichess formula; grade by win% lost (book / good / inaccuracy / mistake / blunder).

## External APIs

- **Lichess explorer:** `https://explorer.lichess.ovh/lichess` with `Authorization: Bearer ${import.meta.env.VITE_LICHESS_TOKEN}`. Token lives in `.env.local` (gitignored). Requests strictly sequential. On 429, wait 60s before retrying. Cache every response in IndexedDB keyed by position key + query params.
- **Chess.com Published-Data API:** `/pub/player/{user}/games/archives`, then month URLs **one at a time** (parallel → 429). No key. Past months are immutable: fetch once, store; refetch only the current month.
- **CORS:** if either API blocks browser calls, add a Vite `server.proxy` entry (and inject headers there). Do not create a backend.
- Never log or commit the token.

## Commands

```
npm run dev        # app
npm test           # vitest
npm run lint
npm run typecheck  # tsc --noEmit
```

## Working rules

- Before calling a ticket done: `npm run typecheck`, `npm run lint`, `npm test` all pass, and the ticket's "Done when" check is met.
- Pure logic (pruning, FSRS wrapper, grading, deviation detection, UCI parsing, rule checks) gets unit tests with real FEN/PGN fixtures in `__tests__/` beside the module.
- Network code must be mockable; tests never hit Lichess or chess.com.
- Dexie schema changes go through a version bump with an upgrade function. Never drop user data.
- Small commits, one per ticket, message `T<id>: <title>`.
- If a ticket is ambiguous or conflicts with these rules, stop and ask rather than guessing.
- When a ticket finishes, tick it in `TASKS.md`.

## Licensing

chessground, Stockfish.js and related libs are GPL. Fine for personal use; do not add anything that assumes distribution.
