import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore, type LibraryFile, type Folder } from '@/stores/libraryStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useWordStore } from '@/stores/wordStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { showToast, confirmDialog } from '@/components/feedback'
import { looksLikeMediaLink, openResolvedMedia } from '@/utils/mediaLink'
import SrtParser from 'srt-parser-2'
import { timeToSeconds } from '@/lib/srt'
import {
  FileUp,
  Pencil,
  FolderPlus,
  LayoutGrid,
  List,
  ArrowUpDown,
  Trash2,
  Film,
  Music,
  FileText,
  Folder as FolderIcon,
  CheckSquare,
  Square,
  ArrowLeft,
  ChevronRight,
  Home,
  FolderOutput,
  MoreHorizontal,
  Search,
  X,
  UploadCloud,
  History,
  Link2,
} from 'lucide-react'

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`
}

interface ImportResultLike {
  imported?: number
  skipped?: number
  dropped?: number
}

function notifyImportResult(result: ImportResultLike) {
  const imported = result.imported || 0
  const skipped = result.skipped || 0
  const dropped = result.dropped || 0
  const parts: string[] = []
  if (imported > 0) parts.push(`导入成功 ${imported} 个`)
  if (skipped > 0) parts.push(`跳过 ${skipped} 个（已存在或不支持）`)
  if (dropped > 0) parts.push(`已达上限，丢弃 ${dropped} 个`)
  const msg = parts.join('，')
  if (imported > 0) {
    showToast(msg, 'success')
  } else if (dropped > 0) {
    showToast(msg, 'warning')
  } else {
    showToast('所选文件均已导入过或不支持', 'warning')
  }
}

const CATEGORIES = [
  { key: 'all' as const, label: '全部' },
  { key: 'folder' as const, label: '文件夹', icon: FolderIcon },
  { key: 'video' as const, label: '视频', icon: Film },
  { key: 'audio' as const, label: '音频', icon: Music },
  { key: 'pdf' as const, label: 'PDF', icon: FileText },
]

const TYPE_ICON = { video: Film, audio: Music, pdf: FileText }

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  itemPath: string
  isFolder: boolean
}

export default function HomePage() {
  const store = useLibraryStore()
  const player = usePlayerStore()
  const reviewCount = useWordStore((s) => s.reviewTotal)
  const navigate = useNavigate()
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [contextMoveOpen, setContextMoveOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    itemPath: '',
    isFolder: false,
  })
  // 打开链接弹窗（全局 Ctrl/Cmd+V 可直接识别播放）
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [resolving, setResolving] = useState(false)
  const [renameDialog, setRenameDialog] = useState<{
    visible: boolean
    name: string
    itemPath: string
    isFolder: boolean
  }>({
    visible: false,
    name: '',
    itemPath: '',
    isFolder: false,
  })

  useEffect(() => {
    store.load()
  }, [])

  // Cmd/Ctrl + L 打开链接输入框
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setLinkOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((p) => ({ ...p, visible: false }))
    setContextMoveOpen(false)
  }, [])

  const openContextMenu = useCallback(
    (x: number, y: number, itemPath: string, isFolder: boolean) => {
      setContextMenu({ visible: true, x, y, itemPath, isFolder })
    },
    [],
  )

  const handleImport = useCallback(async () => {
    const { category, currentFolderId, load } = useLibraryStore.getState()
    const result = await window.api.libraryImport(category, currentFolderId || '')
    if (result.imported === 0 && result.skipped === 0 && (result.dropped || 0) === 0) return
    await load()
    notifyImportResult(result)
  }, [])

  const handleDropImport = useCallback(async (paths: string[]) => {
    try {
      const { currentFolderId, load } = useLibraryStore.getState()
      const result = await window.api.libraryImportPaths(paths, currentFolderId || '')
      await load()
      notifyImportResult(result)
    } catch (err) {
      console.error('[DropImport] ERROR:', err)
      showToast('导入失败', 'error')
    }
  }, [])

  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    let counter = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      counter++
      setDragActive(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      counter--
      if (counter <= 0) {
        counter = 0
        setDragActive(false)
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      counter = 0
      setDragActive(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files
        .map((f) => (f as unknown as { path?: string }).path || '')
        .filter((p) => p.length > 0)
      if (paths.length > 0) {
        handleDropImport(paths)
      } else {
        showToast('当前环境无法读取拖入文件的路径，请在弹出的窗口中选择文件导入', 'info')
        handleImport()
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleDropImport, handleImport])

  const handleDelete = async (paths?: string[]) => {
    const itemsToDelete = paths || Array.from(store.selectedPaths)
    if (itemsToDelete.length === 0) return

    const folderIds: string[] = []
    const filePaths: string[] = []
    const allFolders = new Set(store.folders.map((f) => f.id))
    itemsToDelete.forEach((p) => {
      if (allFolders.has(p)) folderIds.push(p)
      else filePaths.push(p)
    })

    const ok = await confirmDialog({
      title: `删除 ${itemsToDelete.length} 项？`,
      description:
        folderIds.length > 0
          ? '仅从媒体库移除，不会删除磁盘上的原文件。文件夹内的文件将移到未归类。'
          : '仅从媒体库移除，不会删除磁盘上的原文件。',
      confirmText: '删除',
      destructive: true,
    })
    if (!ok) return

    try {
      if (filePaths.length > 0) await window.api.libraryRemove(filePaths)
      for (const id of folderIds) {
        await window.api.folderDelete(id)
      }
      await store.load()
      store.clearSelection()
      closeContextMenu()
      showToast(`已从媒体库移除 ${itemsToDelete.length} 项`, 'success')
    } catch (err) {
      console.error('[Delete] ERROR:', err)
      showToast('删除失败', 'error')
    }
  }

  const handleContextDelete = () => {
    handleDelete([contextMenu.itemPath])
  }

  const handleRenameSubmit = async () => {
    if (!renameDialog.name.trim()) return
    if (renameDialog.isFolder) {
      await window.api.folderRename(renameDialog.itemPath, renameDialog.name.trim())
    } else {
      await window.api.libraryRename(renameDialog.itemPath, renameDialog.name.trim())
    }
    await store.load()
    setRenameDialog({ visible: false, name: '', itemPath: '', isFolder: false })
    closeContextMenu()
    showToast('重命名成功', 'success')
  }

  const handleMove = async (folderId: string) => {
    const paths = contextMenu.visible ? [contextMenu.itemPath] : Array.from(store.selectedPaths)
    if (paths.length === 0) return
    await window.api.libraryMove(paths, folderId)
    await store.load()
    store.clearSelection()
    setShowMoveMenu(false)
    closeContextMenu()
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await window.api.folderCreate(newFolderName.trim(), store.currentFolderId || '')
      await store.load()
      setNewFolderName('')
      setShowNewFolder(false)
      showToast('文件夹已创建', 'success')
    } catch (err) {
      console.error('[CreateFolder] ERROR:', err)
      showToast('创建文件夹失败', 'error')
    }
  }

  const handleOpenFile = async (file: LibraryFile) => {
    if (file.type === 'pdf') {
      await window.api.openExternal(file.path)
      return
    }
    player.setFilePath(file.path)
    // 记录来源页面，播放页的返回按钮回到这里而不是固定回文件库
    navigate('/player', { state: { from: '/' } })
    player.setWaveformLoading(true)
    window.api
      .getWaveformData(file.path)
      .then((data: number[]) => {
        if (data && data.length > 0) player.setWaveformData(data)
        else player.setWaveformLoading(false)
      })
      .catch(() => player.setWaveformLoading(false))
    try {
      const cached = await window.api.getCachedSubtitles(file.path)
      if (cached && cached.length > 0) {
        player.setSubtitles(cached)
        return
      }
      const srtPath = file.path.replace(/\.[^.]+$/, '.srt')
      try {
        const content = await window.api.readTextFile(srtPath)
        const parsed = new SrtParser().fromSrt(content)
        const subs = parsed.map((s: any) => ({
          id: parseInt(s.id),
          startTime: timeToSeconds(s.startTime),
          endTime: timeToSeconds(s.endTime),
          text: s.text,
        }))
        player.setSubtitles(subs)
        window.api.cacheSubtitles(file.path, subs)
      } catch {
        /* ignore parse errors */
      }
    } catch {
      /* ignore */
    }
    await window.api.recentAdd(file.path)
  }

  const handleEnterFolder = (folder: Folder) => {
    store.setCurrentFolder(folder.id)
  }

  const handleOpenLink = async (raw?: string) => {
    const target = (raw ?? linkInput).trim()
    if (!target || resolving) return
    setResolving(true)
    try {
      const res = await window.api.resolveMediaURL(target)
      if (res.needSubscribe) {
        const ok = await confirmDialog({
          title: '这是一个频道链接',
          description: '频道链接不能直接播放。是否前往播客页订阅该频道？',
          confirmText: '去订阅',
          cancelText: '取消',
        })
        if (!ok) return
        setLinkOpen(false)
        setLinkInput('')
        navigate('/podcast', { state: { feedUrl: res.feedUrl, platformUrl: target } })
        return
      }
      if (!res.ok) {
        showToast(res.error || '无法播放该链接', 'error')
        return
      }
      if (!openResolvedMedia(res, navigate, '/')) {
        showToast(res.error || '暂不支持该链接', 'error')
        return
      }
      setLinkOpen(false)
      setLinkInput('')
    } catch {
      showToast('解析链接失败，请检查网络后重试', 'error')
    } finally {
      setResolving(false)
    }
  }

  const handleExitFolder = () => {
    store.setCurrentFolder(currentFolder?.parentId || null)
  }

  const sortOptions: { key: typeof store.sortBy; label: string }[] = [
    { key: 'addedAt', label: '添加时间 (新→旧)' },
    { key: 'name', label: '名称 (A-Z)' },
    { key: 'type', label: '类型' },
  ]

  const sortFn = (a: LibraryFile, b: LibraryFile) => {
    if (store.sortBy === 'name') return a.name.localeCompare(b.name)
    if (store.sortBy === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    return b.addedAt.localeCompare(a.addedAt)
  }

  const currentFolder = store.currentFolderId
    ? store.folders.find((f) => f.id === store.currentFolderId)
    : null

  const searchQuery = store.searchQuery.trim().toLowerCase()
  const matchQuery = (name: string) =>
    searchQuery === '' || name.toLowerCase().includes(searchQuery)

  const visibleFolders = store.folders.filter((f) => {
    if (!matchQuery(f.name)) return false
    if (currentFolder) {
      return f.parentId === currentFolder.id
    }
    if (store.category === 'folder') return !f.parentId
    if (store.category === 'all') return !f.parentId
    return false
  })

  const visibleFiles = store.files
    .filter((f) => {
      if (!matchQuery(f.name)) return false
      if (currentFolder && f.folderId !== currentFolder.id) return false
      if (!currentFolder && f.folderId) return false
      if (store.category === 'folder') return false
      if (store.category === 'all') return true
      return f.type === store.category
    })
    .sort(sortFn)

  const totalVisible = visibleFolders.length + visibleFiles.length
  const isAllSelected =
    totalVisible > 0 &&
    visibleFolders.every((f) => store.selectedPaths.has(f.id)) &&
    visibleFiles.every((f) => store.selectedPaths.has(f.path))

  const handleSelectAll = () => {
    if (isAllSelected) {
      store.clearSelection()
    } else {
      store.selectAll(
        visibleFolders.map((f) => f.id),
        visibleFiles.map((f) => f.path),
      )
    }
  }

  const getFolderFileCount = (folderId: string): number => {
    let count = store.files.filter((f) => f.folderId === folderId).length
    for (const sub of store.folders.filter((f) => f.parentId === folderId)) {
      count += getFolderFileCount(sub.id)
    }
    return count
  }

  const getBreadcrumbPath = (): Folder[] => {
    const parts: Folder[] = []
    let cur: Folder | null | undefined = currentFolder
    while (cur) {
      parts.unshift(cur)
      cur = store.folders.find((f) => f.id === cur!.parentId) ?? null
    }
    return parts
  }

  return (
    <div className="space-y-4">
      {reviewCount > 0 && (
        <Card className="flex items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium">今日待复习 {reviewCount} 个单词</p>
            <p className="text-xs text-muted-foreground">按 SRS 计划，趁热打铁</p>
          </div>
          <Button size="sm" onClick={() => navigate('/card')}>
            开始复习
          </Button>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleImport}>
          <FileUp className="h-4 w-4 mr-1" /> 导入
        </Button>
        <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
          <Link2 className="h-4 w-4 mr-1" /> 打开链接
        </Button>
        <Button
          size="sm"
          variant={store.editing ? 'default' : 'outline'}
          onClick={store.toggleEditing}
        >
          <Pencil className="h-4 w-4 mr-1" /> 编辑
        </Button>
        {store.category === 'folder' && (
          <Button size="sm" variant="outline" onClick={() => setShowNewFolder(true)}>
            <FolderPlus className="h-4 w-4 mr-1" /> 新建文件夹
          </Button>
        )}

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={store.searchQuery}
            onChange={(e) => store.setSearchQuery(e.target.value)}
            placeholder="搜索文件名"
            className="h-8 w-32 sm:w-48 md:w-56 pl-7 pr-6 text-xs"
          />
          {store.searchQuery && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => store.setSearchQuery('')}
              aria-label="清除搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1 border rounded p-0.5">
          <Button
            size="sm"
            variant={store.viewMode === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => store.setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant={store.viewMode === 'list' ? 'secondary' : 'ghost'}
            onClick={() => store.setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setSortOpen(!sortOpen)}>
            <ArrowUpDown className="h-4 w-4 mr-1" />{' '}
            {sortOptions.find((o) => o.key === store.sortBy)?.label}
          </Button>
          {sortOpen && <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />}
          {sortOpen && (
            <div
              className="absolute right-0 top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[160px]"
              onClick={() => setSortOpen(false)}
            >
              {sortOptions.map((o) => (
                <button
                  key={o.key}
                  className={`w-full px-3 py-1.5 text-xs hover:bg-accent text-left ${store.sortBy === o.key ? 'font-medium' : ''}`}
                  onClick={() => {
                    store.setSortBy(o.key)
                    setSortOpen(false)
                  }}
                >
                  {o.label} {store.sortBy === o.key ? '✓' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 border-b pb-2 flex-wrap gap-y-1">
        {currentFolder && (
          <Button variant="ghost" size="sm" className="mr-2" onClick={handleExitFolder}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
        )}
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon
          return (
            <Button
              key={cat.key}
              size="sm"
              variant={store.category === cat.key ? 'secondary' : 'ghost'}
              onClick={() => {
                store.setCategory(cat.key)
                handleExitFolder()
              }}
            >
              {Icon && <Icon className="h-3.5 w-3.5 mr-1" />}
              {cat.label}
            </Button>
          )
        })}
      </div>

      {/* Breadcrumb for folder */}
      {currentFolder &&
        (() => {
          const path = getBreadcrumbPath()
          return (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <button
                onClick={() => store.setCurrentFolder(null)}
                className="hover:text-foreground"
              >
                <Home className="h-3.5 w-3.5 inline" />
              </button>
              {path.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5" />
                  {i < path.length - 1 ? (
                    <button
                      onClick={() => store.setCurrentFolder(f.id)}
                      className="hover:text-foreground"
                    >
                      {f.name}
                    </button>
                  ) : (
                    <span className="font-medium text-foreground">{f.name}</span>
                  )}
                </span>
              ))}
            </div>
          )
        })()}

      {/* Edit mode controls */}
      {store.editing && (
        <div className="flex items-center gap-2 flex-wrap p-2 bg-muted/50 rounded relative">
          {showMoveMenu && (
            <div className="fixed inset-0 z-40" onClick={() => setShowMoveMenu(false)} />
          )}
          <Button size="sm" variant="ghost" onClick={handleSelectAll}>
            {isAllSelected ? (
              <CheckSquare className="h-4 w-4 mr-1" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
            )}
            {isAllSelected ? '取消全选' : '全选'}
          </Button>
          <span className="text-xs text-muted-foreground">已选 {store.selectedPaths.size} 项</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowMoveMenu(!showMoveMenu)}
            disabled={store.selectedPaths.size === 0}
          >
            移动到
          </Button>
          {showMoveMenu && (
            <div className="absolute right-[72px] top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[140px]">
              <button
                className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                onClick={() => handleMove('')}
              >
                未归类
              </button>
              {store.folders.map((f) => (
                <button
                  key={f.id}
                  className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                  onClick={() => handleMove(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleDelete()}
            disabled={store.selectedPaths.size === 0}
          >
            <Trash2 className="h-4 w-4 mr-1" /> 删除
          </Button>
        </div>
      )}

      {/* 打开链接 */}
      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open)
          if (!open) setLinkInput('')
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">打开链接</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={linkInput}
              placeholder="粘贴 YouTube 或 B站 视频链接"
              onChange={(e) => setLinkInput(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text')
                if (!looksLikeMediaLink(text)) return
                e.preventDefault()
                setLinkInput(text.trim())
                handleOpenLink(text)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleOpenLink()
              }}
            />
            <p className="text-xs text-muted-foreground">
              支持 YouTube watch / youtu.be / Shorts 与 B站 BV / b23.tv 短链；频道链接会引导订阅
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!linkInput.trim() || resolving}
              onClick={() => handleOpenLink()}
            >
              {resolving ? '解析中…' : '打开'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="输入文件夹名称"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowNewFolder(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleCreateFolder}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={renameDialog.visible}
        onOpenChange={(open) => setRenameDialog((p) => ({ ...p, visible: open }))}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">重命名</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDialog.name}
            onChange={(e) => setRenameDialog((p) => ({ ...p, name: e.target.value }))}
            placeholder="输入新名称"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameDialog((p) => ({ ...p, visible: false }))}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleRenameSubmit}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grid View */}
      {store.viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {visibleFolders.map((folder) => (
            <GridFolderCard
              key={folder.id}
              folder={folder}
              fileCount={getFolderFileCount(folder.id)}
              editing={store.editing}
              selected={store.selectedPaths.has(folder.id)}
              onToggle={() => store.toggleSelect(folder.id)}
              onClick={() =>
                store.editing ? store.toggleSelect(folder.id) : handleEnterFolder(folder)
              }
              onContextMenu={(x, y) => openContextMenu(x, y, folder.id, true)}
            />
          ))}
          {visibleFiles.map((file) => (
            <GridFileCard
              key={file.path}
              file={file}
              editing={store.editing}
              selected={store.selectedPaths.has(file.path)}
              onToggle={() => store.toggleSelect(file.path)}
              onClick={() => (store.editing ? store.toggleSelect(file.path) : handleOpenFile(file))}
              onContextMenu={(x, y) => openContextMenu(x, y, file.path, false)}
            />
          ))}
        </div>
      )}

      {/* List View */}
      {store.viewMode === 'list' && (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
            <div className="col-span-6 sm:col-span-5">名称</div>
            <div className="hidden sm:block sm:col-span-3">类型</div>
            <div className="col-span-6 sm:col-span-4 text-right sm:text-left">添加时间</div>
          </div>
          <div className="divide-y">
            {visibleFolders.map((folder) => (
              <ListFolderRow
                key={folder.id}
                folder={folder}
                editing={store.editing}
                selected={store.selectedPaths.has(folder.id)}
                onToggle={() => store.toggleSelect(folder.id)}
                onClick={() =>
                  store.editing ? store.toggleSelect(folder.id) : handleEnterFolder(folder)
                }
                onContextMenu={(x, y) => openContextMenu(x, y, folder.id, true)}
              />
            ))}
            {visibleFiles.map((file) => (
              <ListFileRow
                key={file.path}
                file={file}
                editing={store.editing}
                selected={store.selectedPaths.has(file.path)}
                onToggle={() => store.toggleSelect(file.path)}
                onClick={() =>
                  store.editing ? store.toggleSelect(file.path) : handleOpenFile(file)
                }
                onContextMenu={(x, y) => openContextMenu(x, y, file.path, false)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleFolders.length === 0 && visibleFiles.length === 0 && searchQuery !== '' && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">未找到匹配「{store.searchQuery.trim()}」的文件</p>
          <p className="text-sm">试试其他关键词，或清除搜索</p>
        </div>
      )}
      {visibleFolders.length === 0 && visibleFiles.length === 0 && searchQuery === '' && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">{currentFolder ? '此文件夹为空' : '暂无文件'}</p>
          <p className="text-sm mb-4">
            {currentFolder
              ? '点击导入添加文件到此文件夹，或直接拖拽文件到窗口'
              : '点击「导入」添加音视频或 PDF 文件，或直接拖拽文件到窗口'}
          </p>
          <Button size="sm" onClick={handleImport}>
            <FileUp className="h-4 w-4 mr-1" /> 导入文件
          </Button>
        </div>
      )}

      {/* Drag & drop overlay */}
      {dragActive && (
        <div className="fixed inset-0 z-[70] pointer-events-none flex items-center justify-center bg-primary/10">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-background/90 px-10 py-8 shadow-xl">
            <UploadCloud className="h-12 w-12 text-primary" />
            <p className="text-base font-medium">松开鼠标导入文件</p>
            <p className="text-xs text-muted-foreground">
              支持视频 / 音频 / PDF
              {currentFolder ? `，导入到「${currentFolder.name}」` : '，导入到当前位置'}
            </p>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={closeContextMenu} />
          <div
            className="fixed z-[61] bg-popover border rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 150),
              top: Math.min(contextMenu.y, window.innerHeight - 120),
            }}
          >
            <button
              className="w-full px-3 py-2 text-xs hover:bg-accent text-left flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation()
                setContextMoveOpen(!contextMoveOpen)
              }}
            >
              <FolderOutput className="h-3.5 w-3.5" /> 移动到
            </button>
            {contextMoveOpen && (
              <div className="border-t py-1">
                <button
                  className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                  onClick={() => handleMove('')}
                >
                  未归类
                </button>
                {store.folders
                  .filter((f) => f.id !== contextMenu.itemPath)
                  .map((f) => (
                    <button
                      key={f.id}
                      className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left"
                      onClick={() => handleMove(f.id)}
                    >
                      {f.name}
                    </button>
                  ))}
              </div>
            )}
            <button
              className="w-full px-3 py-2 text-xs hover:bg-accent text-left flex items-center gap-2"
              onClick={() => {
                const itemName = contextMenu.isFolder
                  ? store.folders.find((f) => f.id === contextMenu.itemPath)?.name || ''
                  : store.files.find((f) => f.path === contextMenu.itemPath)?.name || ''
                closeContextMenu()
                setRenameDialog({
                  visible: true,
                  name: itemName,
                  itemPath: contextMenu.itemPath,
                  isFolder: contextMenu.isFolder,
                })
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> 重命名
            </button>
            <button
              className="w-full px-3 py-2 text-xs hover:bg-accent text-left flex items-center gap-2 text-destructive"
              onClick={handleContextDelete}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function useLongPress(onLongPress: (x: number, y: number) => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const longPressTriggered = useRef(false)
  const moved = useRef(false)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      longPressTriggered.current = false
      moved.current = false
      const touch = e.touches[0]
      timerRef.current = setTimeout(() => {
        longPressTriggered.current = true
        onLongPress(touch.clientX, touch.clientY)
      }, ms)
    },
    [onLongPress, ms],
  )

  const onTouchMove = useCallback(() => {
    moved.current = true
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onLongPress(e.clientX, e.clientY)
    },
    [onLongPress],
  )

  return { onTouchStart, onTouchMove, onTouchEnd, onContextMenu, longPressTriggered, moved }
}

function GridFolderCard({
  folder,
  fileCount,
  editing,
  selected,
  onToggle,
  onClick,
  onContextMenu,
}: {
  folder: Folder
  fileCount: number
  editing: boolean
  selected: boolean
  onToggle: () => void
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
}) {
  const longPress = useLongPress(onContextMenu)
  const handleClick = () => {
    if (longPress.longPressTriggered.current) {
      longPress.longPressTriggered.current = false
      return
    }
    onClick()
  }
  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onContextMenu(e.clientX, e.clientY)
  }
  return (
    <div
      className={`group relative rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={handleClick}
      onContextMenu={longPress.onContextMenu}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
    >
      {editing && (
        <button
          className="absolute top-2 left-2 z-10"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {selected ? (
            <CheckSquare className="h-5 w-5 text-primary" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
      )}
      <button
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleMoreClick}
      >
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="flex flex-col items-center justify-center h-28">
        <FolderIcon className="h-12 w-12 text-yellow-500" />
        <p className="text-sm font-medium mt-1 truncate px-2 max-w-full">{folder.name}</p>
        <p className="text-xs text-muted-foreground">{fileCount} 个文件</p>
      </div>
    </div>
  )
}

function GridFileCard({
  file,
  editing,
  selected,
  onToggle,
  onClick,
  onContextMenu,
}: {
  file: LibraryFile
  editing: boolean
  selected: boolean
  onToggle: () => void
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
}) {
  const Icon = TYPE_ICON[file.type] || FileText
  const longPress = useLongPress(onContextMenu)
  const handleClick = () => {
    if (longPress.longPressTriggered.current) {
      longPress.longPressTriggered.current = false
      return
    }
    onClick()
  }
  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onContextMenu(e.clientX, e.clientY)
  }
  return (
    <div
      className={`group relative rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={handleClick}
      onContextMenu={longPress.onContextMenu}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
    >
      {editing && (
        <button
          className="absolute top-2 left-2 z-10"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {selected ? (
            <CheckSquare className="h-5 w-5 text-primary" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
      )}
      <button
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleMoreClick}
      >
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="flex flex-col items-center justify-center h-28 overflow-hidden">
        {file.type === 'video' || file.type === 'audio' ? (
          <div
            className={`w-full flex items-center justify-center ${file.type === 'audio' ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-purple-50 dark:bg-purple-950/30'}`}
            style={{ height: '100%' }}
          >
            <Icon className="h-10 w-10 text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <Icon className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="p-2 border-t">
        <p className="text-xs truncate">{file.name}</p>
        {(file.lastPosition ?? 0) > 0 && (
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <History className="h-2.5 w-2.5 shrink-0" />
            上次播放到 {formatTime(file.lastPosition!)}
          </p>
        )}
      </div>
    </div>
  )
}

function ListFolderRow({
  folder,
  editing,
  selected,
  onToggle,
  onClick,
  onContextMenu,
}: {
  folder: Folder
  editing: boolean
  selected: boolean
  onToggle: () => void
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
}) {
  const longPress = useLongPress(onContextMenu)
  const handleClick = () => {
    if (longPress.longPressTriggered.current) {
      longPress.longPressTriggered.current = false
      return
    }
    onClick()
  }
  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onContextMenu(e.clientX, e.clientY)
  }
  return (
    <div
      className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-accent/50 cursor-pointer text-sm ${selected ? 'bg-primary/5' : ''}`}
      onClick={handleClick}
      onContextMenu={longPress.onContextMenu}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
    >
      <div className="col-span-6 sm:col-span-5 flex items-center gap-2">
        {editing &&
          (selected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4 text-muted-foreground" />
          ))}
        <FolderIcon className="h-4 w-4 text-yellow-500 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </div>
      <div className="hidden sm:block sm:col-span-3 text-muted-foreground text-xs">文件夹</div>
      <div className="col-span-6 sm:col-span-4 text-muted-foreground text-xs text-right sm:text-left">
        {new Date(folder.createdAt).toLocaleDateString('zh-CN')}
      </div>
    </div>
  )
}

function ListFileRow({
  file,
  editing,
  selected,
  onToggle,
  onClick,
  onContextMenu,
}: {
  file: LibraryFile
  editing: boolean
  selected: boolean
  onToggle: () => void
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
}) {
  const Icon = TYPE_ICON[file.type] || FileText
  const longPress = useLongPress(onContextMenu)
  const handleClick = () => {
    if (longPress.longPressTriggered.current) {
      longPress.longPressTriggered.current = false
      return
    }
    onClick()
  }
  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onContextMenu(e.clientX, e.clientY)
  }
  return (
    <div
      className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-accent/50 cursor-pointer text-sm ${selected ? 'bg-primary/5' : ''}`}
      onClick={handleClick}
      onContextMenu={longPress.onContextMenu}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
    >
      <div className="col-span-6 sm:col-span-5 flex items-center gap-2">
        {editing &&
          (selected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4 text-muted-foreground" />
          ))}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{file.name}</span>
      </div>
      <div className="hidden sm:block sm:col-span-3 text-muted-foreground text-xs">
        {file.type === 'video' ? '视频' : file.type === 'audio' ? '音频' : 'PDF'}
        {(file.lastPosition ?? 0) > 0 && (
          <span className="ml-1">· 播至 {formatTime(file.lastPosition!)}</span>
        )}
      </div>
      <div className="col-span-6 sm:col-span-4 text-muted-foreground text-xs text-right sm:text-left">
        {new Date(file.addedAt).toLocaleDateString('zh-CN')}
      </div>
    </div>
  )
}
