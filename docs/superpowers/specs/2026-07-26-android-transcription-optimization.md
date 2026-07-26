# Android Transcription Optimization & Streaming

**Date**: 2026-07-26
**Status**: Draft

## Overview

Optimize the Android transcription experience for the Aling language-learning app:

1. **Speed**: Reduce 6-min MP3 transcription time from ~30s to ~3-5s (5-10x faster)
2. **Streaming**: Display subtitles incrementally as audio is transcribed (first results in 2-3s)
3. **Language selection**: Let users choose source/target language before transcription

---

## Architecture

Current flow:
```
MP3 → [AudioExtractorModule.kt] → WAV → [whisper.rn tiny, nProcessors=1] → all subtitles at once
```

New flow:
```
MP3 → [AudioExtractorModule.kt + cache] → WAV
  → chunk 0 (0-30s) → whisper → segments
  → chunk 1 (29-59s) → whisper → segments (dedup)  → UI appends incrementally
  → chunk N ...                                      
```

---

## Section 1: Transcription Engine Config

**File**: `mobile/src/services/transcription.ts`

### Changes

1. **nProcessors**: Hardcoded `1` → detect device cores (minimum 4):
   ```typescript
   // Use Platform API or native module to get core count; fallback to 4
   const nProcessors = Math.max(cpuCount ?? 4, 4)
   ```

2. **beamSize**: Not set (whisper.cpp default 5) → `1` for tiny model speed

3. **translate**: Hardcoded `true` → controlled by new `targetLanguage` param:
   ```typescript
   // Only enable translate when user explicitly picks a target language
   translate: targetLanguage ? true : false
   ```

4. **useGpu**: Not set → `true` (if whisper.rn supports it on the device, falls back gracefully)

5. **New parameter interface** replacing positional args:
   ```typescript
   interface TranscribeFileInput {
     filePath: string
     modelPath: string
     options: {
       language?: string          // source language, default 'auto'
       targetLanguage?: string    // translation target; omit for transcription-only
       nProcessors?: number       // default: auto-detect
       onProgress?: (p: TranscriptionProgress) => void
       onChunkReady?: (subs: SubtitleItem[]) => void  // for streaming
     }
   }
   ```

6. Existing `transcribeAudio` refactored to accept this interface; default behavior unchanged.

---

## Section 2: Language Selection UI

**File**: `mobile/app/player.tsx` + new `mobile/src/components/TranscribeSettingsModal.tsx`

### Behavior

- Tapping "转录" opens a modal instead of starting immediately
- Two pickers: source language (auto-detect + common languages) and target language (none + common languages)
- Default values restored from `AsyncStorage` on mount, saved on dismiss
- "Start" button dismisses modal and initiates transcription with chosen settings

### Component

```typescript
// TranscribeSettingsModal.tsx
interface Props {
  visible: boolean
  onStart: (sourceLang: string, targetLang: string) => void
  onDismiss: () => void
}
```

Uses React Native `Modal` with a simple picker-style UI (scrollable option list or `@react-native-picker/picker` if available).

### Languages list

Source: `auto`, `en`, `zh`, `ja`, `ko`, `es`, `fr`, `de`
Target: `none`, `en`, `zh`, `ja`, `ko`, `es`, `fr`, `de`

---

## Section 3: Audio Chunking & Streaming

**File**: `mobile/src/services/transcription.ts`

### New function: `transcribeAudioStreaming`

```typescript
async function transcribeAudioStreaming(
  input: TranscribeFileInput
): Promise<SubtitleItem[]>
```

### Algorithm

1. Extract audio → WAV (or use cached WAV, see Section 4)
2. Calculate number of chunks:
   - `chunkDuration = 30000` (30 seconds)
   - `overlap = 1000` (1 second)
   - `totalDuration = getWavDuration(wavPath)` — read from WAV header
   - `numChunks = ceil(totalDuration / (chunkDuration - overlap))`
3. For each chunk `i`:
   - `chunkStart = i * (chunkDuration - overlap)` (milliseconds)
   - `chunkLen = min(chunkDuration, totalDuration - chunkStart)` (milliseconds)
   - Call `ctx.transcribe(audioPath, { offset: chunkStart, duration: chunkLen, ... })`
   - Await `promise` (streaming provides incremental segments within a chunk via `onNewSegments`, but chunk-based loading means we process one chunk at a time)
   - Deduplicate: skip segments whose `t0/100 < lastSegmentEndTime`
   - Accumulate into result array
   - Call `onChunkReady(accumulatedSegments)`
   - Update `onProgress({ progress: (i+1)/numChunks * 100 })`
4. Release context
5. Return all segments

### Dedup logic

```
if (lastMergedSegment.endTime <= seg.t0 / 100 + chunkStart) {
  // no overlap: add segment (adjusting t0/t1 from ms to seconds)
  merged.push({ startTime: (chunkStart + seg.t0) / 100, endTime: (chunkStart + seg.t1) / 100, text })
  lastEnd = seg.t1 / 100
}
// else: skip (overlap area, already captured by previous chunk)
```

Segment times from whisper.rn are relative to `offset`, so we add `chunkStart` back.

**Note**: whisper.rn extends `TranscribeOptions` into `TranscribeFileOptions` with `offset` ? `duration` — verify these are accepted at runtime. The type defs list them on `TranscribeOptions`, which is the base of `TranscribeFileOptions`, so they should be available.

### WAV duration extraction

Read WAV header bytes (RIFF chunk → fmt subchunk → data subchunk):
- `dataSize = bytes at offset 40-43` (4 bytes, little-endian)
- `sampleRate = bytes at offset 24-27` (4 bytes, little-endian)
- `channels = bytes at offset 22-23` (2 bytes, little-endian)
- `bytesPerSample = bitsPerSample / 8` (offset 34-35)
- `duration = dataSize / (sampleRate * channels * bytesPerSample)` in seconds

Implemented as a lightweight TS function reading the WAV file header — no native module needed.

---

## Section 4: WAV Cache

**File**: `mobile/android/app/src/main/java/com/aling/audioextractor/AudioExtractorModule.kt`

### Changes

In `extractAudioSync()`:

1. Compute MD5 hash of `inputPath` using `java.security.MessageDigest`
2. Cache file path: `{cacheDir}/aling_audio/{md5}.wav`
3. If cache file exists → log and return cached path immediately (skip extraction entirely)
4. If not → extract, write to cache path, return

No changes needed in the TS bridge (`audioExtractor.ts`).

---

## Section 5: Player UI Streaming Updates

**Files**: `mobile/src/stores/playerStore.ts`, `mobile/app/player.tsx`

### Store additions

```typescript
interface PlayerState {
  // ... existing fields ...
  chunkIndex: number       // current chunk (1-based)
  chunkTotal: number       // total chunks
  appendSubtitles: (subs: SubtitleItem[]) => void
  setChunkProgress: (idx: number, total: number) => void
}
```

`appendSubtitles` merges new items with existing `subtitles` array:
- If `subtitles` is empty, simply set them
- If the last existing subtitle's endTime matches the new ones' start (dedup already handled by transcription.ts), append all new items

### Player UI changes

1. **Progress bar label** changes from `"转录中 67%"` to `"转录中  第 3/12 块"`
2. **`handleTranscribe`** opens `TranscribeSettingsModal` instead of starting immediately
3. **New callback** in `handleTranscribe` receives `onChunkReady` and calls `appendSubtitles` + `setChunkProgress`
4. **Unsubscribe from chunk progress**: `chunkIndex` / `chunkTotal` displayed in progress area

No changes to `SubtitlePanel` — it already reacts to `subtitles` array changes via the store.

---

## Implementation Order

| # | Section | Effort | Depends on |
|---|---------|--------|------------|
| 1 | Section 1 – Engine config | Small | — |
| 2 | Section 4 – WAV cache | Small | — |
| 3 | Section 2 – Language selection modal | Medium | 1 |
| 4 | Section 3 – Chunking & streaming | Medium | 1, 4 |
| 5 | Section 5 – Player streaming UI | Small | 3, 4 |

Sections 1 and 4 are independent and can be done in parallel. Sections 3 and 5 depend on the refactored transcription API from section 1.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `offset`/`duration` not supported by whisper.rn at runtime | Verify via a quick test first; if unsupported, fall back to physically splitting WAV into chunk files |
| Chunk boundary cuts mid-word | 1s overlap handles this for >99% of cases |
| GPU not available on some Android devices | `useGpu: true` is a hint — whisper.cpp falls back to CPU gracefully |
| Cache grows unbounded | Use `cacheDir` — system auto-clears when storage is low; no manual cleanup needed |
