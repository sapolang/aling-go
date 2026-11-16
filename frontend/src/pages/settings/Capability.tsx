import { useEffect, useState } from 'react'
import type { ComponentProps } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { showToast } from '@/components/feedback'
import type { WhisperDownloadProgress } from '@/types/api'
import { SettingsGroup, SettingsRow } from './primitives'

function Field({
  id,
  label,
  ...inputProps
}: {
  id: string
  label: string
} & ComponentProps<typeof Input>) {
  return (
    <div className="py-3 first:pt-4">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} className="mt-1.5" {...inputProps} />
    </div>
  )
}

export default function SettingsCapability() {
  const [whisperStatus, setWhisperStatus] = useState<{
    loaded: boolean
    loading: boolean
    model: string
  } | null>(null)
  const [whisperModels, setWhisperModels] = useState<
    { name: string; file: string; size: string; downloaded: boolean }[]
  >([])
  const [selectedModel, setSelectedModel] = useState('tiny')
  const [transcribeLang, setTranscribeLang] = useState('en')
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  // --- AI 翻译配置 ---
  const [aiBaseURL, setAiBaseURL] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestMsg, setAiTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    window.api.whisperStatus().then((s: any) => {
      setWhisperStatus(s)
      const current = s.model.replace(/\.bin$/, '').replace('ggml-', '')
      setSelectedModel(current)
    })
    window.api.listWhisperModels().then(setWhisperModels)
    window.api.getWhisperLang().then(setTranscribeLang)

    window.api.aiGetConfig().then((cfg: any) => {
      setAiBaseURL(cfg.baseUrl)
      setAiModel(cfg.model)
      setAiKey(cfg.apiKeyMask || '')
    })

    let resumeCleanup: (() => void) | null = null
    window.api.getDownloadProgress().then((d: WhisperDownloadProgress | null) => {
      if (d) {
        setSelectedModel(d.model)
        setDownloading(true)
        setDownloadProgress(d.progress)
        resumeCleanup = window.api.onDownloadProgress((pct: number) => setDownloadProgress(pct))
      }
    })

    return () => {
      resumeCleanup?.()
    }
  }, [])

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

  // 输入框里的掩码原样提交时视为不修改，由后端保留原 Key
  const aiKeyInput = () => (aiKey.includes('***') ? '' : aiKey.trim())

  const handleAISave = async () => {
    const res = await window.api.aiSetConfig({
      baseUrl: aiBaseURL,
      model: aiModel,
      apiKey: aiKeyInput(),
    })
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    const cfg: any = await window.api.aiGetConfig()
    setAiKey(cfg.apiKeyMask || '')
    showToast('已保存')
  }

  const handleAITest = async () => {
    setAiTesting(true)
    setAiTestMsg(null)
    const res = await window.api.aiSetConfig({
      baseUrl: aiBaseURL,
      model: aiModel,
      apiKey: aiKeyInput(),
    })
    if (!res.ok) {
      setAiTesting(false)
      setAiTestMsg({ ok: false, message: res.error })
      return
    }
    const cfg: any = await window.api.aiGetConfig()
    setAiKey(cfg.apiKeyMask || '')
    const r = await window.api.aiTest()
    setAiTestMsg(r)
    setAiTesting(false)
  }

  return (
    <>
      <SettingsGroup title="语音转录" description="Whisper.cpp 本地模型">
        <SettingsRow title="转录语言" description="默认使用 English，可按音频语言调整">
          <Select
            value={transcribeLang}
            onValueChange={(value) => {
              setTranscribeLang(value)
              window.api.setWhisperLang(value)
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动检测</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
              <SelectItem value="ko">한국어</SelectItem>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="es">Español</SelectItem>
              <SelectItem value="ru">Русский</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {whisperModels.map((m) => {
          const active = whisperStatus?.model === m.file && m.downloaded
          const isDownloading = downloading && selectedModel === m.name
          return (
            <div key={m.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-medium capitalize">{m.name}</span>
                <span className="text-xs text-muted-foreground">{m.size}</span>
                {m.downloaded && (
                  <span className="text-xs text-green-600 dark:text-green-400">已下载</span>
                )}
                {active && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    使用中
                  </span>
                )}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {isDownloading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {downloadProgress}%
                    </span>
                  </div>
                ) : m.downloaded ? (
                  <Button
                    size="sm"
                    variant={active ? 'secondary' : 'outline'}
                    disabled={active}
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
          )
        })}
      </SettingsGroup>

      <SettingsGroup title="AI 翻译" description="兼容 OpenAI 协议">
        <div>
          <p className="pt-4 text-xs leading-relaxed text-muted-foreground">
            用于播放器选句翻译与句子详解。DeepSeek / 通义 / Kimi / 本地 Ollama 等兼容 OpenAI
            协议的接口都可以接入。
          </p>
          <Field
            id="ai-base-url"
            label="接口地址"
            value={aiBaseURL}
            onChange={(e) => setAiBaseURL(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
          <Field
            id="ai-model"
            label="模型"
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            placeholder="deepseek-chat"
          />
          <Field
            id="ai-api-key"
            label="API Key"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder="sk-..."
          />
          <div className="flex flex-wrap items-center gap-2 pb-4 pt-1">
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
        </div>
      </SettingsGroup>
    </>
  )
}
