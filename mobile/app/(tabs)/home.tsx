import { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActionSheetIOS,
  Platform,
  RefreshControl,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePlayerStore } from '../../src/stores/playerStore'
import VideoThumbView from '../../src/components/VideoThumbView'
import {
  getAllFiles,
  getFolders,
  deleteFile,
  renameFile,
  createFolder,
  deleteFolder,
  renameFolder,
  updateFileFolder,
  FileRow,
  FolderRow,
  SortField,
} from '../../src/db/fileStore'
import { detectFileType, addFile } from '../../src/db/fileStore'
import { copyToCache } from '../../src/utils/uri'

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

type ViewMode = 'grid' | 'list'

export default function HomePage() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const setFile = usePlayerStore((s) => s.setFile)
  const activeFileUri = usePlayerStore((s) => s.fileUri)
  const activeFileName = usePlayerStore((s) => s.fileName)
  const isPlaying = usePlayerStore((s) => s.playing)
  const player = usePlayerStore((s) => s.player)
  const resetPlayer = usePlayerStore((s) => s.reset)
  const [files, setFiles] = useState<FileRow[]>(() => getAllFiles())
  const [folders, setFolders] = useState<FolderRow[]>(() => getFolders())
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortField>('created_at')
  const [activeFolder, setActiveFolder] = useState<number | null>(null)

  const refresh = useCallback(() => {
    setRefreshing(true)
    setFiles(getAllFiles(sort))
    setFolders(getFolders())
    setRefreshing(false)
  }, [sort])

  const { videos, audios } = useMemo(() => {
    const v = activeFolder
      ? files.filter((f) => f.type === 'video' && f.folder_id === activeFolder)
      : files.filter((f) => f.type === 'video')
    const a = activeFolder
      ? files.filter((f) => f.type === 'audio' && f.folder_id === activeFolder)
      : files.filter((f) => f.type === 'audio')
    return { videos: v, audios: a }
  }, [files, activeFolder])

  const videoRows = useMemo(() => chunk(videos, 2), [videos])
  const audioRows = useMemo(() => chunk(audios, 2), [audios])

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['video/*', 'audio/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      const cachedUri = await copyToCache(asset.uri)
      const type = detectFileType(asset.name)
      addFile(cachedUri, asset.name, type, cachedUri)
      refresh()
    } catch (error) {
      Alert.alert('导入失败', String(error))
    }
  }, [refresh])

  const handleCreateFolder = useCallback(() => {
    const doCreate = (name: string) => {
      if (name.trim()) {
        createFolder(name.trim())
        refresh()
      }
    }
    if (Platform.OS === 'ios') {
      Alert.prompt('新建文件夹', '输入文件夹名称', (name) => doCreate(name), 'plain-text', '')
    } else {
      Alert.alert('新建文件夹', '输入文件夹名称', [
        { text: '取消', style: 'cancel' },
        { text: '确定', onPress: () => {} },
      ])
    }
  }, [refresh])

  const handleSort = useCallback(() => {
    const labels = ['按名称', '按大小', '按时间']
    const fields: SortField[] = ['name', 'file_size', 'created_at']
    const onPress = (idx: number) => {
      if (idx >= 3) return
      setSort(fields[idx])
      setFiles(getAllFiles(fields[idx]))
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...labels, '取消'], cancelButtonIndex: 3 },
        onPress
      )
    } else {
      Alert.alert('排序方式', undefined, [
        { text: labels[0], onPress: () => onPress(0) },
        { text: labels[1], onPress: () => onPress(1) },
        { text: labels[2], onPress: () => onPress(2) },
        { text: '取消', style: 'cancel' },
      ])
    }
  }, [])

  const handlePress = useCallback((item: FileRow) => {
    if (editing) return
    setFile(item.uri, item.name)
    router.push('/player')
  }, [editing, setFile, router])

  const handleDelete = useCallback((item: FileRow) => {
    Alert.alert('删除', `删除「${item.name}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { deleteFile(item.id); refresh() }},
    ])
  }, [refresh])

  const handleDeleteFolder = useCallback((folder: FolderRow) => {
    Alert.alert('删除文件夹', `删除「${folder.name}」？文件夹内的文件将移出。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { deleteFolder(folder.id); refresh() }},
    ])
  }, [refresh])

  const handleLongPress = useCallback((item: FileRow) => {
    if (editing) return
    const folderActs = folders.map((f) => ({
      label: `移动到「${f.name}」`,
      action: () => { updateFileFolder(item.id, f.id); refresh() },
    }))
    const actions = [
      { label: '重命名', action: () => {
        const doRename = (name: string) => {
          if (name.trim()) { renameFile(item.id, name.trim()); refresh() }
        }
        if (Platform.OS === 'ios') {
          Alert.prompt('重命名', '输入新名称', (name) => doRename(name), 'plain-text', item.name.replace(/\.[^.]+$/, ''))
        }
      }},
      ...folderActs,
    ]
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...actions.map(a => a.label), '取消'], cancelButtonIndex: actions.length, title: item.name },
        (idx) => { if (idx < actions.length) actions[idx].action() }
      )
    }
  }, [editing, folders, refresh])

  const renderGridItem = (item: FileRow) => (
    <TouchableOpacity
      key={item.id}
      style={styles.card}
      onPress={() => handlePress(item)}
      onLongPress={() => handleLongPress(item)}
      activeOpacity={0.7}
    >
      {editing && (
        <TouchableOpacity style={styles.deleteBadge} onPress={() => handleDelete(item)}>
          <Ionicons name="close-circle" size={20} color="#ef4444" />
        </TouchableOpacity>
      )}
      {item.type === 'video' ? (
        <View style={styles.cardMedia}>
          <VideoThumbView uri={item.thumbnail || item.uri} style={styles.cardImg} />
        </View>
      ) : (
        <View style={[styles.cardMedia, styles.cardAudio]}>
          <Ionicons name="musical-note" size={28} color="#3b82f6" />
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
    </TouchableOpacity>
  )

  const renderListItem = (item: FileRow) => (
    <TouchableOpacity
      key={item.id}
      style={styles.listItem}
      onPress={() => handlePress(item)}
      onLongPress={() => handleLongPress(item)}
    >
      {editing && (
        <TouchableOpacity onPress={() => handleDelete(item)} style={{ marginRight: 6 }}>
          <Ionicons name="close-circle" size={18} color="#ef4444" />
        </TouchableOpacity>
      )}
      <Ionicons name={item.type === 'video' ? 'videocam' : 'musical-note'} size={16} color="#6b7280" style={{ marginRight: 8 }} />
      <Text style={styles.listTitle} numberOfLines={1}>{item.name}</Text>
      <Ionicons name="chevron-forward" size={14} color="#d1d5db" style={{ marginLeft: 'auto' }} />
    </TouchableOpacity>
  )

  const renderFolderItem = (folder: FolderRow) => {
    const count = files.filter(f => f.folder_id === folder.id).length
    const isActive = activeFolder === folder.id
    return (
      <TouchableOpacity
        key={folder.id}
        style={[styles.folderCard, isActive && styles.folderCardActive]}
        onPress={() => setActiveFolder(isActive ? null : folder.id)}
        onLongPress={() => editing && handleDeleteFolder(folder)}
        activeOpacity={0.7}
      >
        {editing && (
          <TouchableOpacity style={styles.folderDelete} onPress={() => handleDeleteFolder(folder)}>
            <Ionicons name="close-circle" size={18} color="#ef4444" />
          </TouchableOpacity>
        )}
        <View style={styles.folderIconWrap}>
          <Ionicons name="folder" size={24} color="#f59e0b" />
        </View>
        <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
        <Text style={styles.folderCount}>{count} 个文件</Text>
      </TouchableOpacity>
    )
  }

  const renderSection = (icon: string, iconColor: string, title: string, count: number, items: FileRow[]) => {
    if (items.length === 0) return null
    return (
      <View style={{ marginTop: 4 }}>
        <View style={styles.sectionHeader}>
          <Ionicons name={icon as any} size={15} color={iconColor} />
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionCount}>({count})</Text>
          {activeFolder && (
            <TouchableOpacity onPress={() => setActiveFolder(null)} style={{ marginLeft: 'auto' }}>
              <Text style={{ fontSize: 12, color: '#3b82f6' }}>全部</Text>
            </TouchableOpacity>
          )}
        </View>
        {viewMode === 'grid' ? (
          chunk(items, 2).map((row, ri) => (
            <View key={ri} style={styles.gridRow}>{row.map(renderGridItem)}</View>
          ))
        ) : (
          <View style={styles.listBox}>
            {items.map((f) => renderListItem(f))}
          </View>
        )}
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Text style={styles.appName}>AlinGo</Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={handleImport} style={styles.actionBtn}>
            <Ionicons name="add" size={20} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditing(v => !v)} style={[styles.actionBtn, editing && styles.actionOn]}>
            <Ionicons name="create-outline" size={18} color={editing ? '#fff' : '#3b82f6'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCreateFolder} style={styles.actionBtn}>
            <Ionicons name="folder-open-outline" size={18} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')} style={styles.actionBtn}>
            <Ionicons name={viewMode === 'grid' ? 'list-outline' : 'grid-outline'} size={18} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSort} style={styles.actionBtn}>
            <Ionicons name="swap-vertical-outline" size={18} color="#3b82f6" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.body}
      >
        {folders.length > 0 && (
          <View>
            <View style={styles.sectionHeader}>
              <Ionicons name="folder" size={15} color="#f59e0b" />
              <Text style={styles.sectionTitle}>文件夹</Text>
              <Text style={styles.sectionCount}>({folders.length})</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderScroll}>
              {folders.map(renderFolderItem)}
            </ScrollView>
          </View>
        )}

        {renderSection('videocam', '#3b82f6', '视频', videos.length, videos)}
        {renderSection('musical-note', '#6b7280', '音频', audios.length, audios)}

        {files.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-upload-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>导入音频或视频开始学习</Text>
          </View>
        )}
      </ScrollView>

      {activeFileUri && (
        <View style={styles.miniPlayer}>
          <TouchableOpacity onPress={() => player?.playing ? player.pause() : player?.play()}>
            <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={28} color="#3b82f6" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniPlayerTitleWrap} activeOpacity={0.7} onPress={() => router.push('/player')}>
            <Text style={styles.miniPlayerTitle} numberOfLines={1}>{activeFileName}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => resetPlayer()}>
            <Ionicons name="close" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  appName: { fontSize: 18, fontWeight: '700', color: '#111827' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionBtn: { width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  actionOn: { backgroundColor: '#3b82f6' },
  body: { paddingBottom: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 5,
  },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  sectionCount: { fontSize: 12, fontWeight: '500', color: '#9ca3af' },
  folderScroll: { paddingLeft: 10, paddingRight: 14, marginBottom: 4 },
  folderCard: {
    width: 110,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginRight: 10,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: '#fde68a',
  },
  folderCardActive: { backgroundColor: '#fef3c7', borderColor: '#f59e0b' },
  folderDelete: { position: 'absolute', top: 4, right: 4, zIndex: 10 },
  folderIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fef3c7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  folderName: { fontSize: 12, fontWeight: '600', color: '#92400e', textAlign: 'center' },
  folderCount: { fontSize: 10, color: '#d97706' },
  gridRow: { flexDirection: 'row', paddingHorizontal: 10, gap: 10, marginBottom: 6 },
  card: { flex: 1, maxWidth: '50%' },
  cardMedia: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cardAudio: { backgroundColor: '#eff6ff' },
  cardImg: { width: '100%', height: '100%' },
  deleteBadge: { position: 'absolute', top: -6, right: -6, zIndex: 10 },
  cardTitle: { fontSize: 12, color: '#374151', marginTop: 5, lineHeight: 16, paddingHorizontal: 2 },
  listBox: {
    marginHorizontal: 14,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  listTitle: { flex: 1, fontSize: 13, color: '#374151' },
  miniPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f3f4f6',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 10,
  },
  miniPlayerTitleWrap: { flex: 1 },
  miniPlayerTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: '#9ca3af' },
})
