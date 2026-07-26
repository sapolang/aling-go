import { useState, useEffect } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, Modal, ScrollView } from 'react-native'
import { Paths, File } from 'expo-file-system'

const settingsFile = new File(Paths.document, 'transcribe_settings.json')

const SOURCE_LANGUAGES = [
  { code: 'auto', label: '自动检测' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

interface Props {
  visible: boolean
  onStart: (sourceLang: string) => void
  onDismiss: () => void
}

export default function TranscribeSettingsModal({ visible, onStart, onDismiss }: Props) {
  const [sourceLang, setSourceLang] = useState('auto')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (visible) {
      if (settingsFile.exists) {
        settingsFile.text().then((json) => {
          try {
            const s = JSON.parse(json)
            if (s.sourceLang) setSourceLang(s.sourceLang)
          } catch {}
        }).catch(() => {})
      }
      setExpanded(false)
    }
  }, [visible])

  const handleStart = () => {
    settingsFile.write(JSON.stringify({ sourceLang }))
    onStart(sourceLang)
  }

  const currentSource = SOURCE_LANGUAGES.find((l) => l.code === sourceLang)?.label ?? sourceLang

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onDismiss}
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>转录设置</Text>

          <View style={styles.field}>
            <Text style={styles.label}>音频语言</Text>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => setExpanded(!expanded)}
            >
              <Text style={styles.pickerText}>{currentSource}</Text>
              <Text style={styles.arrow}>{expanded ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {expanded && (
              <ScrollView style={styles.options} nestedScrollEnabled>
                {SOURCE_LANGUAGES.map((lang) => (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.option, sourceLang === lang.code && styles.optionSelected]}
                    onPress={() => { setSourceLang(lang.code); setExpanded(false) }}
                  >
                    <Text style={[styles.optionText, sourceLang === lang.code && styles.optionTextSelected]}>
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
              <Text style={styles.startText}>开始转录</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 20,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 8,
  },
  picker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pickerText: {
    fontSize: 15,
    color: '#111827',
  },
  arrow: {
    fontSize: 12,
    color: '#9ca3af',
  },
  options: {
    maxHeight: 200,
    marginTop: 4,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  optionSelected: {
    backgroundColor: '#eff6ff',
  },
  optionText: {
    fontSize: 15,
    color: '#111827',
  },
  optionTextSelected: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  startBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
  },
  startText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
})
