// 前端媒体形态识别的唯一来源。后端 mediaFormats 表是分类的权威实现，
// 这里只保留播放页在拿到 mediaKind 之前按扩展名兜底推断所需的最小子集。

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'm4b',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aac',
  'wma',
  'aiff',
  'aif',
  'caf',
  'ape',
  'wv',
  'mka',
  'amr',
])

/** 取小写扩展名，不含点；无法识别时返回空串 */
export function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/** 按扩展名判断是否为纯音频文件 */
export function isAudioPath(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extOf(path))
}
