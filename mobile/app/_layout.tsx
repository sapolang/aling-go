import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { PaperProvider } from 'react-native-paper'
import { View, ActivityIndicator } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as Font from 'expo-font'
import { Ionicons } from '@expo/vector-icons'
import { initDatabase } from '../src/db/database'

export default function RootLayout() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        await initDatabase()
        Font.loadAsync(Ionicons.font).catch(() => {})
        if (mounted) setReady(true)
      } catch (e) {
        console.error('DB init failed:', e)
      }
    })()
    return () => { mounted = false }
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <PaperProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="player" />
        </Stack>
      </PaperProvider>
    </SafeAreaProvider>
  )
}
