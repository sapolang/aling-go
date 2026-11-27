import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { HardDrive, Keyboard, SlidersHorizontal, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHORTCUT_ACTIONS, sameBinding, useShortcutStore } from '@/stores/shortcutStore'

const SETTINGS_NAV = [
  {
    path: 'general',
    label: '通用',
    title: '通用',
    description: '外观主题与应用版本。',
    icon: SlidersHorizontal,
  },
  {
    path: 'shortcuts',
    label: '快捷键',
    title: '快捷键',
    description:
      '点击键位后按下新组合键；Backspace 清除绑定，Esc 取消录制。支持单键或 Shift / Alt 组合，不支持 Cmd / Ctrl。快捷键仅在播放页生效。',
    icon: Keyboard,
  },
  {
    path: 'capability',
    label: '语音与 AI',
    title: '语音与 AI',
    description: '本地转录模型与在线翻译接口，两者都只在播放页被调用。',
    icon: Sparkles,
  },
  {
    path: 'data',
    label: '数据与存储',
    title: '数据与存储',
    description: '缓存会随播放自动生成；生词数据可备份、导出到 Anki，或从备份恢复。',
    icon: HardDrive,
  },
] as const

/**
 * 设置中心外壳：左侧二级导航，右侧只渲染当前分组。
 * 子路由挂在 /settings 下，主侧栏的 startsWith 判断会自动保持「设置」高亮。
 */
export default function SettingsPage() {
  const { pathname } = useLocation()
  const contentRef = useRef<HTMLDivElement>(null)
  const bindings = useShortcutStore((s) => s.bindings)

  const current =
    SETTINGS_NAV.find((item) => pathname === `/settings/${item.path}`) ?? SETTINGS_NAV[0]

  const modifiedShortcutCount = SHORTCUT_ACTIONS.filter((action) => {
    const binding = bindings[action.id]
    return binding ? !sameBinding(binding, action.defaultBinding) : true
  }).length

  // 顶部标题、说明与导航固定不动，只重置内容区的滚动位置
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [pathname])

  return (
    // 用负边距抵消 Layout 的 p-6，让右侧内容区自己成为滚动容器：
    // 滚动条贴窗口右缘，标题、说明与导航保持固定。
    <div className="-my-6 -mr-6 flex h-[calc(100%+3rem)] gap-10">
      <aside className="w-44 shrink-0 py-6">
        <h1 className="mb-5 text-2xl font-bold tracking-tight">设置</h1>
        <nav aria-label="设置分组" className="space-y-0.5">
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={`/settings/${item.path}`}
                className={({ isActive }) =>
                  cn(
                    'relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.path === 'shortcuts' && modifiedShortcutCount > 0 && (
                      <span
                        className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
                        title={`已修改 ${modifiedShortcutCount} 项快捷键`}
                      >
                        {modifiedShortcutCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border/50 pb-5 pr-6 pt-6">
          <h2 className="text-xl font-semibold tracking-tight">{current.title}</h2>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {current.description}
          </p>
        </header>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto pb-16 pr-6">
          <div
            key={pathname}
            className="max-w-3xl animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out"
          >
            <Suspense fallback={<p className="py-16 text-sm text-muted-foreground">加载中…</p>}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
