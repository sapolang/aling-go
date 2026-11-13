package system

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

	"aling-go/internal/core"
	"aling-go/internal/store/userdb"

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

// AIConfigView 回传前端的配置视图
type AIConfigView struct {
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	HasKey  bool   `json:"hasKey"`
	// APIKeyMask 已保存 Key 的掩码，与原文等长，直接展示在输入框
	APIKeyMask string `json:"apiKeyMask"`
}

// maskAPIKey 保留首尾，中间用 * 填充，掩码长度与原文一致
func maskAPIKey(key string) string {
	n := len(key)
	if n == 0 {
		return ""
	}
	if n <= 13 {
		return strings.Repeat("*", n)
	}
	return key[:9] + strings.Repeat("*", n-13) + key[n-4:]
}

type AITestResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// ActionResult 是只有成功/失败语义的通用结果
type ActionResult struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

type AIStreamResult struct {
	Cached bool   `json:"cached"`
	Text   string `json:"text"`
	Error  string `json:"error"`
}

type AIExplainResult struct {
	OK    bool           `json:"ok"`
	Error string         `json:"error"`
	Data  *AIExplainData `json:"data,omitempty"`
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

func (s *AIService) GetAIConfig() AIConfigView {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return AIConfigView{BaseURL: s.cfg.BaseURL, Model: s.cfg.Model, HasKey: s.cfg.APIKey != "", APIKeyMask: maskAPIKey(s.cfg.APIKey)}
}

// SetAIConfig 保存配置；apiKey 为空时保留原值
func (s *AIService) SetAIConfig(in AIConfig) ActionResult {
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
		return ActionResult{Error: err.Error()}
	}
	return ActionResult{OK: true}
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
func (s *AIService) TestAIConnection() AITestResult {
	res := AITestResult{}
	client, cfg, err := s.client()
	if err != nil {
		res.Message = err.Error()
		return res
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
	return res
}

// --- 缓存 ---

func aiCacheKey(kind, model, text, extra string) string {
	raw := strings.Join([]string{kind, aiPromptVersion, model, extra, text}, "\x00")
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// aiQueries 返回基于当前用户库句柄的类型安全查询集合。
func aiQueries() *userdb.Queries {
	return userdb.New(core.DB)
}

func aiCacheGet(key string) (string, bool) {
	target, err := aiQueries().GetAICache(context.Background(), key)
	if err != nil || target == "" {
		return "", false
	}
	return target, true
}

func aiCachePut(key, kind, model, source, target string) {
	_ = aiQueries().PutAICache(context.Background(), userdb.PutAICacheParams{
		Hash:   key,
		Kind:   kind,
		Model:  model,
		Source: source,
		Target: target,
	})
}

// --- 翻译 ---

const aiTranslateSystemPrompt = `你是英语学习助手。把用户提供的英文翻译成自然、准确、通顺中文。
要求：
1. 只输出译文，不要解释、不要加引号、不要输出原文
2. 保留人名、地名、专有名词和必要的英文术语
3. 如果有上下文，结合上下文确定词义与语气`

// TranslateStream 翻译句子。命中缓存时直接返回译文；否则异步流式推送
// ai:translate:chunk → ai:translate:done 事件，方法本身立即返回。
func (s *AIService) TranslateStream(text, contextText, reqID string) AIStreamResult {
	text = strings.TrimSpace(text)
	if text == "" {
		return AIStreamResult{Error: "文本为空"}
	}
	client, cfg, err := s.client()
	if err != nil {
		return AIStreamResult{Error: err.Error()}
	}

	key := aiCacheKey(aiKindTranslate, cfg.Model, text, contextText)
	if cached, ok := aiCacheGet(key); ok {
		return AIStreamResult{Cached: true, Text: cached}
	}

	go s.streamTranslate(client, cfg, text, contextText, reqID, key)
	return AIStreamResult{}
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

// Explain 返回结构化详解结果
func (s *AIService) Explain(text, contextText string) AIExplainResult {
	text = strings.TrimSpace(text)
	if text == "" {
		return AIExplainResult{Error: "文本为空"}
	}
	client, cfg, err := s.client()
	if err != nil {
		return AIExplainResult{Error: err.Error()}
	}

	key := aiCacheKey(aiKindExplain, cfg.Model, text, contextText)
	if cached, ok := aiCacheGet(key); ok {
		var data AIExplainData
		if err := json.Unmarshal([]byte(cached), &data); err != nil {
			return AIExplainResult{Error: "解析缓存结果失败：" + err.Error()}
		}
		return AIExplainResult{OK: true, Data: &data}
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
		return AIExplainResult{Error: err.Error()}
	}
	if len(resp.Choices) == 0 {
		return AIExplainResult{Error: "模型返回空内容"}
	}

	content := stripJSONFence(resp.Choices[0].Message.Content)
	var data AIExplainData
	if err := json.Unmarshal([]byte(content), &data); err != nil {
		return AIExplainResult{Error: "解析模型输出失败：" + err.Error()}
	}
	aiCachePut(key, aiKindExplain, cfg.Model, text, content)
	return AIExplainResult{OK: true, Data: &data}
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
