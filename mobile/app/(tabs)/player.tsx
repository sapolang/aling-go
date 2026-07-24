import { useState, useCallback, useEffect, useRef } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native'
import { useVideoPlayer, VideoView, VideoThumbnail } from 'expo-video'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { usePlayerStore } from '../../src/stores/playerStore'
import SubtitlePanel from '../../src/components/SubtitlePanel'
import { parseSRT } from '../../src/utils/subtitle'
import { resolveUri } from '../../src/utils/uri'
import { transcribeAudio } from '../../src/services/transcription'
import { getFirstModelPath } from '../../src/services/modelDownload'
import { getCachedSubtitles, saveCachedSubtitles } from '../../src/db/subtitleCache'

export default function PlayerPage() {
  const insets = useSafeAreaInsets()
  const {
    fileUri,
    fileName,
    subtitles,
    currentSubtitleIndex,
    isTranscribing,
    whisperProgress,
    setFile,
    setSubtitles,
    setCurrentSubtitleIndex,
    setTranscribing,
    setWhisperProgress,
  } = usePlayerStore()

  const player = useVideoPlayer(fileUri ?? null, (p) => {
    p.timeUpdateEventInterval = 0.25
  })
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null)

  useEffect(() => {
    return () => {
      try { player.release() } catch {}
    }
  }, [player])

  useEffect(() => {
    if (!fileUri) return
    player.timeUpdateEventInterval = 0.25
    player.generateThumbnailsAsync(5)
      .then((thumb: VideoThumbnail[]) => {
        if (thumb && thumb[0]) setThumbnail(thumb[0])
      })
      .catch(() => {})
    getCachedSubtitles(fileUri).then((cached) => {
      if (cached) {
        console.log('[subtitle] loaded from cache:', JSON.stringify(cached.slice(0, 5)))
        setSubtitles(cached)
      }
    })
  }, [fileUri])

  const subtitlesRef = useRef(subtitles)
  subtitlesRef.current = subtitles

  const currentSubtitleIndexRef = useRef(-1)

  useEffect(() => {
    if (!fileUri || subtitles.length === 0) return
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
    if (!fileUri) return
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

  const openFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['video/*', 'audio/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      const resolvedUri = await resolveUri(asset.uri)
      setFile(resolvedUri, asset.name)
    } catch (error) {
      Alert.alert('打开失败', String(error))
    }
  }, [setFile])

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
    try {
      const modelPath = await getFirstModelPath()
      if (!modelPath) {
        Alert.alert('请先下载模型', '前往设置页下载 Whisper 模型')
        return
      }
      setTranscribing(true)
      const subs = await transcribeAudio(fileUri, modelPath, 'auto', (p) => {
        setWhisperProgress(p.progress)
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
        <Ionicons name="cloud-upload-outline" size={64} color="#d1d5db" />
        <TouchableOpacity style={styles.openButton} onPress={openFile}>
          <Text style={styles.openButtonText}>选择视频/音频文件</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {fileName && <Text style={[styles.fileName, { paddingHorizontal: 16 }]}>{fileName}</Text>}

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
          <Text style={styles.progressText}>转录中 {Math.round(whisperProgress)}%</Text>
        </View>
      )}

      <SubtitlePanel
        subtitles={subtitles}
        currentIndex={currentSubtitleIndex}
        onWordPress={(word) => {
          Alert.alert('添加到生词库', `"${word}"（后续实现）`)
        }}
      />

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolbarButton} onPress={openFile}>
          <Ionicons name="folder-open" size={20} color="#3b82f6" />
          <Text style={styles.toolbarText}>打开</Text>
        </TouchableOpacity>
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
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  empty: { justifyContent: 'center', alignItems: 'center', gap: 24 },
  openButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  openButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fileName: { fontSize: 15, fontWeight: '600', color: '#111827', paddingVertical: 8 },
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
