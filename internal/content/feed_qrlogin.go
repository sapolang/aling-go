package content

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// --- B站扫码登录 ---

// BiliQRLoginResult 是扫码登录接口返回给前端的结果
type BiliQRLoginResult struct {
	OK      bool   `json:"ok"`
	URL     string `json:"url,omitempty"`
	Key     string `json:"key,omitempty"`
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

// bilibiliPassportRequest 请求 B站 passport 接口，复用订阅代理与当前 Cookie
func (s *FeedService) bilibiliPassportRequest(target string) (*http.Response, error) {
	req, _ := http.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://www.bilibili.com/")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Cookie", s.bilibiliCookie())
	return s.httpClient().Do(req)
}

// StartBilibiliQRLogin 生成 B站 扫码登录的二维码内容
func (s *FeedService) StartBilibiliQRLogin() BiliQRLoginResult {
	resp, err := s.bilibiliPassportRequest("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
	if err != nil {
		return BiliQRLoginResult{Error: "生成二维码失败，请检查网络或代理: " + err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return BiliQRLoginResult{Error: fmt.Sprintf("生成二维码失败：B站返回 HTTP %d", resp.StatusCode)}
	}
	var out struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			URL       string `json:"url"`
			QRCodeKey string `json:"qrcode_key"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return BiliQRLoginResult{Error: "生成二维码失败：B站返回内容异常"}
	}
	if out.Code != 0 || out.Data.QRCodeKey == "" {
		msg := out.Message
		if msg == "" {
			msg = "未知错误"
		}
		return BiliQRLoginResult{Error: "生成二维码失败：" + msg}
	}
	return BiliQRLoginResult{OK: true, URL: out.Data.URL, Key: out.Data.QRCodeKey}
}

// PollBilibiliQRLogin 轮询扫码状态，登录成功后自动保存 Cookie
func (s *FeedService) PollBilibiliQRLogin(key string) BiliQRLoginResult {
	key = strings.TrimSpace(key)
	if key == "" {
		return BiliQRLoginResult{Error: "二维码已失效，请刷新"}
	}
	resp, err := s.bilibiliPassportRequest("https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=" +
		url.QueryEscape(key) + "&source=main-mini")
	if err != nil {
		return BiliQRLoginResult{Error: "查询扫码状态失败，请检查网络或代理: " + err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return BiliQRLoginResult{Error: fmt.Sprintf("查询扫码状态失败：B站返回 HTTP %d", resp.StatusCode)}
	}

	var out struct {
		Data struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return BiliQRLoginResult{Error: "查询扫码状态失败：B站返回内容异常"}
	}

	switch out.Data.Code {
	case 0:
		cookie := bilibiliLoginCookie(resp.Cookies())
		if cookie == "" {
			return BiliQRLoginResult{Status: "failed", Error: "登录成功但未获取到 Cookie，请重试"}
		}
		res := s.SetBilibiliCookie(cookie)
		if !res.OK {
			return BiliQRLoginResult{Status: "failed", Error: "保存 Cookie 失败: " + res.Error}
		}
		return BiliQRLoginResult{OK: true, Status: "success", Message: "登录成功"}
	case 86101:
		return BiliQRLoginResult{OK: true, Status: "waiting", Message: "等待扫码"}
	case 86090:
		return BiliQRLoginResult{OK: true, Status: "scanned", Message: "已扫码，请在手机上确认"}
	case 86038:
		return BiliQRLoginResult{OK: true, Status: "expired", Message: "二维码已过期，请刷新"}
	default:
		return BiliQRLoginResult{OK: true, Status: "failed", Error: fmt.Sprintf("登录失败（%d）", out.Data.Code)}
	}
}

// bilibiliLoginCookie 从登录响应的 Set-Cookie 中提取需要的字段拼成 Cookie 串
func bilibiliLoginCookie(cookies []*http.Cookie) string {
	wanted := map[string]bool{
		"SESSDATA": true, "bili_jct": true, "DedeUserID": true,
		"DedeUserID__ckMd5": true, "sid": true, "buvid3": true, "buvid4": true,
	}
	parts := make([]string, 0, len(wanted))
	for _, c := range cookies {
		if wanted[c.Name] && c.Value != "" {
			parts = append(parts, c.Name+"="+c.Value)
		}
	}
	return strings.Join(parts, "; ")
}
