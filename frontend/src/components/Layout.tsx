import { ReactNode, useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { confirmDialog, showToast } from '@/components/feedback'
import { basename } from '@/utils/path'
import { looksLikeMediaLink, openResolvedMedia } from '@/utils/mediaLink'
import { usePlayerStore } from '@/stores/playerStore'
import { useWordStore } from '@/stores/wordStore'
import { useUpdateStore } from '@/stores/updateStore'
import {
  Home,
  Play,
  BookOpen,
  FlipVertical,
  Settings,
  Pause,
  Loader2,
  X,
  Library,
  PanelLeftClose,
  PanelLeft,
  Type,
  BarChart3,
  Star,
  Rss,
  History,
} from 'lucide-react'

const navItems = [
  { path: '/', label: '文件库', icon: Home },
  { path: '/podcast', label: '播客订阅', icon: Rss },
  { path: '/history', label: '学习历史', icon: History },
  { path: '/favorites', label: '收藏片段', icon: Star },
  { path: '/words', label: '生词库', icon: BookOpen },
  { path: '/dict', label: '词库浏览', icon: Library },
  { path: '/card', label: '今日复习', icon: FlipVertical },
  { path: '/stats', label: '学习统计', icon: BarChart3 },
  { path: '/articles', label: '文章打字', icon: Type },
  { path: '/settings', label: '设置', icon: Settings },
]

export function Layout({
  children,
  isPlayerRoute,
}: {
  children: ReactNode
  isPlayerRoute: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const filePath = usePlayerStore((s) => s.filePath)
  const mediaTitle = usePlayerStore((s) => s.mediaTitle)
  const playing = usePlayerStore((s) => s.playing)
  const transcribing = usePlayerStore((s) => s.transcribing)
  const progress = usePlayerStore((s) => s.transcriptionProgress)
  const setPlaying = usePlayerStore((s) => s.setPlaying)
  const closeFile = usePlayerStore((s) => s.closeFile)
  const reviewCount = useWordStore((s) => s.reviewTotal)
  const reviewCompleted = useWordStore((s) => s.reviewCompleted)
  const loadReviewCount = useWordStore((s) => s.loadReviewCount)
  const [collapsed, setCollapsed] = useState(false)
  const [appVersion, setAppVersion] = useState('dev')
  const hasUpdate = useUpdateStore((s) => s.hasUpdate)
  const latestVersion = useUpdateStore((s) => s.latestVersion)
  // 粘贴解析期间避免重复触发
  const linkBusyRef = useRef(false)

  // 窄窗口下自动收起侧栏，给内容留出空间
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    if (mq.matches) setCollapsed(true)
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsed(true)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    loadReviewCount()
  }, [location.pathname, loadReviewCount])

  // 全局 Ctrl/Cmd+V：粘贴 YouTube / B站 视频地址直接打开播放，频道链接引导订阅
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      // 输入框内的粘贴交给输入框自己处理
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      const text = e.clipboardData?.getData('text') || ''
      if (!text || !looksLikeMediaLink(text)) return
      e.preventDefault()
      if (linkBusyRef.current) return
      linkBusyRef.current = true
      try {
        const res = await window.api.resolveMediaURL(text)
        if (res.needSubscribe) {
          const ok = await confirmDialog({
            title: '这是一个频道链接',
            description: '频道链接不能直接播放。是否前往播客页订阅该频道？',
            confirmText: '去订阅',
            cancelText: '取消',
          })
          if (!ok) return
          navigate('/podcast', { state: { feedUrl: res.feedUrl, platformUrl: text.trim() } })
          return
        }
        if (!res.ok || !openResolvedMedia(res, navigate, location.pathname)) {
          showToast(res.error || '暂不支持该链接', 'error')
        }
      } catch {
        showToast('解析链接失败，请检查网络后重试', 'error')
      } finally {
        linkBusyRef.current = false
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [navigate, location.pathname])

  useEffect(() => {
    let timer: number | undefined
    window.api.getVersion().then((v: string) => {
      setAppVersion(v)
      // 开发构建不做后台检查，避免把正式版本误标为新版本
      if (!v || !/^\d+\.\d+\.\d+/.test(v)) return
      timer = window.setTimeout(async () => {
        try {
          const info = await window.api.checkUpdate()
          if (info?.hasUpdate && info.latestVersion) {
            useUpdateStore.getState().setAvailable(info.latestVersion)
          }
        } catch {
          // 后台检查失败保持静默
        }
      }, 8000)
    })
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  const handleCloseFile = async () => {
    if (playing || transcribing) {
      const ok = await confirmDialog({
        title: '关闭当前文件？',
        description: transcribing
          ? '正在转录，关闭后会中断转录任务。'
          : '播放进度会保留，下次打开可继续。',
        confirmText: '关闭',
        cancelText: '继续播放',
        destructive: true,
      })
      if (!ok) return
    }
    closeFile()
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={`border-r bg-muted/30 flex flex-col shrink-0 transition-all duration-200 ${
          isPlayerRoute ? 'hidden' : collapsed ? 'w-14' : 'w-56'
        }`}
      >
        <div className="p-4 border-b flex items-center justify-between">
          {collapsed ? (
            <h1 className="text-sm font-bold">A</h1>
          ) : (
            <div>
              <h1 className="text-lg font-bold">Aling</h1>
              <p className="text-xs text-muted-foreground">语练</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active =
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname === item.path || location.pathname.startsWith(item.path + '/')
            const badge =
              item.path === '/card'
                ? Math.max(0, reviewCount - (location.pathname === '/card' ? reviewCompleted : 0))
                : 0
            return (
              <Button
                key={item.path}
                variant={active ? 'secondary' : 'ghost'}
                className={`relative w-full justify-start gap-3 ${collapsed ? 'px-0 justify-center' : ''}`}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
                {badge > 0 && (
                  <span
                    className={`ml-auto rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground ${collapsed ? 'absolute top-1 right-1 ml-0' : ''}`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Button>
            )
          })}
        </nav>
        <div className="p-3 border-t flex items-center justify-between">
          <button
            type="button"
            className={`flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ${collapsed ? 'justify-center w-4' : ''}`}
            title={hasUpdate ? `发现新版本 v${latestVersion}，点击查看` : '检查更新'}
            onClick={() => navigate('/settings')}
          >
            {!collapsed && <span>{`v${appVersion}`}</span>}
            {hasUpdate && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <main className={`flex-1 overflow-y-auto ${isPlayerRoute ? 'p-3 md:p-6' : 'p-6'}`}>
          {children}
        </main>

        {/* Mini 播放条 — 有文件时始终显示 */}
        {filePath && !isPlayerRoute && (
          <div className="border-t bg-card px-4 py-2 flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setPlaying(!playing)}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <span className="text-sm truncate flex-1">{mediaTitle || basename(filePath)}</span>
            {transcribing && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> 转录中 {progress}%
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => navigate('/player', { state: { from: location.pathname } })}
            >
              打开播放器
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCloseFile}
              title="关闭文件"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
