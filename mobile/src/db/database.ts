import * as SQLite from 'expo-sqlite'
import { ALL_SCHEMAS } from './schema'

let db: SQLite.SQLiteDatabase | null = null

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db
  try {
    db = await SQLite.openDatabaseAsync('aling.db')
    for (const sql of ALL_SCHEMAS) {
      await db.execAsync(sql)
    }
    return db
  } catch (error) {
    console.error('Database init failed:', error)
    throw error
  }
}

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}
