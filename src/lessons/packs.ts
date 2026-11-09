// Bundled lesson packs: every `src/lessons/packs/*.json`, validated at load.

import { duplicateLessonIds, validatePack, type LessonPack } from './lesson'

export interface LoadedPacks {
  packs: LessonPack[]
  /** One message per problem; broken packs are left out. */
  errors: string[]
}

/** Validates raw pack files (file name → parsed JSON), sorted by file name. */
export function loadPacks(files: Record<string, unknown>): LoadedPacks {
  const packs: LessonPack[] = []
  const errors: string[] = []
  const ids = new Set<string>()
  for (const [file, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const name = file.split('/').pop() ?? file
    const result = validatePack(raw)
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `${name}: ${e}`))
    } else if (ids.has(result.pack.id)) {
      errors.push(`${name}: pack id "${result.pack.id}" is used twice`)
    } else {
      ids.add(result.pack.id)
      packs.push(result.pack)
    }
  }
  errors.push(...duplicateLessonIds(packs))
  return { packs, errors }
}

let bundled: LoadedPacks | undefined

/** The packs shipped in `src/lessons/packs/`. */
export function bundledPacks(): LoadedPacks {
  if (bundled) return bundled
  const modules = import.meta.glob<unknown>('./packs/*.json', { eager: true, import: 'default' })
  bundled = loadPacks(modules)
  return bundled
}
