import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/themeStore'
import { Sun, Moon, Download, Upload, Trash2, AlertTriangle, Mic, Loader2 } from 'lucide-react'

export default function SettingsPage() {
  const { dark, toggle } = useThemeStore()
  const [importResult, setImportResult] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [whisperStatus, setWhisperStatus] = useState<{ loaded: boolean; loading: boolean; model: string } | null>(null)
  const [whisperModels, setWhisperModels] = useState<{ name: string; file: string; size: string; downloaded: boolean }[]>([])
  const [selectedModel, setSelectedModel] = useState('base')
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const handleExport = async () => {
    try {
      const jsonStr = await window.api.dbExport()
      const filePath = await window.api.saveFile(`novaling-backup-${new Date().toISOString().split('T')[0]}.json`)
      if (filePath) {
        await window.api.writeTextFile(filePath, jsonStr)
        alert('导出成功！')
      }
    } catch (err) {
      alert('导出失败: ' + err)
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
      alert('导入失败: ' + err)
    }
  }

  useEffect(() => {
    window.api.whisperStatus().then((s: any) => {
      setWhisperStatus(s)
      const current = s.model.replace(/\.bin$/, '').replace('ggml-', '')
      setSelectedModel(current)
    })
    window.api.listWhisperModels().then(setWhisperModels)

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

    return () => { resumeCleanup?.() }
  }, [])

  const handleDownloadModel = async (name?: string) => {
    const modelName = name || selectedModel
    setSelectedModel(modelName)
    setDownloading(true)
    setDownloadProgress(0)
    const cleanup = window.api.onDownloadProgress((pct: number) => setDownloadProgress(pct))
    try {
      await window.api.downloadWhisperModel('https://hf-mirror.com', modelName)
      await window.api.setWhisperModel(modelName)
      const status = await window.api.whisperStatus()
      setWhisperStatus(status)
      window.api.listWhisperModels().then(setWhisperModels)
    } catch (err: any) {
      alert('下载失败: ' + (err?.message || String(err)))
    } finally {
      cleanup()
      setDownloading(false)
    }
  }

  const handleClear = async () => {
    await window.api.dbClear()
    setShowConfirm(false)
    alert('已清空全部数据')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">外观</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
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
          <CardTitle className="text-lg flex items-center gap-2"><Mic className="h-5 w-5" /> Whisper 语音模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
            {whisperModels.map((m) => {
              const active = whisperStatus?.model === m.file && m.downloaded
              const isDownloading = downloading && selectedModel === m.name
              return (
                <div key={m.name} className={`px-3 py-2 rounded text-sm ${active ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{m.name}</span>
                      <span className="text-muted-foreground">{m.size}</span>
                      {m.downloaded && <span className="text-xs text-green-600 dark:text-green-400">✓</span>}
                      {active && <span className="text-xs text-primary font-medium">使用中</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      {isDownloading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${downloadProgress}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums">{downloadProgress}%</span>
                        </div>
                      ) : m.downloaded ? (
                        <Button size="sm" variant={active ? 'default' : 'outline'} onClick={() => { window.api.setWhisperModel(m.name); setSelectedModel(m.name); window.api.whisperStatus().then(setWhisperStatus) }}>
                          {active ? '使用中' : '切换'}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={downloading} onClick={() => handleDownloadModel(m.name)}>
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
          <CardTitle className="text-lg">数据备份</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">导出生词库</p>
              <p className="text-sm text-muted-foreground">将全部生词数据导出为 JSON 文件</p>
            </div>
            <Button onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" /> 导出
            </Button>
          </div>
          <div className="flex items-center justify-between">
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
            <div className="flex items-center justify-between">
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
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <p className="font-medium">确定要清空全部数据吗？此操作不可恢复！</p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowConfirm(false)}>取消</Button>
                <Button variant="destructive" onClick={handleClear}>确认清空</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
