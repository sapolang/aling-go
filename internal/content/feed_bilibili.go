package content

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// --- B站：直接调官方 wbi 签名 API，不依赖 RSSHub ---

// bilibiliMidFromURL 从 RSSHub 风格的 B 站 URL 中提取 UP 主 mid
// 支持 https://rsshub.app/bilibili/user/video/12345 以及直接 https://space.bilibili.com/12345
var bilibiliUserVideoRe = regexp.MustCompile(`^(?:https?://)?[^/]+/bilibili/user/video/(\d+)(?:[?#].*)?$`)

func bilibiliMidFromURL(rawURL string) string {
	if m := bilibiliUserVideoRe.FindStringSubmatch(rawURL); len(m) == 2 {
		return m[1]
	}
	if m := bilibiliSpaceRe.FindStringSubmatch(rawURL); len(m) == 2 {
		return m[1]
	}
	return ""
}

// bilibiliCookie 返回请求 B站接口使用的 Cookie。
// 优先使用用户配置的登录态 Cookie，并保证带上 buvid3（缺失时追加匿名 buvid），
// 不带 buvid 的请求会被 B站直接判定为风控，返回 412。
func (s *FeedService) bilibiliCookie() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.biliCookie == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		s.biliCookie = fmt.Sprintf("buvid3=%X-%X-%X-%X-%Xinfoc; b_nut=%d",
			b[0:4], b[4:6], b[6:8], b[8:10], b[10:16], time.Now().Unix())
	}
	if s.biliUserCookie == "" {
		return s.biliCookie
	}
	if strings.Contains(s.biliUserCookie, "buvid3=") {
		return s.biliUserCookie
	}
	return s.biliUserCookie + "; " + s.biliCookie
}

// biliDynamicResp 是 B站动态流接口的响应结构
type biliDynamicResp struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Offset  string `json:"offset"`
		HasMore bool   `json:"has_more"`
		Items   []struct {
			Type    string `json:"type"`
			Modules struct {
				ModuleAuthor struct {
					PubTS string `json:"pub_ts"`
				} `json:"module_author"`
				ModuleDynamic struct {
					Desc *struct {
						Text string `json:"text"`
					} `json:"desc"`
					Major struct {
						Archive *struct {
							BVID         string `json:"bvid"`
							Title        string `json:"title"`
							Desc         string `json:"desc"`
							Cover        string `json:"cover"`
							DurationText string `json:"duration_text"`
						} `json:"archive"`
					} `json:"major"`
				} `json:"module_dynamic"`
			} `json:"modules"`
		} `json:"items"`
	} `json:"data"`
}

// bilibiliMixinKeyEncTab 是 B站 WBI 签名固定的密钥打乱表
var bilibiliMixinKeyEncTab = []int{
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
	26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
	20, 34, 44, 52,
}

const bilibiliWebUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// biliArcSearchResp 是 B站空间投稿接口（x/space/wbi/arc/search）的响应结构
type biliArcSearchResp struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Page struct {
			Count int `json:"count"`
		} `json:"page"`
		List struct {
			VList []struct {
				BVID        string `json:"bvid"`
				Title       string `json:"title"`
				Description string `json:"description"`
				Pic         string `json:"pic"`
				Length      string `json:"length"`
				Created     int64  `json:"created"`
			} `json:"vlist"`
		} `json:"list"`
	} `json:"data"`
}

// fetchBilibiliFeed 获取 UP 主的视频投稿列表。
// 优先用 WBI 签名的空间投稿接口（直接返回 length/created，数据最准），
// 该接口被风控时回退到动态流接口（动态流必须带 features 参数，否则返回空列表）。
func (s *FeedService) fetchBilibiliFeed(mid string) (*feedMeta, error) {
	episodes, err := s.bilibiliVideosByWBI(mid)
	if err != nil || len(episodes) == 0 {
		wbiErr := err
		fallback, ferr := s.bilibiliVideosByDynamic(mid)
		switch {
		case ferr == nil && len(fallback) > 0:
			episodes, err = fallback, nil
		case ferr != nil:
			err = ferr
		case wbiErr != nil:
			err = wbiErr
		default:
			err = fmt.Errorf("该 UP 主近期没有视频投稿")
		}
	}
	if err != nil {
		return nil, err
	}

	return &feedMeta{
		title:    "Bilibili UP主 " + mid,
		desc:     "B站视频列表",
		image:    s.bilibiliUploaderFace(mid),
		siteURL:  "https://space.bilibili.com/" + mid,
		episodes: episodes,
	}, nil
}

// bilibiliUploaderFace 取 UP 主头像作为订阅列表封面，失败时返回空串（前端回退到通用图标）
func (s *FeedService) bilibiliUploaderFace(mid string) string {
	var out struct {
		Code int `json:"code"`
		Data struct {
			Card struct {
				Face string `json:"face"`
			} `json:"card"`
		} `json:"data"`
	}
	api := "https://api.bilibili.com/x/web-interface/card?mid=" + url.QueryEscape(mid)
	if err := fetchBiliJSON(s.httpClient(), s.bilibiliCookie(), api, &out); err != nil || out.Code != 0 {
		return ""
	}
	face := strings.TrimSpace(out.Data.Card.Face)
	if strings.HasPrefix(face, "http://") {
		face = "https://" + strings.TrimPrefix(face, "http://")
	}
	return face
}

// bilibiliRiskHint 生成风控相关提示：未配置登录 Cookie 时引导扫码登录
func (s *FeedService) bilibiliRiskHint() string {
	s.mu.RLock()
	hasUserCookie := s.biliUserCookie != ""
	s.mu.RUnlock()
	if hasUserCookie {
		return "，可能触发了 B站 风控，请稍后重试或重新扫码登录"
	}
	return "，可能触发了 B站 风控；匿名访问不稳定，建议先在播客页扫码登录 B站 后重试"
}

// bilibiliWbiMixinKey 获取 WBI 签名密钥并缓存 1 小时。
// 未登录时 nav 接口 code 为 -101，但 wbi_img 字段仍然可用。
func (s *FeedService) bilibiliWbiMixinKey() (string, error) {
	s.mu.RLock()
	key, expireAt := s.wbiMixinKey, s.wbiExpireAt
	s.mu.RUnlock()
	if key != "" && time.Now().Before(expireAt) {
		return key, nil
	}

	req, _ := http.NewRequest(http.MethodGet, "https://api.bilibili.com/x/web-interface/nav", nil)
	req.Header.Set("User-Agent", bilibiliWebUA)
	req.Header.Set("Referer", "https://www.bilibili.com")
	req.Header.Set("Cookie", s.bilibiliCookie())

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("获取B站签名密钥失败，请检查网络: %w", err)
	}
	defer resp.Body.Close()

	var nav struct {
		Data struct {
			WbiImg struct {
				ImgURL string `json:"img_url"`
				SubURL string `json:"sub_url"`
			} `json:"wbi_img"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&nav); err != nil {
		return "", fmt.Errorf("获取B站签名密钥失败%s", s.bilibiliRiskHint())
	}

	imgKey := biliFileNameKey(nav.Data.WbiImg.ImgURL)
	subKey := biliFileNameKey(nav.Data.WbiImg.SubURL)
	if imgKey == "" || subKey == "" {
		return "", fmt.Errorf("获取B站签名密钥失败，请稍后重试")
	}

	raw := imgKey + subKey
	var sb strings.Builder
	for _, idx := range bilibiliMixinKeyEncTab {
		if idx < len(raw) {
			sb.WriteByte(raw[idx])
		}
	}
	mixinKey := sb.String()
	if len(mixinKey) > 32 {
		mixinKey = mixinKey[:32]
	}

	s.mu.Lock()
	s.wbiMixinKey = mixinKey
	s.wbiExpireAt = time.Now().Add(time.Hour)
	s.mu.Unlock()
	return mixinKey, nil
}

// biliFileNameKey 从 wbi 图片地址中取出文件名（不含扩展名）
func biliFileNameKey(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	name := rawURL[strings.LastIndex(rawURL, "/")+1:]
	if i := strings.Index(name, "."); i >= 0 {
		name = name[:i]
	}
	return name
}

// bilibiliSignWBI 按 WBI 规则对参数排序、过滤特殊字符并附加 wts 与 w_rid
func (s *FeedService) bilibiliSignWBI(params url.Values, mixinKey string) string {
	params.Set("wts", strconv.FormatInt(time.Now().Unix(), 10))

	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var sb strings.Builder
	for _, k := range keys {
		v := strings.Map(func(r rune) rune {
			switch r {
			case '!', '\'', '(', ')', '*':
				return -1
			}
			return r
		}, params.Get(k))
		if sb.Len() > 0 {
			sb.WriteByte('&')
		}
		sb.WriteString(url.QueryEscape(k))
		sb.WriteByte('=')
		sb.WriteString(url.QueryEscape(v))
	}
	sum := md5.Sum([]byte(sb.String() + mixinKey))
	return sb.String() + "&w_rid=" + fmt.Sprintf("%x", sum)
}

// bilibiliVideosByWBI 通过 WBI 签名的空间投稿接口拉取视频列表
func (s *FeedService) bilibiliVideosByWBI(mid string) ([]FeedEpisode, error) {
	const maxEpisodes = 30

	mixinKey, err := s.bilibiliWbiMixinKey()
	if err != nil {
		return nil, err
	}

	params := url.Values{}
	params.Set("mid", mid)
	params.Set("ps", strconv.Itoa(maxEpisodes))
	params.Set("pn", "1")
	params.Set("order", "pubdate")
	params.Set("platform", "web")
	signed := s.bilibiliSignWBI(params, mixinKey)

	req, _ := http.NewRequest(http.MethodGet, "https://api.bilibili.com/x/space/wbi/arc/search?"+signed, nil)
	req.Header.Set("User-Agent", bilibiliWebUA)
	req.Header.Set("Referer", "https://space.bilibili.com/"+mid)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Cookie", s.bilibiliCookie())

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("拉取B站视频列表失败，请检查网络: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("拉取B站视频列表失败：B站返回 HTTP %d%s", resp.StatusCode, s.bilibiliRiskHint())
	}

	var apiResp biliArcSearchResp
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		// 风控命中时返回 HTML 页面而不是 JSON
		return nil, fmt.Errorf("拉取B站视频列表失败：B站返回了网页而不是数据%s", s.bilibiliRiskHint())
	}
	if apiResp.Code != 0 {
		return nil, fmt.Errorf("拉取B站视频列表失败：B站接口返回 %d %s%s", apiResp.Code, apiResp.Message, s.bilibiliRiskHint())
	}

	episodes := make([]FeedEpisode, 0, maxEpisodes)
	for _, v := range apiResp.Data.List.VList {
		if v.BVID == "" {
			continue
		}
		episodes = append(episodes, FeedEpisode{
			Title:       strings.TrimSpace(v.Title),
			Description: stripHTML(v.Description),
			Link:        "https://www.bilibili.com/video/" + v.BVID,
			Duration:    parseBilibiliDuration(v.Length),
			PublishedAt: time.Unix(v.Created, 0).Format(time.RFC3339),
			Image:       normalizeBilibiliPic(v.Pic),
			GUID:        v.BVID,
		})
	}
	return episodes, nil
}

// bilibiliVideosByDynamic 通过动态流接口拉取视频列表。
// features 参数不能省略：省略后接口仍返回 code=0，但 items 为空。
func (s *FeedService) bilibiliVideosByDynamic(mid string) ([]FeedEpisode, error) {
	const (
		maxEpisodes = 30
		maxPages    = 3
	)

	episodes := make([]FeedEpisode, 0, maxEpisodes)
	offset := ""
	for page := 0; page < maxPages && len(episodes) < maxEpisodes; page++ {
		q := url.Values{}
		q.Set("host_mid", mid)
		q.Set("timezone_offset", "-480")
		q.Set("features", "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote")
		if offset != "" {
			q.Set("offset", offset)
		}
		req, _ := http.NewRequest(http.MethodGet, "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?"+q.Encode(), nil)
		req.Header.Set("User-Agent", bilibiliWebUA)
		req.Header.Set("Referer", "https://space.bilibili.com/"+mid+"/dynamic")
		req.Header.Set("Accept", "application/json, text/plain, */*")
		req.Header.Set("Cookie", s.bilibiliCookie())

		resp, err := s.httpClient().Do(req)
		if err != nil {
			return nil, fmt.Errorf("拉取B站视频列表失败，请检查网络: %w", err)
		}
		var apiResp biliDynamicResp
		decodeErr := json.NewDecoder(resp.Body).Decode(&apiResp)
		_ = resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			// 匿名请求过多时 B站会直接返回 412 风控页
			return nil, fmt.Errorf("拉取B站视频列表失败：B站返回 HTTP %d%s", resp.StatusCode, s.bilibiliRiskHint())
		}
		if decodeErr != nil {
			return nil, fmt.Errorf("拉取B站视频列表失败：B站返回了网页而不是数据%s", s.bilibiliRiskHint())
		}
		if apiResp.Code != 0 {
			return nil, fmt.Errorf("拉取B站视频列表失败：B站接口返回 %d %s%s", apiResp.Code, apiResp.Message, s.bilibiliRiskHint())
		}

		for _, item := range apiResp.Data.Items {
			archive := item.Modules.ModuleDynamic.Major.Archive
			if item.Type != "DYNAMIC_TYPE_AV" || archive == nil || archive.BVID == "" {
				continue
			}
			desc := archive.Desc
			if desc == "" && item.Modules.ModuleDynamic.Desc != nil {
				desc = item.Modules.ModuleDynamic.Desc.Text
			}
			pubTS, _ := strconv.ParseInt(item.Modules.ModuleAuthor.PubTS, 10, 64)
			episodes = append(episodes, FeedEpisode{
				Title:       strings.TrimSpace(archive.Title),
				Description: stripHTML(desc),
				Link:        "https://www.bilibili.com/video/" + archive.BVID,
				Duration:    parseBilibiliDuration(archive.DurationText),
				PublishedAt: time.Unix(pubTS, 0).Format(time.RFC3339),
				Image:       normalizeBilibiliPic(archive.Cover),
				GUID:        archive.BVID,
			})
			if len(episodes) >= maxEpisodes {
				break
			}
		}

		if !apiResp.Data.HasMore || apiResp.Data.Offset == "" || apiResp.Data.Offset == offset {
			break
		}
		offset = apiResp.Data.Offset
	}
	return episodes, nil
}

// normalizeBilibiliPic 把 B站封面地址统一成 https 绝对地址
func normalizeBilibiliPic(pic string) string {
	pic = strings.TrimSpace(pic)
	if strings.HasPrefix(pic, "//") {
		return "https:" + pic
	}
	if strings.HasPrefix(pic, "http://") {
		return "https://" + strings.TrimPrefix(pic, "http://")
	}
	return pic
}

func parseBilibiliDuration(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	parts := strings.Split(s, ":")
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}
