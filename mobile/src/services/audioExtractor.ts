import AudioExtractor from '../../modules/audio-extractor'
import { Platform } from 'react-native'

export async function extractAudioFromVideo(videoUri: string): Promise<string> {
  if (Platform.OS === 'ios') {
    return AudioExtractor.extractAudio(decodeURIComponent(videoUri.replace(/^file:\/\//, '')))
  }
  return AudioExtractor.extractAudio(videoUri)
}
