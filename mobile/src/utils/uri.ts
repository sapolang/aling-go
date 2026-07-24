import { Paths, File, Directory } from 'expo-file-system'

export async function copyToCache(uri: string): Promise<string> {
  try {
    const ext = uri.split('.').pop() || 'mp4'
    const cacheDir = new Directory(Paths.cache, 'aling')
    cacheDir.create({ intermediates: true, idempotent: true })
    const dest = new File(cacheDir, `${Date.now()}.${ext}`)
    const src = new File(uri)
    await src.copy(dest)
    return dest.uri
  } catch (error) {
    console.error('copyToCache failed:', error)
    throw error
  }
}

export async function resolveUri(uri: string): Promise<string> {
  try {
    if (uri.startsWith('file://')) return uri
    if (uri.startsWith('content://') || uri.startsWith('ph://')) {
      return await copyToCache(uri)
    }
    return uri
  } catch (error) {
    throw new Error(`Failed to resolve URI: ${uri}, error: ${error}`)
  }
}
