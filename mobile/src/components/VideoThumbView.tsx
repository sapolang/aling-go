import { useState, useEffect } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'
import { createVideoPlayer } from 'expo-video'
import type { VideoPlayer, VideoThumbnail } from 'expo-video'
import { Ionicons } from '@expo/vector-icons'

interface Props {
  uri: string
  style?: any
}

export default function VideoThumbView({ uri, style }: Props) {
  const [thumb, setThumb] = useState<VideoThumbnail | null>(null)

  useEffect(() => {
    if (!uri) return
    const state = { disposed: false, player: null as VideoPlayer | null }

    state.player = createVideoPlayer(uri)

    let retries = 0
    const tryGenerate = () => {
      if (state.disposed) return
      retries++
      state.player!.generateThumbnailsAsync(5)
        .then((thumbs) => {
          if (!state.disposed && thumbs[0]) {
            setThumb(thumbs[0])
            return
          }
          if (retries < 5) {
            setTimeout(tryGenerate, 500)
          }
        })
        .catch(() => {
          if (retries < 5) {
            setTimeout(tryGenerate, 500)
          }
        })
    }

    setTimeout(tryGenerate, 200)

    return () => {
      state.disposed = true
      if (state.player) {
        try { state.player.release() } catch {}
      }
    }
  }, [uri])

  if (thumb) {
    return <Image source={thumb} style={style} contentFit="cover" />
  }

  return (
    <View style={style}>
      <Ionicons name="play-circle" size={28} color="#9ca3af" />
    </View>
  )
}
