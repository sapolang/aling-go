.PHONY: dev build dmg exe dist sidecar clean run vet tidy frontend-install

APP_NAME = aling-go
SIDECAR_BIN = sidecar/whisper-sidecar

# macOS (default): make build         → .app
# macOS DMG:       make dmg           → .dmg
# Windows:         make exe           → .exe + 安装程序
# 完整发布:        make dist          → .app + 嵌入侧车

dev:
	wails dev

build:
	wails build -platform darwin/universal -clean

dmg: sidecar build
	install -d "build/bin/$(APP_NAME).app/Contents/Resources"
	install "$(SIDECAR_BIN)" "build/bin/$(APP_NAME).app/Contents/Resources/"
	[ ! -f sidecar/ffmpeg ] || install sidecar/ffmpeg "build/bin/$(APP_NAME).app/Contents/Resources/"
	@if ! command -v create-dmg >/dev/null 2>&1; then \
		echo "Installing create-dmg..."; \
		brew install create-dmg; \
	fi
	rm -f build/bin/$(APP_NAME).dmg
	create-dmg \
		--volname "$(APP_NAME)" \
		--window-pos 200 120 \
		--window-size 600 300 \
		--icon-size 100 \
		--icon "$(APP_NAME).app" 150 120 \
		--app-drop-link 450 120 \
		build/bin/$(APP_NAME).dmg \
		build/bin/$(APP_NAME).app
	@echo "DMG: build/bin/$(APP_NAME).dmg"
	du -sh build/bin/$(APP_NAME).dmg

exe:
	wails build -platform windows/amd64 -clean
	@echo "EXE: build/bin/$(APP_NAME).exe"
	@echo "使用 build/windows/installer/ 下的安装程序脚本打包为 .exe 安装包"

dist: sidecar build
	install -d "build/bin/$(APP_NAME).app/Contents/Resources"
	install "$(SIDECAR_BIN)" "build/bin/$(APP_NAME).app/Contents/Resources/"
	[ ! -f sidecar/ffmpeg ] || install sidecar/ffmpeg "build/bin/$(APP_NAME).app/Contents/Resources/"
	du -sh "build/bin/$(APP_NAME).app"

sidecar:
	bash sidecar/build.sh

run:
	open build/bin/$(APP_NAME).app

clean:
	wails build -clean 2>/dev/null || true
	rm -rf build/bin
	rm -rf sidecar/.whisper-cpp
	rm -f $(SIDECAR_BIN)
	rm -f build/bin/$(APP_NAME).dmg
	rm -rf frontend/dist

vet:
	go vet ./...

tidy:
	go mod tidy
	cd frontend && npm install

frontend-install:
	cd frontend && npm install

test:
	cd frontend && npx tsc --noEmit
