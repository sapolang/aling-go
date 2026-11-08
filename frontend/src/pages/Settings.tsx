import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmDialog, showToast } from '@/components/feedback'
import { useThemeStore } from '@/stores/themeStore'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  SHORTCUT_GROUP_ORDER,
  formatBinding,
  sameBinding,
  useShortcutStore,
} from '@/stores/shortcutStore'
import type { ShortcutActionId, ShortcutGroupId } from '@/stores/shortcutStore'
import {
  Sun,
  Moon,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  Mic,
  Loader2,
  Sparkles,
  Keyboard,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
} from 'lucide-react'

interface ExportedWord {
  word: string
  definition: string
  phonetic: string
  example: string
  tags: string
}

function escapeCSV(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export default function SettingsPage() {
  const { dark, toggle } = useThemeStore()
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAll = useShortcutStore((s) => s.resetAll)
  const [appVersion, setAppVersion] = useState('dev')
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null)
  const [shortcutConflict, setShortcutConflict] = useState<{
    actionId: ShortcutActionId
    conflictId: ShortcutActionId
  } | null>(null)
  const [expandedShortcutGroups, setExpandedShortcutGroups] = useState<Set<ShortcutGroupId>>(
    () => new Set<ShortcutGroupId>(),
  )
  const [importResult, setImportResult] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [whisperStatus, setWhisperStatus] = useState<{
    loaded: boolean
    loading: boolean
    model: string
  } | null>(null)
  const [whisperModels, setWhisperModels] = useState<
    { name: string; file: string; size: string; downloaded: boolean }[]
  >([])
  const [selectedModel, setSelectedModel] = useState('tiny')
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  // --- AI 翻译配置 ---
  const [aiCfg, setAiCfg] = useState<{ baseUrl: string; model: string; hasKey: boolean } | null>(
    null,
  )
  const [aiBaseURL, setAiBaseURL] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestMsg, setAiTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  const handleExport = async () => {
    try {
      const jsonStr = await window.api.dbExport()
      const filePath = await window.api.saveFile(
        `novaling-backup-${new Date().toISOString().split('T')[0]}.json`,
      )
      if (filePath) {
        await window.api.writeTextFile(filePath, jsonStr)
        showToast('导出成功！')
      }
    } catch (err) {
      showToast('导出失败: ' + err, 'error')
    }
  }

  const handleExportCSV = async () => {
    try {
      const jsonStr = await window.api.dbExport()
      const { words = [] } = JSON.parse(jsonStr)
      const header = ['word', 'definition', 'phonetic', 'example', 'tags']
      const rows = words.map((w: ExportedWord) => [
        w.word,
        w.definition,
        w.phonetic,
        w.example,
        String(w.tags ?? '')
          .split(/[,，\s]+/)
          .filter(Boolean)
          .join(' '),
      ])
      const csv = [header, ...rows].map((row: unknown[]) => row.map(escapeCSV).join(',')).join('\n')
      const filePath = await window.api.saveFile(
        `novaling-words-${new Date().toISOString().split('T')[0]}.csv`,
      )
      if (filePath) {
        await window.api.writeTextFile(filePath, csv)
        showToast('导出成功，可直接在 Anki 中导入')
      }
    } catch (err) {
      showToast('导出失败: ' + err, 'error')
    }
  }

  const handleImport = async () => {
    try {
      const filePath = await window.api.openFile('*.json')
      if (!filePath) return
      const content = await window.api.readTextFile(filePath)
      const result = await window.api.dbImport(content)
      setImportResult(`导入完成：新增 ${result.imported} 条，跳过 ${result.skipped} 条（已存在）`)
    } catch (err) {
      showToast('导入失败: ' + err, 'error')
    }
  }

  useEffect(() => {
    window.api.whisperStatus().then((s: any) => {
      setWhisperStatus(s)
      const current = s.model.replace(/\.bin$/, '').replace('ggml-', '')
      setSelectedModel(current)
    })
    window.api.listWhisperModels().then(setWhisperModels)

    window.api.aiGetConfig().then((cfg: any) => {
      setAiCfg(cfg)
      setAiBaseURL(cfg.baseUrl)
      setAiModel(cfg.model)
    })

    window.api.getVersion().then(setAppVersion)

    let resumeCleanup: (() => void) | null = null
    window.api.getDownloadProgress().then((d: string) => {
      if (d) {
        const { model, progress } = JSON.parse(d)
        setSelectedModel(model)
        setDownloading(true)
        setDownloadProgress(progress)
        resumeCleanup = window.api.onDownloadProgress((pct: number) => setDownloadProgress(pct))
      }
    })

    return () => {
      resumeCleanup?.()
    }
  }, [])

  // --- 快捷键录制：捕获阶段拦截，避免触发按钮原生行为与页面滚动 ---
  useEffect(() => {
    if (!recordingId) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.key === 'Escape') {
        setShortcutConflict(null)
        setRecordingId(null)
        return
      }
      if (e.metaKey || e.ctrlKey) {
        showToast('不支持 Cmd / Ctrl 组合', 'warning')
        return
      }
      if (e.isComposing) return
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return
      if (e.code === 'Tab') {
        showToast('Tab 键不可用', 'warning')
        return
      }
      if (e.code === 'Backspace') {
        setBinding(recordingId, null)
        setShortcutConflict(null)
        setRecordingId(null)
        showToast('已清除绑定')
        return
      }

      const binding = { code: e.code, shift: e.shiftKey, alt: e.altKey }
      const conflict = setBinding(recordingId, binding)
      if (conflict) {
        setShortcutConflict({ actionId: recordingId, conflictId: conflict })
        const label = SHORTCUT_ACTIONS.find((action) => action.id === conflict)?.label ?? conflict
        showToast(`已被「${label}」占用`, 'warning')
        return
      }
      setShortcutConflict(null)
      setRecordingId(null)
      showToast(`已设为 ${formatBinding(binding)}`)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recordingId, setBinding])

  const handleResetAllShortcuts = async () => {
    // 先退出录制，避免确认框打开后按键仍被录制器捕获
    setRecordingId(null)
    setShortcutConflict(null)
    const ok = await confirmDialog({
      title: '恢复默认快捷键',
      description: '将播放器所有快捷键恢复为默认键位，自定义设置会丢失。',
      confirmText: '恢复默认',
    })
    if (!ok) return
    resetAll()
    showToast('已恢复默认快捷键')
  }

  const handleResetShortcut = (id: ShortcutActionId) => {
    setRecordingId((current) => (current === id ? null : current))
    setShortcutConflict(null)
    resetBinding(id)
    showToast('已恢复默认键位')
  }

  const modifiedShortcutCount = SHORTCUT_ACTIONS.filter((action) => {
    const binding = shortcutBindings[action.id]
    return binding ? !sameBinding(binding, action.defaultBinding) : true
  }).length

  const toggleShortcutGroup = (group: ShortcutGroupId) => {
    setRecordingId(null)
    setShortcutConflict(null)
    setExpandedShortcutGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const allShortcutGroupsExpanded = expandedShortcutGroups.size === SHORTCUT_GROUP_ORDER.length
  const toggleAllShortcutGroups = () => {
    setRecordingId(null)
    setShortcutConflict(null)
    setExpandedShortcutGroups(
      allShortcutGroupsExpanded ? new Set<ShortcutGroupId>() : new Set(SHORTCUT_GROUP_ORDER),
    )
  }

  const handleDownloadModel = async (name?: string) => {
    const modelName = name || selectedModel
    setSelectedModel(modelName)
    setDownloading(true)
    setDownloadProgress(0)
    const cleanup = window.api.onDownloadProgress((pct: number) => setDownloadProgress(pct))
    try {
      await window.api.downloadWhisperModel(modelName)
      await window.api.setWhisperModel(modelName)
      const status = await window.api.whisperStatus()
      setWhisperStatus(status)
      window.api.listWhisperModels().then(setWhisperModels)
    } catch (err: any) {
      showToast('下载失败: ' + (err?.message || String(err)), 'error')
    } finally {
      cleanup()
      setDownloading(false)
    }
  }

  const handleAISave = async () => {
    const err = await window.api.aiSetConfig({ baseUrl: aiBaseURL, model: aiModel, apiKey: aiKey })
    if (err) {
      showToast(err, 'error')
      return
    }
    setAiKey('')
    setAiCfg(await window.api.aiGetConfig())
    showToast('已保存')
  }

  const handleAITest = async () => {
    setAiTesting(true)
    setAiTestMsg(null)
    const err = await window.api.aiSetConfig({ baseUrl: aiBaseURL, model: aiModel, apiKey: aiKey })
    if (err) {
      setAiTesting(false)
      setAiTestMsg({ ok: false, message: err })
      return
    }
    setAiKey('')
    setAiCfg(await window.api.aiGetConfig())
    const r = await window.api.aiTest()
    setAiTestMsg(r)
    setAiTesting(false)
  }

  const handleClear = async () => {
    await window.api.dbClear()
    setShowConfirm(false)
    showToast('已清空全部数据')
  }

  return (
    <div className="max-w-2xl lg:max-w-3xl xl:max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">外观</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium">{dark ? '暗色模式' : '亮色模式'}</p>
              <p className="text-sm text-muted-foreground">切换应用亮暗主题</p>
            </div>
            <Button variant="outline" size="icon" onClick={toggle}>
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Keyboard className="h-5 w-5" /> 播放器快捷键
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-md">
              点击键位后按下新组合键；Backspace 清除绑定，Esc 取消录制。支持单键或 Shift / Alt
              组合，不支持 Cmd / Ctrl。快捷键仅在播放页生效。
            </p>
            <div className="flex items-center gap-2">
              {modifiedShortcutCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  已修改 {modifiedShortcutCount} 项
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={toggleAllShortcutGroups}>
                {allShortcutGroupsExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 mr-1" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />
                )}
                {allShortcutGroupsExpanded ? '全部收起' : '全部展开'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={modifiedShortcutCount === 0}
                onClick={handleResetAllShortcuts}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> 恢复默认
              </Button>
            </div>
          </div>

          {SHORTCUT_GROUP_ORDER.map((group) => {
            const actions = SHORTCUT_ACTIONS.filter((action) => action.group === group)
            if (actions.length === 0) return null
            const expanded = expandedShortcutGroups.has(group)
            const modified = actions.filter((action) => {
              const binding = shortcutBindings[action.id]
              return binding ? !sameBinding(binding, action.defaultBinding) : true
            }).length
            return (
              <div key={group} className="rounded-md border">
                <button
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => toggleShortcutGroup(group)}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {SHORTCUT_GROUP_LABELS[group]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {modified > 0 && <span className="text-primary">{modified} 项已修改 · </span>}
                    {actions.length} 项
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-1.5 px-2 pb-2">
                    {actions.map((action) => {
                      const binding = shortcutBindings[action.id]
                      const recording = recordingId === action.id
                      const isDefault = binding
                        ? sameBinding(binding, action.defaultBinding)
                        : false
                      const conflictId =
                        shortcutConflict?.actionId === action.id
                          ? shortcutConflict.conflictId
                          : null
                      const conflictLabel = conflictId
                        ? (SHORTCUT_ACTIONS.find((item) => item.id === conflictId)?.label ??
                          '其他动作')
                        : null
                      return (
                        <div key={action.id} className="rounded px-2 py-1 hover:bg-muted/40">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm">{action.label}</span>
                            <div className="flex items-center gap-1">
                              <Button
                                variant={
                                  recording ? (conflictId ? 'destructive' : 'default') : 'outline'
                                }
                                size="sm"
                                className={`min-w-[7rem] font-mono ${recording && !conflictId ? 'animate-pulse' : ''}`}
                                title="点击后按新键；Backspace 清除，Esc 取消"
                                onClick={() => {
                                  setShortcutConflict(null)
                                  setRecordingId(recording ? null : action.id)
                                }}
                              >
                                {recording
                                  ? '按下新键…'
                                  : binding
                                    ? formatBinding(binding)
                                    : '未设置'}
                              </Button>
                              {!isDefault && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="恢复默认键位"
                                  onClick={() => handleResetShortcut(action.id)}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {conflictLabel && (
                            <p className="text-xs text-destructive text-right mt-1">
                              与「{conflictLabel}」冲突，请换一个键位
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mic className="h-5 w-5" /> Whisper 语音模型
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {whisperModels.map((m) => {
            const active = whisperStatus?.model === m.file && m.downloaded
            const isDownloading = downloading && selectedModel === m.name
            return (
              <div
                key={m.name}
                className={`px-3 py-2 rounded text-sm ${active ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium capitalize">{m.name}</span>
                    <span className="text-muted-foreground">{m.size}</span>
                    {m.downloaded && (
                      <span className="text-xs text-green-600 dark:text-green-400">✓</span>
                    )}
                    {active && <span className="text-xs text-primary font-medium">使用中</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {isDownloading ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${downloadProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {downloadProgress}%
                        </span>
                      </div>
                    ) : m.downloaded ? (
                      <Button
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        onClick={() => {
                          window.api.setWhisperModel(m.name)
                          setSelectedModel(m.name)
                          window.api.whisperStatus().then(setWhisperStatus)
                        }}
                      >
                        {active ? '使用中' : '切换'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={downloading}
                        onClick={() => handleDownloadModel(m.name)}
                      >
                        <Download className="h-3 w-3 mr-1" /> 下载
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> AI 翻译
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            用于播放器选句翻译与句子详解。兼容 OpenAI 协议的接口都可以接入（DeepSeek / 通义 / Kimi /
            本地 Ollama）。
          </p>
          <div>
            <label className="text-sm font-medium">接口地址</label>
            <Input
              value={aiBaseURL}
              onChange={(e) => setAiBaseURL(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">模型</label>
            <Input
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="deepseek-chat"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">API Key</label>
            <Input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder={aiCfg?.hasKey ? '已配置，留空则不修改' : 'sk-...'}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={handleAISave}>保存</Button>
            <Button variant="outline" disabled={aiTesting} onClick={handleAITest}>
              {aiTesting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} 测试连接
            </Button>
            {aiTestMsg && (
              <span className={`text-xs ${aiTestMsg.ok ? 'text-green-600' : 'text-destructive'}`}>
                {aiTestMsg.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">数据备份</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium">导出生词库</p>
              <p className="text-sm text-muted-foreground">将全部生词数据导出为 JSON 文件</p>
            </div>
            <Button onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" /> 导出
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium">导出为 CSV（Anki 兼容）</p>
              <p className="text-sm text-muted-foreground">
                字段顺序：单词、释义、音标、例句、标签
              </p>
            </div>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium">导入生词库</p>
              <p className="text-sm text-muted-foreground">从 JSON 文件恢复生词数据，自动去重</p>
            </div>
            <Button variant="outline" onClick={handleImport}>
              <Upload className="h-4 w-4 mr-1" /> 导入
            </Button>
          </div>
          {importResult && (
            <p className="text-sm text-green-600 dark:text-green-400">{importResult}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">危险操作</CardTitle>
        </CardHeader>
        <CardContent>
          {!showConfirm ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-medium">清空全部数据</p>
                <p className="text-sm text-muted-foreground">删除所有生词和标签，此操作不可恢复</p>
              </div>
              <Button variant="destructive" onClick={() => setShowConfirm(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> 清空
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-destructive flex-wrap">
                <AlertTriangle className="h-5 w-5" />
                <p className="font-medium">确定要清空全部数据吗？此操作不可恢复！</p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowConfirm(false)}>
                  取消
                </Button>
                <Button variant="destructive" onClick={handleClear}>
                  确认清空
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Info className="h-5 w-5" /> 关于
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium">语练</p>
              <p className="text-sm text-muted-foreground">英语输入输出训练台</p>
            </div>
            <span className="text-sm font-mono text-muted-foreground">v{appVersion}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
