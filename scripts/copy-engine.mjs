// Copies the Stockfish lite single-threaded WASM build into public/engine/.
// Runs on postinstall. The worker resolves its .wasm by swapping the .js
// extension, so the two files must keep matching basenames.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'node_modules', 'stockfish')
const outDir = join(root, 'public', 'engine')

const files = [
  ['bin/stockfish-19-lite-single.js', 'stockfish.js'],
  ['bin/stockfish-19-lite-single.wasm', 'stockfish.wasm'],
  ['Copying.txt', 'LICENSE.txt'],
]

mkdirSync(outDir, { recursive: true })
for (const [from, to] of files) {
  const src = join(srcDir, from)
  if (!existsSync(src)) {
    console.error(`copy-engine: missing ${src} (stockfish version changed?)`)
    process.exit(1)
  }
  copyFileSync(src, join(outDir, to))
}
console.log(`copy-engine: copied ${files.length} files to public/engine/`)
