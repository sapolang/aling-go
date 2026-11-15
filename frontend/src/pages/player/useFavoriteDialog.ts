import { useCallback, useState } from 'react'

export interface FavoriteTarget {
  startTime: number
  endTime: number
  text: string
}

export interface FavoriteDialogHandle {
  target: FavoriteTarget | null
  word: string
  tags: { id: number; name: string }[]
  tagId: number
  newTag: string
  setWord: (v: string) => void
  setTagId: (v: number) => void
  setNewTag: (v: string) => void
  open: (sub: FavoriteTarget, word?: string) => void
  close: () => void
  save: (filePath: string | null) => Promise<void>
}

/** 收藏整句弹窗：维护目标片段、关联单词与标签选择 */
export function useFavoriteDialog(): FavoriteDialogHandle {
  const [target, setTarget] = useState<FavoriteTarget | null>(null)
  const [word, setWord] = useState('')
  const [tags, setTags] = useState<{ id: number; name: string }[]>([])
  const [tagId, setTagId] = useState(0)
  const [newTag, setNewTag] = useState('')

  const open = useCallback((sub: FavoriteTarget, nextWord = '') => {
    setTarget({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text })
    setWord(nextWord)
    setTagId(0)
    setNewTag('')
    window.api.favoriteTagsList().then(setTags)
  }, [])

  const save = async (filePath: string | null) => {
    if (!target || !filePath) return
    let nextTagId = tagId
    const name = newTag.trim()
    if (name) {
      const id = await window.api.favoriteTagAdd(name)
      if (id > 0) nextTagId = id
    }
    await window.api.favoriteAdd({
      filePath,
      startTime: target.startTime,
      endTime: target.endTime,
      text: target.text,
      tagId: nextTagId,
      word: word.trim(),
    })
    setTarget(null)
  }

  const close = useCallback(() => setTarget(null), [])

  return {
    target,
    word,
    tags,
    tagId,
    newTag,
    setWord,
    setTagId,
    setNewTag,
    open,
    close,
    save,
  }
}
