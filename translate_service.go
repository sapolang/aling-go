package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	aiKindTranslate = "translate"
	aiKindExplain   = "explain"
	// 提示词版本参与缓存 key，改 prompt 后不会命中旧缓存
	aiPromptVersion  = "v1"
	defaultAIBaseURL = "https://api.deepseek.com/v1"
	defaultAIModel   = "deepseek-chat"
)

// AIConfig 本地持久化的模型接入配置（含 API Key，文件权限 0600）
type AIConfig struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

// AIConfigView 回传前端的配置视图，不暴露明文 Key
type AIConfigView struct {
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	HasKey  bool   `json:"hasKey"`
}

type AITestResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type AIStreamResult struct {
	Cached bool   `json:"cached"`
	Text   string `json:"text"`
	Error  string `json:"error"`
}

type AIExplainResult struct {
	OK    bool            `json:"ok"`
	Error string          `json:"error"`
	Data  json.RawMessage `json:"data"`
}

// AIExplainData 句子详解的结构化输出
type AIExplainData struct {
	Translation string `json:"translation"`
	Grammar     string `json:"grammar"`
	Keywords    []struct {
		Word    string `json:"word"`
		Meaning string `json:"meaning"`
		Note    string `json:"note"`
	} `json:"keywords"`
	Context  string `json:"context"`
	Pitfalls string `json:"pitfalls"`
}

type AIService struct {
	app     *application.App
	dataDir string
	mu      sync.RWMutex
	cfg     AIConfig
}

func NewAIService(app *application.App, dataDir string) *AIService {
	return &AIService{app: app, dataDir: dataDir, cfg: loadAIConfig(dataDir)}
}

func (s *AIService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}
func (s *AIService) ServiceShutdown() error { return nil }

func aiConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "ai-config.json")
}

func loadAIConfig(dataDir string) AIConfig {
	cfg := AIConfig{BaseURL: defaultAIBaseURL, Model: defaultAIModel}
	data, err := os.ReadFile(aiConfigPath(dataDir))
	if err != nil {
		return cfg
	}
	var stored AIConfig
	if err := json.Unmarshal(data, &stored); err != nil {
		return cfg
	}
	if stored.BaseURL != "" {
		cfg.BaseURL = strings.TrimRight(stored.BaseURL, "/")
	}
	if stored.Model != "" {
		cfg.Model = stored.Model
	}
	cfg.APIKey = stored.APIKey
	return cfg
}

// --- 配置 ---

func (s *AIService) GetAIConfig() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	view := AIConfigView{BaseURL: s.cfg.BaseURL, Model: s.cfg.Model, HasKey: s.cfg.APIKey != ""}
	b, _ := json.Marshal(view)
	return string(b)
}

// SetAIConfig 保存配置，返回空字符串表示成功；apiKey 为空时保留原值
func (s *AIService) SetAIConfig(cfgJSON string) string {
	var in AIConfig
	if err := json.Unmarshal([]byte(cfgJSON), &in); err != nil {
		return "配置格式错误"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if v := strings.TrimSpace(in.BaseURL); v != "" {
		s.cfg.BaseURL = strings.TrimRight(v, "/")
	}
	if v := strings.TrimSpace(in.Model); v != "" {
		s.cfg.Model = v
	}
	if v := strings.TrimSpace(in.APIKey); v != "" {
		s.cfg.APIKey = v
	}
	if err := s.saveConfig(); err != nil {
		return err.Error()
	}
	return ""
}

func (s *AIService) saveConfig() error {
	// #nosec G117 -- 配置仅写到本地 0600 文件，不会输出到日志或网络
	data, err := json.Marshal(s.cfg)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.dataDir, 0755); err != nil {
		return err
	}
	// API Key 落盘，权限收紧到仅当前用户可读
	return os.WriteFile(aiConfigPath(s.dataDir), data, 0600)
}

func (s *AIService) client() (*openai.Client, AIConfig, error) {
	s.mu.RLock()
	cfg := s.cfg
	s.mu.RUnlock()
	if cfg.APIKey == "" {
		return nil, cfg, errors.New("未配置 API Key")
	}
	c := openai.DefaultConfig(cfg.APIKey)
	c.BaseURL = cfg.BaseURL
	c.HTTPClient = &http.Client{Timeout: 90 * time.Second}
	return openai.NewClientWithConfig(c), cfg, nil
}

// TestAIConnection 用一次最小请求验证 baseURL / Key / 模型是否可用
func (s *AIService) TestAIConnection() string {
	res := AITestResult{}
	client, cfg, err := s.client()
	if err != nil {
		res.Message = err.Error()
		b, _ := json.Marshal(res)
		return string(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	resp, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model:               cfg.Model,
		Messages:            []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "ping"}},
		MaxCompletionTokens: 5,
	})
	if err != nil {
		res.Message = err.Error()
	} else if len(resp.Choices) > 0 {
		res.OK = true
		res.Message = fmt.Sprintf("连接成功（%s）", cfg.Model)
	} else {
		res.Message = "服务返回空结果"
	}
	b, _ := json.Marshal(res)
	return string(b)
}

// --- 缓存 ---

func aiCacheKey(kind, model, text, extra string) string {
	raw := strings.Join([]string{kind, aiPromptVersion, model, extra, text}, "\x00")
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func aiCacheGet(key string) (string, bool) {
	var target string
	err := db.QueryRow("SELECT target FROM ai_translations WHERE hash = ?", key).Scan(&target)
	if err != nil || target == "" {
		return "", false
	}
	return target, true
}

func aiCachePut(key, kind, model, source, target string) {
	_, _ = db.Exec(
		"INSERT OR REPLACE INTO ai_translations (hash, kind, model, source, target) VALUES (?, ?, ?, ?, ?)",
		key, kind, model, source, target,
	)
}

// --- 翻译 ---

const aiTranslateSystemPrompt = `你是英语学习助手。把用户提供的英文翻译成自然、准确、通顺中文。
要求：
1. 只输出译文，不要解释、不要加引号、不要输出原文
2. 保留人名、地名、专有名词和必要的英文术语
3. 如果有上下文，结合上下文确定词义与语气`

// TranslateStream 翻译句子。命中缓存时直接返回译文；否则异步流式推送
// ai:translate:chunk → ai:translate:done 事件，方法本身立即返回。
func (s *AIService) TranslateStream(text, contextText, reqID string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return aiResultJSON(AIStreamResult{Error: "文本为空"})
	}
	client, cfg, err := s.client()
	if err != nil {
		return aiResultJSON(AIStreamResult{Error: err.Error()})
	}

	key := aiCacheKey(aiKindTranslate, cfg.Model, text, contextText)
	if cached, ok := aiCacheGet(key); ok {
		return aiResultJSON(AIStreamResult{Cached: true, Text: cached})
	}

	go s.streamTranslate(client, cfg, text, contextText, reqID, key)
	return aiResultJSON(AIStreamResult{})
}

func (s *AIService) streamTranslate(client *openai.Client, cfg AIConfig, text, contextText, reqID, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	msgs := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: aiTranslateSystemPrompt},
	}
	if strings.TrimSpace(contextText) != "" {
		msgs = append(msgs, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleUser,
			Content: "上下文（仅供理解，不要翻译）：\n" + contextText,
		})
	}
	msgs = append(msgs, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: "请翻译：\n" + text,
	})

	stream, err := client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{
		Model:       cfg.Model,
		Messages:    msgs,
		Temperature: 0.2,
	})
	if err != nil {
		s.app.Event.Emit("ai:translate:done", map[string]string{"reqId": reqID, "error": err.Error()})
		return
	}
	defer func() { _ = stream.Close() }()

	var b strings.Builder
	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			s.app.Event.Emit("ai:translate:done", map[string]string{
				"reqId": reqID, "text": b.String(), "error": err.Error(),
			})
			return
		}
		if len(resp.Choices) == 0 {
			continue
		}
		delta := resp.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		b.WriteString(delta)
		s.app.Event.Emit("ai:translate:chunk", map[string]string{"reqId": reqID, "delta": delta})
	}

	result := strings.TrimSpace(b.String())
	if result == "" {
		s.app.Event.Emit("ai:translate:done", map[string]string{"reqId": reqID, "error": "模型返回空内容"})
		return
	}
	aiCachePut(key, aiKindTranslate, cfg.Model, text, result)
	s.app.Event.Emit("ai:translate:done", map[string]string{"reqId": reqID, "text": result})
}

// --- 详解 ---

const aiExplainSystemPrompt = `你是英语精读助手。对给定的英文句子做结构化讲解，只输出 JSON，不要输出任何多余文字。
JSON 字段要求：
{
  "translation": "整句中文译文",
  "grammar": "句子主干、从句、时态/语态的拆解说明",
  "keywords": [{"word": "原文出现的词或短语", "meaning": "在句中的含义", "note": "用法/搭配要点"}],
  "context": "该句在上下文中的作用、语气或隐含意思",
  "pitfalls": "中文母语学习者容易误读或误译的要点"
}
keywords 取 2-5 个对理解句意最关键的词或短语。所有字段都用中文说明。`

// Explain 返回结构化详解 JSON：{ok, error, data}
func (s *AIService) Explain(text, contextText string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return aiResultJSON(AIExplainResult{Error: "文本为空"})
	}
	client, cfg, err := s.client()
	if err != nil {
		return aiResultJSON(AIExplainResult{Error: err.Error()})
	}

	key := aiCacheKey(aiKindExplain, cfg.Model, text, contextText)
	if cached, ok := aiCacheGet(key); ok {
		return aiResultJSON(AIExplainResult{OK: true, Data: json.RawMessage(cached)})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	userContent := "句子：\n" + text
	if strings.TrimSpace(contextText) != "" {
		userContent = "上下文：\n" + contextText + "\n\n句子：\n" + text
	}

	resp, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model: cfg.Model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: aiExplainSystemPrompt},
			{Role: openai.ChatMessageRoleUser, Content: userContent},
		},
		Temperature: 0.2,
		ResponseFormat: &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONObject,
		},
	})
	if err != nil {
		return aiResultJSON(AIExplainResult{Error: err.Error()})
	}
	if len(resp.Choices) == 0 {
		return aiResultJSON(AIExplainResult{Error: "模型返回空内容"})
	}

	content := stripJSONFence(resp.Choices[0].Message.Content)
	var data AIExplainData
	if err := json.Unmarshal([]byte(content), &data); err != nil {
		return aiResultJSON(AIExplainResult{Error: "解析模型输出失败：" + err.Error()})
	}
	aiCachePut(key, aiKindExplain, cfg.Model, text, content)
	return aiResultJSON(AIExplainResult{OK: true, Data: json.RawMessage(content)})
}

// 模型偶尔会包一层 ```json ``` 代码块，去掉后再解析
func stripJSONFence(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

func aiResultJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"结果序列化失败"}`
	}
	return string(b)
}
