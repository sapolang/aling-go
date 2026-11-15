package content

import (
	"path/filepath"
	"strings"
)

// mediaCategory 是媒体库对文件的大类划分，与前端 LibraryFile.Type 保持一致。
type mediaCategory int

const (
	mediaNone mediaCategory = iota
	mediaVideo
	mediaAudio
	mediaPDF
)

// mediaFormat 描述一个扩展名对应的媒体类别与响应 MIME 类型。
type mediaFormat struct {
	category mediaCategory
	mime     string
}

// mediaFormats 是扩展名识别的唯一来源：媒体库分类、媒体代理的 Content-Type、
// 转码时是否只取音轨都从这张表派生，避免多份清单各自维护导致漂移。
// key 为小写且不含点。
var mediaFormats = map[string]mediaFormat{
	"mp4":  {mediaVideo, "video/mp4"},
	"m4v":  {mediaVideo, "video/mp4"},
	"mkv":  {mediaVideo, "video/x-matroska"},
	"mov":  {mediaVideo, "video/quicktime"},
	"webm": {mediaVideo, "video/webm"},
	"ogv":  {mediaVideo, "video/ogg"},
	"avi":  {mediaVideo, "video/x-msvideo"},
	"wmv":  {mediaVideo, "video/x-ms-wmv"},
	"flv":  {mediaVideo, "video/x-flv"},
	"ts":   {mediaVideo, "video/mp2t"},
	"m2ts": {mediaVideo, "video/mp2t"},
	"mts":  {mediaVideo, "video/mp2t"},
	"mpg":  {mediaVideo, "video/mpeg"},
	"mpeg": {mediaVideo, "video/mpeg"},
	"3gp":  {mediaVideo, "video/3gpp"},
	"rmvb": {mediaVideo, "application/vnd.rn-realmedia-vbr"},
	"rm":   {mediaVideo, "application/vnd.rn-realmedia"},

	"mp3":  {mediaAudio, "audio/mpeg"},
	"wav":  {mediaAudio, "audio/wav"},
	"m4a":  {mediaAudio, "audio/mp4"},
	"m4b":  {mediaAudio, "audio/mp4"},
	"ogg":  {mediaAudio, "audio/ogg"},
	"oga":  {mediaAudio, "audio/ogg"},
	"opus": {mediaAudio, "audio/ogg"},
	"flac": {mediaAudio, "audio/flac"},
	"aac":  {mediaAudio, "audio/aac"},
	"wma":  {mediaAudio, "audio/x-ms-wma"},
	"aiff": {mediaAudio, "audio/aiff"},
	"aif":  {mediaAudio, "audio/aiff"},
	"caf":  {mediaAudio, "audio/x-caf"},
	"ape":  {mediaAudio, "audio/x-ape"},
	"wv":   {mediaAudio, "audio/x-wavpack"},
	"mka":  {mediaAudio, "audio/x-matroska"},
	"amr":  {mediaAudio, "audio/amr"},

	"pdf": {mediaPDF, "application/pdf"},
}

// extOf 统一扩展名格式：小写、不含前导点。允许传入带点的 filepath.Ext 结果。
func extOf(raw string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(raw)), ".")
}

// mediaFormatOfExt 按扩展名查表，未收录时返回 mediaNone。
func mediaFormatOfExt(raw string) (mediaFormat, bool) {
	f, ok := mediaFormats[extOf(raw)]
	return f, ok
}

// isAudioExt 判断扩展名是否为纯音频容器。
func isAudioExt(raw string) bool {
	f, ok := mediaFormatOfExt(raw)
	return ok && f.category == mediaAudio
}

// mediaMIME 返回扩展名对应的 MIME 类型，未知扩展名调用方自行兜底。
func mediaMIME(raw string) string {
	f, _ := mediaFormatOfExt(raw)
	return f.mime
}

// detectFileType 按扩展名判断媒体库文件类型，未知类型返回空串。
func detectFileType(name string) string {
	f, ok := mediaFormats[extOf(filepath.Ext(name))]
	if !ok {
		return ""
	}
	switch f.category {
	case mediaVideo:
		return "video"
	case mediaAudio:
		return "audio"
	case mediaPDF:
		return "pdf"
	default:
		return ""
	}
}
