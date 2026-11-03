import { useState, useEffect } from 'react'
import { useWordStore } from '@/stores/wordStore'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

interface Props {
  word?: any
  onClose: () => void
}

const levelLabels = ['待学习', '遗忘', '模糊', '熟悉']

export default function AddWordModal({ word, onClose }: Props) {
  const { tags, loadTags, addWord, updateWord } = useWordStore()
  const [form, setForm] = useState({
    word: '',
    definition: '',
    phonetic: '',
    example: '',
    tags: '',
    level: 1
  })
  const [newTag, setNewTag] = useState('')

  useEffect(() => { loadTags() }, [])

  useEffect(() => {
    if (word) {
      setForm({
        word: word.word,
        definition: word.definition,
        phonetic: word.phonetic,
        example: word.example,
        tags: word.tags,
        level: word.level
      })
    }
  }, [word])

  const tagList = form.tags.split(',').filter(Boolean)
  const availableTags = tags.filter((t) => !tagList.includes(t.name))

  const addTag = (tagName: string) => {
    const existing = form.tags.split(',').filter(Boolean)
    if (!existing.includes(tagName)) {
      existing.push(tagName)
      setForm({ ...form, tags: existing.join(',') })
    }
  }

  const removeTag = (tagName: string) => {
    const existing = form.tags.split(',').filter(Boolean).filter((t) => t !== tagName)
    setForm({ ...form, tags: existing.join(',') })
  }

  const handleSubmit = async () => {
    if (!form.word.trim()) return
    const days = [0, 1, 3, 7]
    const level = form.level
    const next_review = new Date(Date.now() + days[level] * 86400000).toISOString().split('T')[0]

    const data = { ...form, next_review }

    if (word) {
      await updateWord(word.id, data)
    } else {
      await addWord(data)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{word ? '编辑生词' : '新增生词'}</h2>
        <div className="space-y-4">
          <div>
            <Label>原文 *</Label>
            <Input value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} placeholder="输入单词" />
          </div>
          <div>
            <Label>释义</Label>
            <Input value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} placeholder="输入释义" />
          </div>
          <div>
            <Label>音标</Label>
            <Input value={form.phonetic} onChange={(e) => setForm({ ...form, phonetic: e.target.value })} placeholder="/ˈeksəmpəl/" />
          </div>
          <div>
            <Label>例句</Label>
            <textarea
              className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.example}
              onChange={(e) => setForm({ ...form, example: e.target.value })}
              placeholder="输入例句"
            />
          </div>
          <div>
            <Label>记忆等级</Label>
            <div className="flex gap-2 mt-1">
              {levelLabels.map((label, i) => (
                <Button
                  key={i}
                  variant={form.level === i ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setForm({ ...form, level: i })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label>标签</Label>
            <div className="flex flex-wrap gap-1 mt-1 mb-2">
              {tagList.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                  <button className="ml-1 hover:text-destructive" onClick={() => removeTag(tag)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value=""
                onChange={(e) => { if (e.target.value) addTag(e.target.value) }}
              >
                <option value="">选择已有标签...</option>
                {availableTags.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
              <div className="flex gap-1">
                <Input
                  className="w-24"
                  placeholder="新标签"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { if (newTag.trim()) { addTag(newTag.trim()); setNewTag('') } }}
                >
                  添加
                </Button>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit}>{word ? '保存' : '添加'}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
