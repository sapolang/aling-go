import { useRef, useEffect } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SubtitleItem } from '../types'
import { formatTimeRange } from '../utils/subtitle'

interface Props {
  subtitles: SubtitleItem[]
  currentIndex: number
  onWordPress?: (word: string) => void
  onPlayFrom?: (startTime: number) => void
}

function splitTextToWords(text: string): { word: string; key: number }[] {
  return text.split(/(\s+)/).map((w, i) => ({ word: w, key: i }))
}

export default function SubtitlePanel({ subtitles, currentIndex, onWordPress, onPlayFrom }: Props) {
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    if (currentIndex >= 0 && listRef.current) {
      listRef.current.scrollToIndex({
        index: currentIndex,
        animated: true,
        viewPosition: 0.5,
      })
    }
  }, [currentIndex])

  const renderItem = ({ item, index }: { item: SubtitleItem; index: number }) => {
    const isActive = index === currentIndex
    return (
      <View style={[styles.item, isActive && styles.activeItem]}>
        <TouchableOpacity
          style={styles.playButton}
          onPress={() => onPlayFrom?.(item.startTime)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="play-circle" size={18} color="#3b82f6" />
        </TouchableOpacity>
        <Text style={styles.time}>{formatTimeRange(item.startTime, item.endTime)}</Text>
        <View style={styles.textRow}>
          {splitTextToWords(item.text).map(({ word, key }) => {
            const pure = word.replace(/[^a-zA-Z'-]/g, '')
            if (!pure) {
              return <Text key={key} style={styles.text}>{word}</Text>
            }
            return (
              <TouchableOpacity
                key={key}
                onPress={() => onWordPress?.(pure.toLowerCase())}
              >
                <Text style={[styles.text, isActive && styles.activeText]}>
                  {word}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>
    )
  }

  return (
    <FlatList
      ref={listRef}
      data={subtitles}
      keyExtractor={(_, i) => String(i)}
      renderItem={renderItem}
      style={styles.container}
      getItemLayout={(_, index) => ({
        length: 60,
        offset: 60 * index,
        index,
      })}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: true,
        })
      }}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  item: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  playButton: { marginRight: 6 },
  activeItem: { backgroundColor: 'rgba(59, 130, 246, 0.1)' },
  time: { color: '#9ca3af', marginRight: 8, fontVariant: ['tabular-nums'], width: 80, fontSize: 13 },
  textRow: { flexDirection: 'row', flexWrap: 'wrap', flex: 1 },
  text: { fontSize: 16, color: '#374151', lineHeight: 24 },
  activeText: { color: '#3b82f6' },
})
