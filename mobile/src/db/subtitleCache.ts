import * as SQLite from 'expo-sqlite'
import { getDatabase } from './database'
import { SubtitleItem } from '../types'

function hashFile(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `cache_${Math.abs(hash)}`
}

export async function getCachedSubtitles(filePath: string): Promise<SubtitleItem[] | null> {
  try {
    const db = getDatabase()
    const key = hashFile(filePath)
    const row: { subtitles: string } | null = await db.getFirstAsync(
      'SELECT subtitles FROM subtitle_cache WHERE file_hash = ?',
      key
    )
    if (!row) return null
    return JSON.parse(row.subtitles) as SubtitleItem[]
  } catch {
    return null
  }
}

export async function saveCachedSubtitles(filePath: string, subtitles: SubtitleItem[]): Promise<void> {
  try {
    const db = getDatabase()
    const key = hashFile(filePath)
    await db.runAsync(
      'INSERT OR REPLACE INTO subtitle_cache (file_hash, subtitles) VALUES (?, ?)',
      key,
      JSON.stringify(subtitles)
    )
  } catch (e) {
    console.error('Failed to cache subtitles:', e)
  }
}
