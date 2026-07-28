import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore, type LibraryFile, type Folder } from '@/stores/libraryStore'
import { usePlayerStore } from '@/stores/playerStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import SrtParser from 'srt-parser-2'
import { timeToSeconds } from '@/lib/srt'
import {
  FileUp, Pencil, FolderPlus, LayoutGrid, List, ArrowUpDown, Trash2,
  Film, Music, FileText, Folder as FolderIcon, CheckSquare, Square,
  ArrowLeft, ChevronRight, Home, X, FolderOutput, MoreHorizontal
} from 'lucide-react'

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

interface ToastState {
  message: string
  variant: 'success' | 'warning' | 'error'
}

export default function HomePage() {
  const store = useLibraryStore()
  const player = usePlayerStore()
  const navigate = useNavigate()
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [contextMoveOpen, setContextMoveOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, itemPath: '', isFolder: false })
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const [renameDialog, setRenameDialog] = useState<{ visible: boolean; name: string; itemPath: string; isFolder: boolean }>({
    visible: false, name: '', itemPath: '', isFolder: false
  })

  useEffect(() => { store.load() }, [])

  const showToast = useCallback((message: string, variant: ToastState['variant'] = 'success') => {
    setToast({ message, variant })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(p => ({ ...p, visible: false }))
    setContextMoveOpen(false)
  }, [])

  const openContextMenu = useCallback((x: number, y: number, itemPath: string, isFolder: boolean) => {
    setContextMenu({ visible: true, x, y, itemPath, isFolder })
  }, [])

  const handleImport = async () => {
    const result = await window.api.libraryImport(store.category, store.currentFolderId || '')
    if (result.imported === 0 && result.skipped === 0 && (result.dropped || 0) === 0) return
    await store.load()
    const parts: string[] = []
    if (result.imported > 0) parts.push(`导入成功 ${result.imported} 个`)
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 个（已存在）`)
    if (result.dropped > 0) parts.push(`已达上限，丢弃 ${result.dropped} 个`)
    const msg = parts.join('，')
    if (result.imported > 0) {
      showToast(msg, 'success')
    } else if (result.dropped > 0) {
      showToast(msg, 'warning')
    } else {
      showToast('所选文件均已导入过', 'warning')
    }
  }

  const handleDelete = async (paths?: string[]) => {
    try {
      const itemsToDelete = paths || Array.from(store.selectedPaths)
      if (itemsToDelete.length === 0) return

      const folderIds: string[] = []
      const filePaths: string[] = []
      const allFolders = new Set(store.folders.map(f => f.id))
      itemsToDelete.forEach(p => {
        if (allFolders.has(p)) folderIds.push(p)
        else filePaths.push(p)
      })

      if (filePaths.length > 0) await window.api.libraryRemove(filePaths)
      for (const id of folderIds) {
        await window.api.folderDelete(id)
      }
      await store.load()
      store.clearSelection()
      closeContextMenu()
      showToast(`已删除 ${itemsToDelete.length} 项`, 'success')
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

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('确定要删除此文件夹吗？文件夹内的文件将移到未归类。')) return
    await window.api.folderDelete(id)
    await store.load()
    store.clearSelection()
  }

  const handleOpenFile = async (file: LibraryFile) => {
    if (file.type === 'pdf') {
      await window.api.openExternal(file.path)
      return
    }
    player.setFilePath(file.path)
    navigate('/player')
    player.setWaveformLoading(true)
      window.api.getWaveformData(file.path).then((data: number[]) => {
      if (data && data.length > 0) player.setWaveformData(data)
      else player.setWaveformLoading(false)
    }).catch(() => player.setWaveformLoading(false))
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
          text: s.text
        }))
        player.setSubtitles(subs)
        window.api.cacheSubtitles(file.path, subs)
      } catch {}
    } catch {}
    await window.api.recentAdd(file.path)
  }

  const handleEnterFolder = (folder: Folder) => {
    store.setCurrentFolder(folder.id)
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
    ? store.folders.find(f => f.id === store.currentFolderId)
    : null

  const visibleFolders = store.folders.filter(f => {
    if (currentFolder) {
      return f.parentId === currentFolder.id
    }
    if (store.category === 'folder') return !f.parentId
    if (store.category === 'all') return !f.parentId
    return false
  })

  const visibleFiles = store.files.filter(f => {
    if (currentFolder && f.folderId !== currentFolder.id) return false
    if (!currentFolder && f.folderId) return false
    if (store.category === 'folder') return false
    if (store.category === 'all') return true
    return f.type === store.category
  }).sort(sortFn)

  const totalVisible = visibleFolders.length + visibleFiles.length
  const isAllSelected = totalVisible > 0 &&
    visibleFolders.every(f => store.selectedPaths.has(f.id)) &&
    visibleFiles.every(f => store.selectedPaths.has(f.path))

  const handleSelectAll = () => {
    if (isAllSelected) {
      store.clearSelection()
    } else {
      store.selectAll(visibleFolders.map(f => f.id), visibleFiles.map(f => f.path))
    }
  }

  const getFolderFileCount = (folderId: string): number => {
    let count = store.files.filter(f => f.folderId === folderId).length
    for (const sub of store.folders.filter(f => f.parentId === folderId)) {
      count += getFolderFileCount(sub.id)
    }
    return count
  }

  const getBreadcrumbPath = (): Folder[] => {
    const parts: Folder[] = []
    let cur: Folder | null | undefined = currentFolder
    while (cur) {
      parts.unshift(cur)
      cur = store.folders.find(f => f.id === cur!.parentId) ?? null
    }
    return parts
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleImport}>
          <FileUp className="h-4 w-4 mr-1" /> 导入
        </Button>
        <Button size="sm" variant={store.editing ? 'default' : 'outline'} onClick={store.toggleEditing}>
          <Pencil className="h-4 w-4 mr-1" /> 编辑
        </Button>
        {store.category === 'folder' && (
          <Button size="sm" variant="outline" onClick={() => setShowNewFolder(true)}>
            <FolderPlus className="h-4 w-4 mr-1" /> 新建文件夹
          </Button>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1 border rounded p-0.5">
          <Button size="sm" variant={store.viewMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => store.setViewMode('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={store.viewMode === 'list' ? 'secondary' : 'ghost'} onClick={() => store.setViewMode('list')}>
            <List className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setSortOpen(!sortOpen)}>
            <ArrowUpDown className="h-4 w-4 mr-1" /> {sortOptions.find(o => o.key === store.sortBy)?.label}
          </Button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[160px]" onClick={() => setSortOpen(false)}>
              {sortOptions.map(o => (
                <button key={o.key} className={`w-full px-3 py-1.5 text-xs hover:bg-accent text-left ${store.sortBy === o.key ? 'font-medium' : ''}`}
                  onClick={() => { store.setSortBy(o.key); setSortOpen(false) }}>
                  {o.label} {store.sortBy === o.key ? '✓' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 border-b pb-2">
        {currentFolder && (
          <Button variant="ghost" size="sm" className="mr-2" onClick={handleExitFolder}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
        )}
        {CATEGORIES.map(cat => {
          const Icon = cat.icon
          return (
            <Button key={cat.key} size="sm" variant={store.category === cat.key ? 'secondary' : 'ghost'}
              onClick={() => { store.setCategory(cat.key); handleExitFolder() }}>
              {Icon && <Icon className="h-3.5 w-3.5 mr-1" />}
              {cat.label}
            </Button>
          )
        })}
      </div>

      {/* Breadcrumb for folder */}
      {currentFolder && (() => {
        const path = getBreadcrumbPath()
        return (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <button onClick={() => store.setCurrentFolder(null)} className="hover:text-foreground"><Home className="h-3.5 w-3.5 inline" /></button>
            {path.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                {i < path.length - 1 ? (
                  <button onClick={() => store.setCurrentFolder(f.id)} className="hover:text-foreground">{f.name}</button>
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
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded relative">
          <Button size="sm" variant="ghost" onClick={handleSelectAll}>
            {isAllSelected ? <CheckSquare className="h-4 w-4 mr-1" /> : <Square className="h-4 w-4 mr-1" />}
            {isAllSelected ? '取消全选' : '全选'}
          </Button>
          <span className="text-xs text-muted-foreground">已选 {store.selectedPaths.size} 项</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setShowMoveMenu(!showMoveMenu)} disabled={store.selectedPaths.size === 0}>
            移动到
          </Button>
          {showMoveMenu && (
            <div className="absolute right-[72px] top-full mt-1 bg-popover border rounded shadow-lg py-1 z-50 min-w-[140px]">
              <button className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => handleMove('')}>未归类</button>
              {store.folders.map(f => (
                <button key={f.id} className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => handleMove(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="destructive" onClick={() => handleDelete()} disabled={store.selectedPaths.size === 0}>
            <Trash2 className="h-4 w-4 mr-1" /> 删除
          </Button>
        </div>
      )}

      {/* New folder dialog */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewFolder(false)}>
          <Card className="w-80 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">新建文件夹</h3>
            <Input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              placeholder="输入文件夹名称" onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} />
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="outline" size="sm" onClick={() => setShowNewFolder(false)}>取消</Button>
              <Button size="sm" onClick={handleCreateFolder}>创建</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Rename dialog */}
      {renameDialog.visible && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRenameDialog(p => ({ ...p, visible: false }))}>
          <Card className="w-80 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">重命名</h3>
            <Input value={renameDialog.name} onChange={e => setRenameDialog(p => ({ ...p, name: e.target.value }))}
              placeholder="输入新名称" autoFocus onKeyDown={e => e.key === 'Enter' && handleRenameSubmit()} />
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="outline" size="sm" onClick={() => setRenameDialog(p => ({ ...p, visible: false }))}>取消</Button>
              <Button size="sm" onClick={handleRenameSubmit}>确定</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Grid View */}
      {store.viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {visibleFolders.map(folder => (
            <GridFolderCard key={folder.id} folder={folder} fileCount={getFolderFileCount(folder.id)}
              editing={store.editing} selected={store.selectedPaths.has(folder.id)}
              onToggle={() => store.toggleSelect(folder.id)}
              onClick={() => store.editing ? store.toggleSelect(folder.id) : handleEnterFolder(folder)}
              onContextMenu={(x, y) => openContextMenu(x, y, folder.id, true)} />
          ))}
          {visibleFiles.map(file => (
            <GridFileCard key={file.path} file={file}
              editing={store.editing} selected={store.selectedPaths.has(file.path)}
              onToggle={() => store.toggleSelect(file.path)}
              onClick={() => store.editing ? store.toggleSelect(file.path) : handleOpenFile(file)}
              onContextMenu={(x, y) => openContextMenu(x, y, file.path, false)} />
          ))}
        </div>
      )}

      {/* List View */}
      {store.viewMode === 'list' && (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
            <div className="col-span-5">名称</div>
            <div className="col-span-3">类型</div>
            <div className="col-span-4">添加时间</div>
          </div>
          <div className="divide-y">
            {visibleFolders.map(folder => (
              <ListFolderRow key={folder.id} folder={folder}
                editing={store.editing} selected={store.selectedPaths.has(folder.id)}
                onToggle={() => store.toggleSelect(folder.id)}
                onClick={() => store.editing ? store.toggleSelect(folder.id) : handleEnterFolder(folder)}
                onContextMenu={(x, y) => openContextMenu(x, y, folder.id, true)} />
            ))}
            {visibleFiles.map(file => (
              <ListFileRow key={file.path} file={file}
                editing={store.editing} selected={store.selectedPaths.has(file.path)}
                onToggle={() => store.toggleSelect(file.path)}
                onClick={() => store.editing ? store.toggleSelect(file.path) : handleOpenFile(file)}
                onContextMenu={(x, y) => openContextMenu(x, y, file.path, false)} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleFolders.length === 0 && visibleFiles.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">{currentFolder ? '此文件夹为空' : '暂无文件'}</p>
          <p className="text-sm mb-4">{currentFolder ? '点击导入添加文件到此文件夹' : '点击「导入」添加音视频或 PDF 文件'}</p>
          <Button size="sm" onClick={handleImport}>
            <FileUp className="h-4 w-4 mr-1" /> 导入文件
          </Button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={closeContextMenu} />
          <div className="fixed z-[61] bg-popover border rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 150), top: Math.min(contextMenu.y, window.innerHeight - 120) }}>
            <button className="w-full px-3 py-2 text-xs hover:bg-accent text-left flex items-center gap-2"
              onClick={(e) => { e.stopPropagation(); setContextMoveOpen(!contextMoveOpen) }}>
              <FolderOutput className="h-3.5 w-3.5" /> 移动到
            </button>
            {contextMoveOpen && (
              <div className="border-t py-1">
                <button className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => handleMove('')}>未归类</button>
                {store.folders.filter(f => f.id !== contextMenu.itemPath).map(f => (
                  <button key={f.id} className="w-full px-3 py-1.5 text-xs hover:bg-accent text-left" onClick={() => handleMove(f.id)}>
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <button className="w-full px-3 py-2 text-xs hover:bg-accent text-left flex items-center gap-2"
              onClick={() => {
                const itemName = contextMenu.isFolder
                  ? store.folders.find(f => f.id === contextMenu.itemPath)?.name || ''
                  : store.files.find(f => f.path === contextMenu.itemPath)?.name || ''
                closeContextMenu()
                setRenameDialog({ visible: true, name: itemName, itemPath: contextMenu.itemPath, isFolder: contextMenu.isFolder })
              }}>
              <Pencil className="h-3.5 w-3.5" /> 重命名
            </button>
            <button className="w-full px-3 py-2 text-xs hover:bg-accent text-left flex items-center gap-2 text-destructive"
              onClick={handleContextDelete}>
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-lg shadow-lg text-sm transition-all ${
          toast.variant === 'success' ? 'bg-green-600 text-white' :
          toast.variant === 'warning' ? 'bg-amber-500 text-white' :
          'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

function useLongPress(onLongPress: (x: number, y: number) => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const longPressTriggered = useRef(false)
  const moved = useRef(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    longPressTriggered.current = false
    moved.current = false
    const touch = e.touches[0]
    timerRef.current = setTimeout(() => {
      longPressTriggered.current = true
      onLongPress(touch.clientX, touch.clientY)
    }, ms)
  }, [onLongPress, ms])

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

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    onLongPress(e.clientX, e.clientY)
  }, [onLongPress])

  return { onTouchStart, onTouchMove, onTouchEnd, onContextMenu, longPressTriggered, moved }
}

function GridFolderCard({ folder, fileCount, editing, selected, onToggle, onClick, onContextMenu }: {
  folder: Folder; fileCount: number; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
  onContextMenu: (x: number, y: number) => void;
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
        <button className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggle() }}>
          {selected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
        </button>
      )}
      <button className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity" onClick={handleMoreClick}>
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

function GridFileCard({ file, editing, selected, onToggle, onClick, onContextMenu }: {
  file: LibraryFile; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
  onContextMenu: (x: number, y: number) => void;
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
        <button className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggle() }}>
          {selected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-muted-foreground" />}
        </button>
      )}
      <button className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity" onClick={handleMoreClick}>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="flex flex-col items-center justify-center h-28 overflow-hidden">
        {file.type === 'video' || file.type === 'audio' ? (
          <div className={`w-full flex items-center justify-center ${file.type === 'audio' ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-purple-50 dark:bg-purple-950/30'}`} style={{ height: '100%' }}>
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
      </div>
    </div>
  )
}

function ListFolderRow({ folder, editing, selected, onToggle, onClick, onContextMenu }: {
  folder: Folder; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
  onContextMenu: (x: number, y: number) => void;
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
      <div className="col-span-5 flex items-center gap-2">
        {editing && (
          selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />
        )}
        <FolderIcon className="h-4 w-4 text-yellow-500 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </div>
      <div className="col-span-3 text-muted-foreground text-xs">文件夹</div>
      <div className="col-span-4 text-muted-foreground text-xs">{new Date(folder.createdAt).toLocaleDateString('zh-CN')}</div>
    </div>
  )
}

function ListFileRow({ file, editing, selected, onToggle, onClick, onContextMenu }: {
  file: LibraryFile; editing: boolean; selected: boolean;
  onToggle: () => void; onClick: () => void;
  onContextMenu: (x: number, y: number) => void;
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
      <div className="col-span-5 flex items-center gap-2">
        {editing && (
          selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />
        )}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{file.name}</span>
      </div>
      <div className="col-span-3 text-muted-foreground text-xs">
        {file.type === 'video' ? '视频' : file.type === 'audio' ? '音频' : 'PDF'}
      </div>
      <div className="col-span-4 text-muted-foreground text-xs">{new Date(file.addedAt).toLocaleDateString('zh-CN')}</div>
    </div>
  )
}
