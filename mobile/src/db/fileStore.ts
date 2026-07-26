import { getDatabase } from './database'

export interface FileRow {
  id: number
  uri: string
  name: string
  type: 'video' | 'audio'
  duration: number
  file_size: number
  thumbnail: string
  folder_id: number
  created_at: string
}

export interface FolderRow {
  id: number
  name: string
  created_at: string
}

export type SortField = 'name' | 'file_size' | 'created_at'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.flv', '.3gp'])

export function detectFileType(name: string): 'video' | 'audio' {
  const ext = '.' + name.split('.').pop()?.toLowerCase()
  return VIDEO_EXTS.has(ext) ? 'video' : 'audio'
}

export function addFile(uri: string, name: string, type: string, thumbnail = ''): void {
  const db = getDatabase()
  db.runSync(
    `INSERT OR REPLACE INTO files (uri, name, type, thumbnail) VALUES (?, ?, ?, ?)`,
    [uri, name, type, thumbnail]
  )
}

function sortFiles(files: FileRow[], sort: SortField): FileRow[] {
  return [...files].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'file_size') return b.file_size - a.file_size
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function getAllFiles(sort: SortField = 'created_at'): FileRow[] {
  const db = getDatabase()
  const files = db.getAllSync(`SELECT * FROM files`, []) as FileRow[]
  return sortFiles(files, sort)
}

export function getFilesByType(type: string, sort: SortField = 'created_at'): FileRow[] {
  const db = getDatabase()
  const files = db.getAllSync(
    `SELECT * FROM files WHERE type = ?`, [type]
  ) as FileRow[]
  return sortFiles(files, sort)
}

export function getUncategorizedFiles(type: string, sort: SortField = 'created_at'): FileRow[] {
  const db = getDatabase()
  const files = db.getAllSync(
    `SELECT * FROM files WHERE type = ? AND (folder_id IS NULL OR folder_id = 0)`, [type]
  ) as FileRow[]
  return sortFiles(files, sort)
}

export function getFolderFiles(folderId: number, sort: SortField = 'created_at'): FileRow[] {
  const db = getDatabase()
  const files = db.getAllSync(
    `SELECT * FROM files WHERE folder_id = ?`, [folderId]
  ) as FileRow[]
  return sortFiles(files, sort)
}

export function deleteFile(id: number): void {
  const db = getDatabase()
  db.runSync(`DELETE FROM files WHERE id = ?`, [id])
}

export function renameFile(id: number, newName: string): void {
  const db = getDatabase()
  db.runSync(`UPDATE files SET name = ? WHERE id = ?`, [newName, id])
}

export function updateFileThumbnail(uri: string, thumbnail: string): void {
  const db = getDatabase()
  db.runSync(`UPDATE files SET thumbnail = ? WHERE uri = ?`, [thumbnail, uri])
}

export function updateFileUri(id: number, uri: string): void {
  const db = getDatabase()
  db.runSync(`UPDATE files SET uri = ?, thumbnail = ? WHERE id = ?`, [uri, uri, id])
}

export function updateFileFolder(fileId: number, folderId: number): void {
  const db = getDatabase()
  db.runSync(`UPDATE files SET folder_id = ? WHERE id = ?`, [folderId, fileId])
}

// Folders
export function createFolder(name: string): void {
  const db = getDatabase()
  db.runSync(`INSERT INTO folders (name) VALUES (?)`, [name])
}

export function getFolders(): FolderRow[] {
  const db = getDatabase()
  return db.getAllSync(`SELECT * FROM folders ORDER BY created_at DESC`, []) as FolderRow[]
}

export function deleteFolder(id: number): void {
  const db = getDatabase()
  db.runSync(`UPDATE files SET folder_id = 0 WHERE folder_id = ?`, [id])
  db.runSync(`DELETE FROM folders WHERE id = ?`, [id])
}

export function renameFolder(id: number, newName: string): void {
  const db = getDatabase()
  db.runSync(`UPDATE folders SET name = ? WHERE id = ?`, [newName, id])
}
