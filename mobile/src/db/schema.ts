export const CREATE_WORDS_TABLE = `
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    definition TEXT DEFAULT '',
    phonetic TEXT DEFAULT '',
    example TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    level INTEGER DEFAULT 1,
    next_review TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )
`

export const CREATE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6'
  )
`

export const CREATE_SUBTITLE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS subtitle_cache (
    file_hash TEXT PRIMARY KEY,
    subtitles TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`

export const CREATE_FILES_TABLE = `
  CREATE TABLE IF NOT EXISTS files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    uri        TEXT NOT NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'video',
    duration   REAL DEFAULT 0,
    file_size  INTEGER DEFAULT 0,
    thumbnail  TEXT DEFAULT '',
    folder_id  INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`

export const CREATE_FOLDERS_TABLE = `
  CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`

export const ALL_SCHEMAS = [
  CREATE_WORDS_TABLE,
  CREATE_TAGS_TABLE,
  CREATE_SUBTITLE_CACHE_TABLE,
  CREATE_FILES_TABLE,
  CREATE_FOLDERS_TABLE,
]
