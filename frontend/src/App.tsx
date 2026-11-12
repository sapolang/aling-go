import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Window, Screens } from '@wailsio/runtime'
import { Layout } from '@/components/Layout'
import { FeedbackHost } from '@/components/feedback'
import { useThemeStore } from '@/stores/themeStore'

const Home = lazy(() => import('@/pages/Home'))
const Player = lazy(() => import('@/pages/Player'))
const WordList = lazy(() => import('@/pages/WordList'))
const WordCard = lazy(() => import('@/pages/WordCard'))
const Settings = lazy(() => import('@/pages/Settings'))
const Dict = lazy(() => import('@/pages/DictPage'))
const Review = lazy(() => import('@/pages/ReviewPage'))
const ArticleList = lazy(() => import('@/pages/ArticleList'))
const ArticleTyping = lazy(() => import('@/pages/ArticleTyping'))
const Stats = lazy(() => import('@/pages/StatsPage'))
const Favorites = lazy(() => import('@/pages/Favorites'))
const Podcast = lazy(() => import('@/pages/Podcast'))

function Loading() {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
  )
}

// 等窗口尺寸稳定：连续 idleMs 毫秒没有 resize 事件（最多等 maxMs）
function waitForResizeSettle(idleMs = 120, maxMs = 450): Promise<void> {
  return new Promise((resolve) => {
    let last = Date.now()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.removeEventListener('resize', onResize)
      clearInterval(poll)
      clearTimeout(maxTimer)
      resolve()
    }
    const onResize = () => {
      last = Date.now()
    }
    const poll = setInterval(() => {
      if (Date.now() - last >= idleMs) finish()
    }, 30)
    const maxTimer = setTimeout(finish, maxMs)
    window.addEventListener('resize', onResize)
  })
}

function AppContent() {
  const location = useLocation()
  const dark = useThemeStore((s) => s.dark)
  const isPlayer = location.pathname === '/player'
  const [playerReady, setPlayerReady] = useState(true)
  const prevBounds = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // 进入播放页时把窗口一步铺满屏幕可用区域：Window.Maximise() 在 macOS 上是
  // 带动画的 zoom，动画期间 webview 逐帧 resize、播放器跟着逐帧重排导致卡顿；
  // SetSize/SetPosition 瞬时生效，整个过程最多一两次 resize。离开时用进入前
  // 记录的窗口位置尺寸还原。尺寸稳定前用遮罩盖住，避免露出中间状态。
  useEffect(() => {
    let cancelled = false
    if (isPlayer) {
      setPlayerReady(false)
      ;(async () => {
        try {
          if (await Window.IsMaximised()) return
          const [size, pos, screen] = await Promise.all([
            Window.Size(),
            Window.Position(),
            Screens.GetCurrent(),
          ])
          prevBounds.current = { x: pos.x, y: pos.y, w: size.width, h: size.height }
          const wa = screen?.WorkArea
          if (wa) {
            await Window.SetSize(wa.Width, wa.Height)
            await Window.SetPosition(wa.X, wa.Y)
          }
          await waitForResizeSettle()
        } catch {
          // 取屏或设置失败时直接展示，不阻塞进入播放页
        } finally {
          if (!cancelled) setPlayerReady(true)
        }
      })()
    } else if (prevBounds.current) {
      const b = prevBounds.current
      prevBounds.current = null
      Window.SetSize(b.w, b.h)
        .then(() => Window.SetPosition(b.x, b.y))
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [isPlayer])

  return (
    <Layout isPlayerRoute={isPlayer}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Home />} />
          <Route path="/podcast" element={<Podcast />} />
          {/* 旧在线播放页已并入 /player，保留路径做重定向 */}
          <Route path="/player-online" element={<Navigate to="/player" replace />} />
          <Route path="/words" element={<WordList />} />
          <Route path="/dict" element={<Dict />} />
          <Route path="/dict/:tag" element={<Review />} />
          <Route path="/card" element={<WordCard />} />
          <Route path="/articles" element={<ArticleList />} />
          <Route path="/articles/:id" element={<ArticleTyping />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>

      {/* Player 始终挂载，仅在 /player 可见 */}
      <Suspense fallback={null}>
        <Player />
      </Suspense>

      {/* 窗口尺寸稳定前的过渡遮罩（播放器正常渲染，只是被盖住） */}
      {isPlayer && !playerReady && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground">
          正在打开播放器...
        </div>
      )}
    </Layout>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
      <FeedbackHost />
    </HashRouter>
  )
}
