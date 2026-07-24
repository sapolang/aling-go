import { requireNativeModule } from 'expo-modules-core'

export default requireNativeModule('AudioExtractor') as {
  extractAudio(sourceUri: string): Promise<string>
}
