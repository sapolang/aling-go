import { Paths, File, Directory } from 'expo-file-system'

function appDir(): Directory {
  const dir = new Directory(Paths.document, 'aling')
  dir.create({ intermediates: true, idempotent: true })
  return dir
}

export async function copyToCache(uri: string): Promise<string> {
  const ext = uri.split('.').pop() || 'mp4'
  const dir = appDir()
  const dest = new File(dir, `${Date.now()}.${ext}`)
  try {
    const src = new File(uri)
    const bytes = await src.bytes()
    dest.write(bytes)
  } catch {
    throw new Error('copyToCache failed')
  }
  return dest.uri
}

export async function ensureCached(uri: string): Promise<string> {
  const dir = appDir()
  if (uri.startsWith(dir.uri)) {
    return uri
  }
  return await copyToCache(uri)
}
