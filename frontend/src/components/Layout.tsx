import { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { usePlayerStore } from '@/stores/playerStore'
import { Home, Play, BookOpen, FlipVertical, Settings, Pause, Loader2, X, Library } from 'lucide-react'

const navItems = [
  { path: '/', label: '文件库', icon: Home },
  { path: '/words', label: '生词库', icon: BookOpen },
  { path: '/dict', label: '单词书', icon: Library },
  { path: '/card', label: '卡片背诵', icon: FlipVertical },
  { path: '/settings', label: '设置', icon: Settings }
]

export function Layout({ children, isPlayerRoute }: { children: ReactNode; isPlayerRoute: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const filePath = usePlayerStore((s) => s.filePath)
  const playing = usePlayerStore((s) => s.playing)
  const transcribing = usePlayerStore((s) => s.transcribing)
  const progress = usePlayerStore((s) => s.transcriptionProgress)
  const setPlaying = usePlayerStore((s) => s.setPlaying)
  const closeFile = usePlayerStore((s) => s.closeFile)

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-bold">Aling</h1>
          <p className="text-xs text-muted-foreground">Aling</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            return (
              <Button
                key={item.path}
                variant={active ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-3"
                onClick={() => navigate(item.path)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            )
          })}
        </nav>
        <div className="p-3 border-t flex items-center justify-between">
          <span className="text-xs text-muted-foreground">v1.0.0</span>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>

        {/* Mini 播放条 — 有文件时始终显示 */}
        {filePath && !isPlayerRoute && (
          <div className="border-t bg-card px-4 py-2 flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setPlaying(!playing)}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <span className="text-sm truncate flex-1">
              {filePath.split('/').pop()}
            </span>
            {transcribing ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> 转录中 {progress}%
              </span>
            ) : (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate('/player')}>
                打开播放器
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={closeFile}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
