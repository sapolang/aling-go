import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsGroup, SettingsRow } from './primitives'
import { useThemeStore } from '@/stores/themeStore'
import type { ThemeMode } from '@/stores/themeStore'
import { useUpdateStore } from '@/stores/updateStore'

export default function SettingsGeneral() {
  const themeMode = useThemeStore((s) => s.mode)
  const setThemeMode = useThemeStore((s) => s.setMode)
  const [appVersion, setAppVersion] = useState('dev')

  // --- 版本更新（状态保存在全局 store，切换页面不会丢失下载进度） ---
  const updateStep = useUpdateStore((s) => s.step)
  const updateVersion = useUpdateStore((s) => s.latestVersion)
  const updateProgress = useUpdateStore((s) => s.progress)
  const updateError = useUpdateStore((s) => s.error)
  const hasUpdateHint = useUpdateStore((s) => s.hasUpdate)

  // 回到设置页时与后端真实阶段对齐（下载可能在离开期间完成）
  useEffect(() => {
    useUpdateStore.getState().sync()
    window.api.getVersion().then(setAppVersion)
  }, [])

  // 历史版本遗留的状态未同步时，用后台检查结果兜底展示
  const displayStep = updateStep === 'idle' && hasUpdateHint ? 'available' : updateStep
  const displayVersion = updateVersion

  const handleUpdateAction = () => {
    const store = useUpdateStore.getState()
    if (displayStep === 'ready') {
      void store.apply()
      return
    }
    if (displayStep === 'available') {
      void store.download()
      return
    }
    void store.check()
  }

  const updateStatus = updateError
    ? updateError
    : displayStep === 'checking'
      ? '正在检查更新…'
      : displayStep === 'latest'
        ? '已是最新版本'
        : displayStep === 'available'
          ? `发现新版本 v${displayVersion}`
          : displayStep === 'downloading'
            ? `正在下载更新 ${updateProgress}%`
            : displayStep === 'ready'
              ? '更新已就绪，重启应用后完成安装'
              : '通过 GitHub Releases 检查新版本'

  return (
    <>
      <SettingsGroup title="外观">
        <SettingsRow title="主题" description="选择亮色、暗色，或跟随系统外观">
          <Select value={themeMode} onValueChange={(v) => setThemeMode(v as ThemeMode)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">亮色</SelectItem>
              <SelectItem value="dark">暗色</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="关于">
        <SettingsRow title="语练" description="英语输入输出训练台">
          <span className="font-mono text-sm text-muted-foreground">v{appVersion}</span>
        </SettingsRow>
        <SettingsRow
          title="版本更新"
          description={
            <span className={updateError ? 'text-destructive' : undefined}>{updateStatus}</span>
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled={displayStep === 'checking' || displayStep === 'downloading'}
            onClick={handleUpdateAction}
          >
            {displayStep === 'checking' || displayStep === 'downloading' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : displayStep === 'ready' ? (
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
            ) : displayStep === 'available' ? (
              <Download className="h-3.5 w-3.5 mr-1" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            {displayStep === 'checking'
              ? '检查中…'
              : displayStep === 'downloading'
                ? `下载中 ${updateProgress}%`
                : displayStep === 'ready'
                  ? '重启并安装'
                  : displayStep === 'available'
                    ? '下载更新'
                    : '检查更新'}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
