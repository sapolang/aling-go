// Package config 统一管理应用设置的本地持久化。
//
// 设置分为两份文件：
//   - settings.json：普通应用设置，权限 0644
//   - secrets.json：API Key、Cookie 等敏感字段，权限 0600
//
// 写入采用「临时文件 + rename」的原子方式，避免进程中断留下半截文件。
// 旧版本散落的 whisper-model.txt、whisper-lang.txt、feed-config.json、
// ai-config.json 会在首次启动时迁移到新文件并删除。
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	settingsFile = "settings.json"
	secretsFile  = "secrets.json"

	settingsPerm = 0o644
	secretsPerm  = 0o600
)

// Settings 是可公开的普通设置。
type Settings struct {
	WhisperModel string `json:"whisperModel"`
	WhisperLang  string `json:"whisperLang"`
	FeedProxy    string `json:"feedProxy"`
	AIBaseURL    string `json:"aiBaseUrl"`
	AIModel      string `json:"aiModel"`
}

// Secrets 是需要收紧权限的敏感设置。
type Secrets struct {
	AIAPIKey       string `json:"aiApiKey"`
	BilibiliCookie string `json:"bilibiliCookie"`
}

// Store 是进程内共享的设置存储，所有读写都在锁内完成。
type Store struct {
	dir    string
	logger *slog.Logger

	mu       sync.RWMutex
	settings Settings
	secrets  Secrets
}

// New 读取 dataDir 下的设置文件，并完成旧配置的一次性迁移。
// 读取失败时回落为零值，由调用方决定业务默认值。
func New(dir string, logger *slog.Logger) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Store{dir: dir, logger: logger}
	s.load()
	return s
}

// Settings 返回普通设置的副本。
func (s *Store) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings
}

// Secrets 返回敏感设置的副本。
func (s *Store) Secrets() Secrets {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.secrets
}

// UpdateSettings 修改并持久化普通设置。
func (s *Store) UpdateSettings(fn func(*Settings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.settings)
	return s.saveLocked(settingsFile, &s.settings, settingsPerm)
}

// UpdateSecrets 修改并持久化敏感设置，文件权限保持 0600。
func (s *Store) UpdateSecrets(fn func(*Secrets)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.secrets)
	return s.saveLocked(secretsFile, &s.secrets, secretsPerm)
}

func (s *Store) load() {
	if err := s.readJSON(settingsFile, &s.settings); err != nil {
		s.logger.Warn("load settings", "error", err)
	}
	if err := s.readJSON(secretsFile, &s.secrets); err != nil {
		s.logger.Warn("load secrets", "error", err)
	}
	s.migrateLegacy()
}

func (s *Store) path(name string) string {
	return filepath.Join(s.dir, name)
}

// readJSON 读取并解析设置文件；文件不存在视为首次启动，不记录日志。
func (s *Store) readJSON(name string, dst any) error {
	data, err := os.ReadFile(s.path(name))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read %s: %w", name, err)
	}
	if err := json.Unmarshal(data, dst); err != nil {
		return fmt.Errorf("parse %s: %w", name, err)
	}
	return nil
}

func (s *Store) saveLocked(name string, v any, perm os.FileMode) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", name, err)
	}

	tmp, err := os.CreateTemp(s.dir, "."+name+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp %s: %w", name, err)
	}
	tmpPath := tmp.Name()
	// rename 成功后临时文件已不存在，清理失败可以忽略
	defer func() { _ = os.Remove(tmpPath) }()

	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod %s: %w", name, err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write %s: %w", name, err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync %s: %w", name, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close %s: %w", name, err)
	}
	if err := os.Rename(tmpPath, s.path(name)); err != nil {
		return fmt.Errorf("rename %s: %w", name, err)
	}
	return nil
}

// migrateLegacy 把旧版本的散装配置迁移到 settings.json / secrets.json。
// 新文件中的已有值优先，迁移成功后删除旧文件。
func (s *Store) migrateLegacy() {
	var (
		settingsDirty bool
		secretsDirty  bool
		consumed      []string
	)

	if v, ok := s.readLegacyText("whisper-model.txt"); ok {
		consumed = append(consumed, "whisper-model.txt")
		if s.settings.WhisperModel == "" && v != "" {
			s.settings.WhisperModel = v
			settingsDirty = true
		}
	}

	if v, ok := s.readLegacyText("whisper-lang.txt"); ok {
		consumed = append(consumed, "whisper-lang.txt")
		if s.settings.WhisperLang == "" && v != "" {
			s.settings.WhisperLang = v
			settingsDirty = true
		}
	}

	var feed struct {
		Proxy          string `json:"proxy"`
		BilibiliCookie string `json:"bilibiliCookie"`
	}
	if ok := s.readLegacyJSON("feed-config.json", &feed); ok {
		consumed = append(consumed, "feed-config.json")
		if v := strings.TrimSpace(feed.Proxy); v != "" && s.settings.FeedProxy == "" {
			s.settings.FeedProxy = v
			settingsDirty = true
		}
		if v := strings.TrimSpace(feed.BilibiliCookie); v != "" && s.secrets.BilibiliCookie == "" {
			s.secrets.BilibiliCookie = v
			secretsDirty = true
		}
	}

	var ai struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
		Model   string `json:"model"`
	}
	if ok := s.readLegacyJSON("ai-config.json", &ai); ok {
		consumed = append(consumed, "ai-config.json")
		if v := strings.TrimSpace(ai.BaseURL); v != "" && s.settings.AIBaseURL == "" {
			s.settings.AIBaseURL = v
			settingsDirty = true
		}
		if v := strings.TrimSpace(ai.Model); v != "" && s.settings.AIModel == "" {
			s.settings.AIModel = v
			settingsDirty = true
		}
		if v := strings.TrimSpace(ai.APIKey); v != "" && s.secrets.AIAPIKey == "" {
			s.secrets.AIAPIKey = v
			secretsDirty = true
		}
	}

	// 先落盘再删旧文件：任一步失败都保留旧文件，下次启动重试
	if settingsDirty {
		if err := s.saveLocked(settingsFile, &s.settings, settingsPerm); err != nil {
			s.logger.Warn("migrate legacy settings", "error", err)
			return
		}
	}
	if secretsDirty {
		if err := s.saveLocked(secretsFile, &s.secrets, secretsPerm); err != nil {
			s.logger.Warn("migrate legacy secrets", "error", err)
			return
		}
	}
	for _, name := range consumed {
		if err := os.Remove(s.path(name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			s.logger.Warn("remove legacy config", "file", name, "error", err)
		}
	}
}

func (s *Store) readLegacyText(name string) (string, bool) {
	data, err := os.ReadFile(s.path(name))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			s.logger.Warn("read legacy config", "file", name, "error", err)
		}
		return "", false
	}
	return strings.TrimSpace(string(data)), true
}

func (s *Store) readLegacyJSON(name string, dst any) bool {
	data, err := os.ReadFile(s.path(name))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			s.logger.Warn("read legacy config", "file", name, "error", err)
		}
		return false
	}
	if err := json.Unmarshal(data, dst); err != nil {
		// 解析失败的旧文件保留在原处，避免误删用户数据
		s.logger.Warn("parse legacy config", "file", name, "error", err)
		return false
	}
	return true
}
