/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Undefined when .env.local is missing; callers must handle that.
  readonly VITE_LICHESS_TOKEN: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
