import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmDialog, showToast } from '@/components/feedback'
import type { BackupStatus, CacheStats } from '@/types/api'
import { SettingsGroup, SettingsRow } from './primitives'

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

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export default function SettingsData() {
  // --- 数据备份 ---
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backingUp, setBackingUp] = useState(false)

  // --- 缓存管理 ---
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [clearingCache, setClearingCache] = useState<string | null>(null)

  const [importResult, setImportResult] = useState<string | null>(null)

  const loadCacheStats = async () => {
    try {
      setCacheStats(await window.api.cacheStats())
    } catch (err) {
      console.error('[cache] load stats failed', err)
    }
  }

  useEffect(() => {
    window.api.getBackupStatus().then(setBackupStatus)
    window.api
      .cacheStats()
      .then(setCacheStats)
      .catch((err: unknown) => console.error('[cache] load stats failed', err))
  }, [])

  const handleBackupNow = async () => {
    setBackingUp(true)
    try {
      const r = await window.api.backupNow()
      if (r?.ok) {
        if (r.status) setBackupStatus(r.status)
        showToast('备份完成')
      } else {
        showToast('备份失败: ' + (r?.error || '未知错误'), 'error')
      }
    } catch (err) {
      showToast('备份失败: ' + err, 'error')
    } finally {
      setBackingUp(false)
    }
  }

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

  const handleClearCache = async (kind: string, label: string) => {
    const ok = await confirmDialog({
      title: `清理${label}？`,
      description:
        kind === 'podcasts'
          ? '已下载的音频文件会从磁盘删除，并同时移出媒体库。'
          : '对应缓存文件会被删除，后续需要时会重新生成。',
      confirmText: '清理',
      destructive: true,
    })
    if (!ok) return
    setClearingCache(kind)
    try {
      const res = await window.api.clearCache(kind)
      if (res?.ok) {
        showToast(`已清理${label}，释放 ${formatBytes(res.freed)}`)
      } else {
        showToast('清理失败: ' + (res?.error || '未知错误'), 'error')
      }
      await loadCacheStats()
    } finally {
      setClearingCache(null)
    }
  }

  const handleClearAllCaches = async () => {
    const ok = await confirmDialog({
      title: '清理全部缓存？',
      description:
        '缩略图、波形、转码文件、字幕缓存、已下载音频等都会被删除；生词、收藏与播放记录不受影响。',
      confirmText: '全部清理',
      destructive: true,
    })
    if (!ok) return
    setClearingCache('all')
    try {
      const res = await window.api.clearAllCaches()
      if (res?.ok) {
        showToast(`已清理全部缓存，释放 ${formatBytes(res.freed)}`)
      } else {
        showToast('清理失败: ' + (res?.error || '未知错误'), 'error')
      }
      await loadCacheStats()
    } finally {
      setClearingCache(null)
    }
  }

  const handleClear = async () => {
    const ok = await confirmDialog({
      title: '清空全部数据？',
      description: '将删除所有生词和标签，此操作不可恢复。',
      confirmText: '确认清空',
      destructive: true,
    })
    if (!ok) return
    await window.api.dbClear()
    showToast('已清空全部数据')
  }

  return (
    <>
      <SettingsGroup
        title="缓存"
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              共 {formatBytes(cacheStats?.total ?? 0)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!cacheStats || cacheStats.total === 0 || clearingCache !== null}
              onClick={handleClearAllCaches}
            >
              {clearingCache === 'all' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              全部清理
            </Button>
          </div>
        }
      >
        {(cacheStats?.entries ?? []).map((entry) => (
          <SettingsRow
            key={entry.kind}
            title={entry.label}
            description={`${entry.files} 个文件 · ${formatBytes(entry.size)}`}
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={entry.files === 0 || clearingCache !== null}
              onClick={() => handleClearCache(entry.kind, entry.label)}
            >
              清理
            </Button>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="数据备份">
        <SettingsRow
          title="自动备份"
          description={
            <>
              启动时若距上次备份超过 24 小时会自动备份，保留最近 7 份
              {backupStatus?.lastBackup
                ? ` · 最近备份：${new Date(backupStatus.lastBackup).toLocaleString()}`
                : ' · 尚未备份'}
              {backupStatus?.dir && (
                <span className="mt-1 block break-all font-mono text-[11px]">
                  {backupStatus.dir}
                </span>
              )}
            </>
          }
        >
          <Button variant="outline" size="sm" disabled={backingUp} onClick={handleBackupNow}>
            {backingUp ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <DatabaseBackup className="h-4 w-4 mr-1" />
            )}
            立即备份
          </Button>
        </SettingsRow>
        <SettingsRow title="导出生词库" description="将全部生词数据导出为 JSON 文件">
          <Button size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> 导出
          </Button>
        </SettingsRow>
        <SettingsRow
          title="导出为 CSV"
          description="字段顺序：单词、释义、音标、例句、标签，可直接在 Anki 中导入"
        >
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </SettingsRow>
        <SettingsRow
          title="导入生词库"
          description={
            importResult ? (
              <span className="text-green-600 dark:text-green-400">{importResult}</span>
            ) : (
              '从 JSON 文件恢复生词数据，自动去重'
            )
          }
        >
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="h-4 w-4 mr-1" /> 导入
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="危险操作" tone="danger">
        <SettingsRow title="清空全部数据" description="删除所有生词和标签，此操作不可恢复">
          <Button variant="destructive" size="sm" onClick={handleClear}>
            <Trash2 className="h-4 w-4 mr-1" /> 清空
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
