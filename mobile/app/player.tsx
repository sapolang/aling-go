import { useState, useCallback, useEffect, useRef } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native'
import { VideoView, VideoThumbnail } from 'expo-video'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { usePlayerStore } from '../src/stores/playerStore'
import SubtitlePanel from '../src/components/SubtitlePanel'
import TranscribeSettingsModal from '../src/components/TranscribeSettingsModal'
import { parseSRT } from '../src/utils/subtitle'
import { getFirstModelPath } from '../src/services/modelDownload'
import { getCachedSubtitles, saveCachedSubtitles } from '../src/db/subtitleCache'

export default function PlayerPage() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const {
    fileUri,
    fileName,
    player,
    subtitles,
    currentSubtitleIndex,
    isTranscribing,
    whisperProgress,
    chunkIndex,
    chunkTotal,
    setSubtitles,
    appendSubtitles,
    setCurrentSubtitleIndex,
    setTranscribing,
    setWhisperProgress,
    setChunkProgress,
  } = usePlayerStore()

  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null)
  const [showTranscribeSettings, setShowTranscribeSettings] = useState(false)

  useEffect(() => {
    if (!fileUri || !player) return
    player.play()
    player.generateThumbnailsAsync(5)
      .then((thumb: VideoThumbnail[]) => {
        if (thumb && thumb[0]) setThumbnail(thumb[0])
      })
      .catch(() => {})
    getCachedSubtitles(fileUri).then((cached) => {
      if (cached) {
        setSubtitles(cached)
      }
    })
  }, [fileUri])

  const subtitlesRef = useRef(subtitles)
  subtitlesRef.current = subtitles

  const currentSubtitleIndexRef = useRef(-1)

  useEffect(() => {
    if (!fileUri || !player || subtitles.length === 0) return
    currentSubtitleIndexRef.current = -1
    const id = setInterval(() => {
      const subs = subtitlesRef.current
      const t = player.currentTime
      if (!t || subs.length === 0) return

      const idx = subs.findIndex(
        (s) => t >= s.startTime - 0.08 && t <= s.endTime
      )
      if (idx !== -1) {
        setCurrentSubtitleIndex(idx)
        currentSubtitleIndexRef.current = idx
      }
    }, 100)
    return () => clearInterval(id)
  }, [fileUri, subtitles])

  useEffect(() => {
    if (!fileUri || !player) return
    const id = setInterval(() => {
      const subs = subtitlesRef.current
      const t = player.currentTime
      if (!t) return
      const idx = subs.findIndex(
        (s) => t >= s.startTime - 0.08 && t <= s.endTime
      )
      console.log(`[sync] t=${t.toFixed(3)} idx=${idx} subs=${subs.length}`)
    }, 1000)
    return () => clearInterval(id)
  }, [fileUri])

  const importSRT = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/x-subrip'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const response = await fetch(result.assets[0].uri)
      const text = await response.text()
      const parsed = parseSRT(text)
      console.log('[subtitle] imported SRT:', JSON.stringify(parsed.slice(0, 3)))
      console.log(`[subtitle] total: ${parsed.length}, range: ${parsed[0]?.startTime ?? 0}-${parsed[parsed.length - 1]?.endTime ?? 0}s`)
      setSubtitles(parsed)
    } catch (error) {
      Alert.alert('SRT 导入失败', String(error))
    }
  }, [setSubtitles])

  const handleTranscribe = useCallback(async () => {
    if (!fileUri) return
    const modelPath = await getFirstModelPath()
    if (!modelPath) {
      Alert.alert('请先下载模型', '前往设置页下载 Whisper 模型')
      return
    }
    setShowTranscribeSettings(true)
  }, [fileUri])

  const handleTranscribeStart = useCallback(async (sourceLang: string) => {
    if (!fileUri) return
    setShowTranscribeSettings(false)
    try {
      const modelPath = await getFirstModelPath()
      if (!modelPath) {
        Alert.alert('请先下载模型', '前往设置页下载 Whisper 模型')
        return
      }
      setTranscribing(true)
      const { transcribeAudioStreaming } = await import('../src/services/transcription')
      const subs = await transcribeAudioStreaming(fileUri, modelPath, {
        language: sourceLang,
        onProgress: (p) => setWhisperProgress(p.progress),
        onChunkReady: (chunkSubs, idx, total) => {
          appendSubtitles(chunkSubs)
          setChunkProgress(idx, total)
        },
      })
      console.log('[subtitle] transcription result:', JSON.stringify(subs.slice(0, 3)))
      console.log(`[subtitle] total: ${subs.length}, range: ${subs[0]?.startTime ?? 0}-${subs[subs.length - 1]?.endTime ?? 0}s`)
      setSubtitles(subs)
      saveCachedSubtitles(fileUri, subs)
    } catch (error) {
      Alert.alert('转录失败', String(error))
    } finally {
      setTranscribing(false)
    }
  }, [fileUri, setTranscribing, setWhisperProgress, setSubtitles])

  if (!fileUri) {
    return (
      <View style={[styles.container, styles.empty, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
        <Text style={{ color: '#9ca3af' }}>请从首页选择文件</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>返回首页</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{fileName}</Text>
        <TouchableOpacity onPress={() => { usePlayerStore.getState().reset(); router.back() }} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color="#111827" />
        </TouchableOpacity>
      </View>

      <View style={styles.videoContainer}>
        {thumbnail && (
          <Image
            source={thumbnail}
            style={styles.video}
            contentFit="contain"
          />
        )}
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
        />
      </View>

      {isTranscribing && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${whisperProgress}%` }]} />
          <Text style={styles.progressText}>
            转录中 {chunkTotal > 0 ? `第 ${chunkIndex}/${chunkTotal} 块` : `${Math.round(whisperProgress)}%`}
          </Text>
        </View>
      )}

      <SubtitlePanel
        subtitles={subtitles}
        currentIndex={currentSubtitleIndex}
        onPlayFrom={(time) => {
          if (!player) return
          player.currentTime = time
          player.play()
        }}
        onWordPress={(word) => {
          Alert.alert('添加到生词库', `"${word}"（后续实现）`)
        }}
      />

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolbarButton} onPress={importSRT}>
          <Ionicons name="document-text" size={20} color="#3b82f6" />
          <Text style={styles.toolbarText}>导入SRT</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolbarButton, isTranscribing && { opacity: 0.5 }]}
          onPress={handleTranscribe}
          disabled={isTranscribing}
        >
          <Ionicons name="mic" size={20} color="#3b82f6" />
          <Text style={styles.toolbarText}>转录</Text>
        </TouchableOpacity>
      </View>

      <TranscribeSettingsModal
        visible={showTranscribeSettings}
        onStart={handleTranscribeStart}
        onDismiss={() => setShowTranscribeSettings(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  empty: { justifyContent: 'center', alignItems: 'center', gap: 24 },
  backButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    height: 44,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoContainer: { position: 'relative', width: '100%', aspectRatio: 16 / 9 },
  video: { width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 },
  progressBar: {
    height: 4,
    backgroundColor: '#e5e7eb',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
  },
  progressText: {
    position: 'absolute',
    top: 8,
    right: 12,
    fontSize: 12,
    color: '#6b7280',
  },
  toolbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolbarText: { color: '#3b82f6', fontSize: 13 },
})
