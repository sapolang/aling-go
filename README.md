# 语练 (aling-go)

A cross-platform desktop language learning application built with [Wails v3](https://wails.io/).

## Features

- **Media Player** — Play local video/audio files with waveform visualization, synchronized subtitles (SRT), and AI-powered subtitle generation via Whisper.cpp speech-to-text.
- **Vocabulary Builder** — Save and manage words with Anki-style spaced repetition (SRS): EF factor, intervals, repetitions, and review scheduling.
- **Dictionary Browser** — Browse a built-in dictionary organized by topic tags, with batch word import.
- **Typing Practice** — Read English articles by category, practice typing with accuracy/WPM tracking, and test comprehension with built-in questions.
- **Media Library** — Organize video, audio, and PDF files into custom folders.
- **Data Portability** — Export/import word lists and tags as JSON.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go |
| GUI Framework | Wails v3 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State Management | Zustand |
| UI Components | Radix UI |
| Database | SQLite (pure Go via modernc.org/sqlite) |
| Speech-to-Text | Whisper.cpp (sidecar binary) |
| Media Processing | FFmpeg (sidecar binary) |

## Prerequisites

- **Go** 1.26.10+
- **Node.js** 26+
- **Wails CLI**: `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
- **FFmpeg** (optional — a minimal build is created by the sidecar build script if needed)

### Platform-specific

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: WebView2 runtime (pre-installed on Windows 11, available for Windows 10)

## Getting Started

```bash
# Clone the repository
git clone <repo-url> && cd aling-go

# Install frontend dependencies
make frontend-install
# or: cd frontend && npm install

# Run in development mode (hot reload)
make dev
# or: wails3 dev
```

## Building

```bash
# Build sidecar binaries (whisper.cpp + minimal FFmpeg)
make sidecar

# Build macOS .app (universal binary)
make build

# Build macOS .dmg installer
make dmg

# Build Windows .exe
make exe

# Clean all build artifacts
make clean
```

## Project Structure

```
aling-go/
├── main.go                  # Entry point: embedded assets, appVersion (ldflags), bootstrap.Run
├── internal/
│   ├── bootstrap/           # Startup orchestration: service registration, window, tray
│   ├── core/                # DB connections, schema DDL, migrations (Init/Close)
│   ├── study/               # Learning side: words/tags/SRS, favorite clips, dictionary
│   │   ├── word_service.go, favorite_service.go, dict_service.go
│   │   ├── words_store.go   # Word/tag/SRS SQL & stats
│   │   └── models.go        # DTOs (Word, Tag, FavoriteClip, ...)
│   ├── content/             # Input side: articles, media library, playback, transcription
│   │   ├── article_service.go, library_service.go
│   │   ├── media_service.go, whisper_service.go
│   │   ├── article_store.go # Article queries & typing progress SQL
│   │   ├── ffmpeg.go        # FFmpeg helpers shared by media/whisper services
│   │   └── models.go        # DTOs (ArticleItem, LibraryFile, SubtitleItem, ...)
│   ├── system/              # Platform dialogs, backups, AI translation, tray icon
│   └── dict/                # Read-only dictionary package (dict.db / ECDICT)
├── cmd/
│   ├── articles-download/   # CLI tool to download article data
│   └── dict-build/          # CLI tool to rebuild dict.db from ECDICT source
├── frontend/                # React + TypeScript + Vite frontend
│   └── src/
│       ├── components/      # Reusable UI components
│       ├── pages/           # Page-level components
│       ├── stores/          # Zustand state stores
│       └── types/           # TypeScript type definitions
├── build/                   # Platform-specific build assets & Taskfiles
├── sidecar/                 # External binary build scripts
│   └── build.sh             # Builds whisper-sidecar and minimal FFmpeg
├── Taskfile.yml             # Wails v3 build tasks
└── Makefile                 # Build targets
```

## Testing

```bash
# Go vet
make vet

# Frontend type checking
make test

# Go module tidy + frontend install
make tidy
```

## Data Storage

User data is stored in the platform config directory:

- **macOS**: `~/Library/Application Support/aling-go/`
- **Windows**: `%AppData%/aling-go/`

Data files include `userData.db` (words, tags, typing progress) and `library.json` (media library structure).
