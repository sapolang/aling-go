import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatClockTime } from '@/lib/subtitles'
import type { FavoriteDialogHandle } from './useFavoriteDialog'

interface FavoriteDialogProps {
  dialog: FavoriteDialogHandle
  filePath: string | null
}

/** 收藏整句弹窗：可关联单词与标签，保存后由父级刷新状态 */
export default function FavoriteDialog({ dialog, filePath }: FavoriteDialogProps) {
  const { target, word, tags, tagId, newTag } = dialog
  if (!target) return null

  return (
    <Dialog open onOpenChange={(open) => !open && dialog.close()}>
      <DialogContent className="max-w-sm gap-0">
        <DialogHeader className="mb-4">
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5" /> 收藏整句
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm mb-1 line-clamp-3">{target.text}</p>
        <p className="text-xs text-muted-foreground mb-4">
          {formatClockTime(target.startTime)} - {formatClockTime(target.endTime)}
        </p>
        <label className="text-sm font-medium">关联单词（可选）</label>
        <Input
          placeholder="例如素材中正在查的词"
          value={word}
          onChange={(e) => dialog.setWord(e.target.value)}
          className="mt-1 mb-3"
        />
        <label className="text-sm font-medium">标签</label>
        <select
          className="w-full bg-background border rounded px-3 py-2 text-sm mt-1 mb-3"
          value={tagId}
          onChange={(e) => dialog.setTagId(parseInt(e.target.value))}
        >
          <option value={0}>无标签</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Input
          placeholder="或输入新标签名称"
          value={newTag}
          onChange={(e) => dialog.setNewTag(e.target.value)}
          className="mb-4"
        />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button onClick={() => dialog.save(filePath)}>收藏</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
