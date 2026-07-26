import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { Layout } from '@/components/Layout'
import { useThemeStore } from '@/stores/themeStore'
import { initBridge } from '@/api/bridge'

const Home = lazy(() => import('@/pages/Home'))
const Player = lazy(() => import('@/pages/Player'))
const WordList = lazy(() => import('@/pages/WordList'))
const WordCard = lazy(() => import('@/pages/WordCard'))
const Settings = lazy(() => import('@/pages/Settings'))
const Dict = lazy(() => import('@/pages/DictPage'))
const Review = lazy(() => import('@/pages/ReviewPage'))

function Loading() {
  return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
}

function AppContent() {
  const location = useLocation()
  const dark = useThemeStore((s) => s.dark)
  const isPlayer = location.pathname === '/player'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <Layout isPlayerRoute={isPlayer}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Home />} />
          <Route path="/words" element={<WordList />} />
          <Route path="/dict" element={<Dict />} />
          <Route path="/dict/:tag" element={<Review />} />
          <Route path="/card" element={<WordCard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>

      {/* Player 始终挂载，仅在 /player 可见 */}
      <Suspense fallback={null}>
        <Player />
      </Suspense>
    </Layout>
  )
}

export default function App() {
  useEffect(() => { initBridge() }, [])

  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  )
}
