package tts

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

const (
	//nolint:gosec // Edge-TTS 公开的客户端令牌，不是应用密钥。
	edgeTrustedToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	edgeWSEndpoint   = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"
	edgeOrigin       = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
	edgeUserAgent    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"

	edgeConnectTimeout = 2 * time.Second
	edgeFirstAudioWait = 2 * time.Second
	// 整段朗读一次合成的文本可能远长于单句，放宽总超时避免长段落误判为失败。
	edgeTotalTimeout = 30 * time.Second
	// 空闲连接超过该时长就直接丢弃，避免复用已被服务端回收的连接。
	edgeIdleMaxAge = 10 * time.Second
)

var edgeVoicePattern = regexp.MustCompile(`^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural$`)

// Edge-TTS 的 Sec-MS-GEC 版本号会随客户端更新变化。v2 令牌必须搭配
// "2-" 前缀；前缀之后的版本号服务端目前不校验。
var edgeGECVersions = []string{"2-155.0.4283.45"}

// edgeClient 复用最近一条 WebSocket 连接，省掉每次朗读的 TCP/TLS 与握手开销。
// 同时只有一个空闲槽位，并发请求各自新建连接，因此不会互相阻塞。
type edgeClient struct {
	mu   sync.Mutex
	idle *edgeConn
}

type edgeConn struct {
	conn *websocket.Conn
	at   time.Time
}

// Close 关闭空闲连接，供服务关闭时调用。
func (c *edgeClient) Close() {
	c.mu.Lock()
	idle := c.idle
	c.idle = nil
	c.mu.Unlock()
	if idle != nil {
		_ = idle.conn.Close(websocket.StatusNormalClosure, "")
	}
}

func (c *edgeClient) takeIdle() *websocket.Conn {
	c.mu.Lock()
	idle := c.idle
	c.idle = nil
	c.mu.Unlock()
	if idle == nil {
		return nil
	}
	if time.Since(idle.at) > edgeIdleMaxAge {
		_ = idle.conn.Close(websocket.StatusNormalClosure, "")
		return nil
	}
	return idle.conn
}

func (c *edgeClient) putIdle(conn *websocket.Conn) {
	c.mu.Lock()
	old := c.idle
	c.idle = &edgeConn{conn: conn, at: time.Now()}
	c.mu.Unlock()
	if old != nil {
		_ = old.conn.Close(websocket.StatusNormalClosure, "")
	}
}

// synthesize 通过 Edge 的 WebSocket 协议合成单句 MP3。
func (c *edgeClient) synthesize(ctx context.Context, text, voice string) ([]byte, error) {
	voice = normalizeEdgeVoice(voice)
	var lastErr error
	for _, version := range edgeGECVersions {
		audio, err := c.synthesizeOnce(ctx, text, voice, version)
		if err == nil && len(audio) > 0 {
			return audio, nil
		}
		if err != nil {
			lastErr = err
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("Edge-TTS 没有返回音频")
	}
	return nil, lastErr
}

func (c *edgeClient) synthesizeOnce(ctx context.Context, text, voice, version string) ([]byte, error) {
	if conn := c.takeIdle(); conn != nil {
		audio, err := edgeTurn(ctx, conn, text, voice)
		if err == nil {
			c.putIdle(conn)
			return audio, nil
		}
		_ = conn.Close(websocket.StatusInternalError, "")
		if ctx.Err() != nil {
			return nil, err
		}
		// 空闲连接可能已被服务端回收，换新连接重试一次。
	}

	conn, err := c.dial(ctx, version)
	if err != nil {
		return nil, err
	}
	audio, err := edgeTurn(ctx, conn, text, voice)
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "")
		return nil, err
	}
	c.putIdle(conn)
	return audio, nil
}

func (c *edgeClient) dial(ctx context.Context, version string) (*websocket.Conn, error) {
	dialCtx, cancelDial := context.WithTimeout(ctx, edgeConnectTimeout)
	defer cancelDial()

	url := fmt.Sprintf("%s?TrustedClientToken=%s&ConnectionId=%s&Sec-MS-GEC=%s&Sec-MS-GEC-Version=%s",
		edgeWSEndpoint,
		edgeTrustedToken,
		uuid.NewString(),
		secMSGEC(time.Now()),
		version,
	)
	headers := http.Header{}
	headers.Set("Origin", edgeOrigin)
	headers.Set("User-Agent", edgeUserAgent)
	headers.Set("Pragma", "no-cache")
	headers.Set("Cache-Control", "no-cache")
	headers.Set("Accept-Language", "en-US,en;q=0.9")

	conn, _, err := websocket.Dial(dialCtx, url, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		return nil, fmt.Errorf("连接 Edge-TTS 失败：%w", err)
	}
	return conn, nil
}

// edgeTurn 在已建立的连接上完成一次合成：发送配置与 SSML，读取音频直到 turn.end。
func edgeTurn(ctx context.Context, conn *websocket.Conn, text, voice string) ([]byte, error) {
	overallCtx, cancelOverall := context.WithTimeout(ctx, edgeTotalTimeout)
	defer cancelOverall()

	now := time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT+0000 (Coordinated Universal Time)")
	requestID := strings.ReplaceAll(uuid.NewString(), "-", "")
	config := `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
	configMessage := "X-Timestamp:" + now + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" + config
	if err := conn.Write(overallCtx, websocket.MessageText, []byte(configMessage)); err != nil {
		return nil, fmt.Errorf("发送 Edge-TTS 配置失败：%w", err)
	}

	ssml := buildSSML(text, voice)
	ssmlMessage := "X-RequestId:" + requestID + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + now + "Z\r\nPath:ssml\r\n\r\n" + ssml
	if err := conn.Write(overallCtx, websocket.MessageText, []byte(ssmlMessage)); err != nil {
		return nil, fmt.Errorf("发送 Edge-TTS 文本失败：%w", err)
	}

	firstDeadline := time.Now().Add(edgeFirstAudioWait)
	var audio bytes.Buffer
	gotAudio := false
	for {
		readCtx := overallCtx
		cancelRead := context.CancelFunc(func() {})
		if !gotAudio {
			readCtx, cancelRead = context.WithDeadline(overallCtx, firstDeadline)
		}
		messageType, data, readErr := conn.Read(readCtx)
		cancelRead()
		if readErr != nil {
			if gotAudio && audio.Len() > 0 {
				break
			}
			return nil, fmt.Errorf("读取 Edge-TTS 音频失败：%w", readErr)
		}
		switch messageType {
		case websocket.MessageBinary:
			chunk := audioPayload(data)
			if len(chunk) > 0 {
				audio.Write(chunk)
				gotAudio = true
			}
		case websocket.MessageText:
			if strings.Contains(string(data), "Path:turn.end") {
				_ = conn.Write(overallCtx, websocket.MessageText,
					[]byte("X-RequestId:"+requestID+"\r\nPath:turn.end\r\n\r\n"))
				if audio.Len() == 0 {
					return nil, fmt.Errorf("Edge-TTS 返回了空音频")
				}
				return audio.Bytes(), nil
			}
		}
	}
	if audio.Len() == 0 {
		return nil, fmt.Errorf("Edge-TTS 返回了空音频")
	}
	return audio.Bytes(), nil
}

// buildSSML 生成单句 SSML。文本必须转义，voice 只接受 Edge 的 Neural 名称格式。
func buildSSML(text, voice string) string {
	var escaped bytes.Buffer
	_ = xml.EscapeText(&escaped, []byte(strings.Join(strings.Fields(text), " ")))
	return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
		"<voice name='" + voice + "'>" +
		"<prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + escaped.String() + "</prosody>" +
		"</voice></speak>"
}

// audioPayload 解析 Edge 二进制帧：2 字节大端头长度 + 文本头 + 音频负载。
func audioPayload(message []byte) []byte {
	if len(message) < 2 {
		return nil
	}
	headerLen := int(binary.BigEndian.Uint16(message[:2]))
	if headerLen < 0 || len(message) < 2+headerLen {
		return nil
	}
	return message[2+headerLen:]
}

// secMSGEC 返回当前时间的 Sec-MS-GEC v2 令牌。
func secMSGEC(now time.Time) string {
	return generateSecMSGECV2(float64(now.Unix()))
}

func normalizeEdgeVoice(voice string) string {
	if edgeVoicePattern.MatchString(voice) {
		return voice
	}
	for _, item := range edgeVoices {
		if item.ID == voice {
			return voice
		}
	}
	return DefaultEdgeVoice
}
