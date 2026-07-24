import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native'
import { Button, ProgressBar, List, Divider } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  WHISPER_MODELS,
  downloadModel,
  deleteModel,
  listDownloadedModels,
} from '../../src/services/modelDownload'

export default function SettingsPage() {
  const insets = useSafeAreaInsets()
  const [downloaded, setDownloaded] = useState<string[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const models = await listDownloadedModels()
      setDownloaded(models)
    } catch (e) {
      console.error('Failed to list models:', e)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDownload = useCallback(async (name: string) => {
    try {
      setDownloading(name)
      setDownloadProgress(0)
      await downloadModel(name, (p) => setDownloadProgress(p))
      await refresh()
    } catch (error) {
      Alert.alert('下载失败', String(error))
    } finally {
      setDownloading(null)
      setDownloadProgress(0)
    }
  }, [refresh])

  const handleDelete = useCallback(async (name: string) => {
    try {
      await deleteModel(name)
      await refresh()
    } catch (error) {
      Alert.alert('删除失败', String(error))
    }
  }, [refresh])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        data={WHISPER_MODELS}
        keyExtractor={(item) => item.name}
        ListHeaderComponent={
          <List.Section>
            <List.Subheader>Whisper 模型管理</List.Subheader>
          </List.Section>
        }
        renderItem={({ item }) => {
          const isDownloaded = downloaded.includes(item.name)
          const isDownloading = downloading === item.name
          return (
            <>
              <List.Item
                title={item.name}
                description={`${item.size} · ${isDownloaded ? '已下载' : '未下载'}`}
                left={(props) => <List.Icon {...props} icon="microphone" />}
                right={() => (
                  <View style={styles.actionRow}>
                    {isDownloading ? (
                      <View style={styles.progressContainer}>
                        <ProgressBar
                          progress={downloadProgress / 100}
                          style={styles.progress}
                        />
                        <Text style={styles.progressLabel}>{downloadProgress}%</Text>
                      </View>
                    ) : isDownloaded ? (
                      <Button
                        mode="text"
                        textColor="#ef4444"
                        onPress={() => handleDelete(item.name)}
                      >
                        删除
                      </Button>
                    ) : (
                      <Button
                        mode="contained"
                        compact
                        onPress={() => handleDownload(item.name)}
                      >
                        下载
                      </Button>
                    )}
                  </View>
                )}
              />
              <Divider />
            </>
          )
        }}
        ListFooterComponent={
          <List.Section>
            <List.Subheader>关于</List.Subheader>
            <List.Item title="版本" description="1.0.0" />
          </List.Section>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  actionRow: { justifyContent: 'center' },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progress: { width: 80, height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 12, color: '#6b7280' },
})
