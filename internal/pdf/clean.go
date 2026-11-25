// Package pdf 负责从 PDF 中提取纯文本，并清洗排版噪音后切分为适合逐句朗读的句子。
//
// 这里不生成任何音频或整本缓存：导入时只产出句子列表，播放由前端按句请求 TTS。
package pdf

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	// 孤立页码：12、- 12 -、Page 12、12 / 200 等
	pageNumberLine = regexp.MustCompile(`(?i)^\s*(?:page\s+|p\.\s*)?[-–—]?\s*\d{1,4}\s*(?:(?:/|of)\s*\d{1,4})?\s*[-–—]?\s*$`)
	// 小写单词在行尾被连字符拆开：inter-\nnational -> international
	lowerHyphenBreak = regexp.MustCompile(`([\p{L}])-\s*\n\s*([\p{Ll}])`)
	// 大写开头时保留连字符，只去掉换行：self-\nEsteem -> self-Esteem
	keepHyphenBreak    = regexp.MustCompile(`([\p{L}])-\s*\n\s*([\p{Lu}])`)
	multiSpace         = regexp.MustCompile(`[ \t]{2,}`)
	spaceBeforePunct   = regexp.MustCompile(`\s+([,.;:!?])`)
	unsupportedControl = regexp.MustCompile(`[\x00-\x08\x0b\x0c\x0e-\x1f]`)
	onlyPunctuation    = regexp.MustCompile(`^[\p{P}\p{S}\s]+$`)
	dottedAcronym      = regexp.MustCompile(`^(?:[\p{L}]\.)+$`)
	singleInitial      = regexp.MustCompile(`^[\p{Lu}]$`)
)

// 常见缩写：这些词后面的句点不单独断句。
// 只收录跨语言 PDF 中高频、误判代价低的词，避免把普通短词（如 no）当成缩写。
var abbreviations = map[string]bool{
	"mr": true, "mrs": true, "ms": true, "dr": true, "prof": true,
	"sr": true, "jr": true, "st": true, "mt": true, "vs": true,
	"etc": true, "e.g": true, "i.e": true, "a.m": true, "p.m": true,
	"u.s": true, "u.k": true, "e.u": true, "u.s.a": true, "u.n": true,
	"fig": true, "figs": true, "ch": true, "chap": true, "vol": true,
	"inc": true, "ltd": true, "dept": true, "govt": true, "approx": true,
	"jan": true, "feb": true, "mar": true, "apr": true, "jun": true,
	"jul": true, "aug": true, "sep": true, "sept": true, "oct": true,
	"nov": true, "dec": true, "ph.d": true, "b.c": true, "a.d": true,
	"cf": true,
}

// CleanPageText 合并软换行、修复断词连字符、过滤孤立页码，并保留段落分隔。
func CleanPageText(raw string) string {
	text := strings.ReplaceAll(raw, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = strings.ReplaceAll(text, "\u00a0", " ")
	text = strings.ReplaceAll(text, "\u00ad", "")
	text = strings.NewReplacer(
		"\ufb00", "ff",
		"\ufb01", "fi",
		"\ufb02", "fl",
		"\ufb03", "ffi",
		"\ufb04", "ffl",
		"\ufb05", "st",
		"\ufb06", "st",
	).Replace(text)
	// 零宽字符和 PDF 控制字符对朗读没有意义，先清掉再处理断行。
	text = strings.Map(func(r rune) rune {
		switch r {
		case '\u200b', '\u200c', '\u200d', '\ufeff':
			return -1
		}
		return r
	}, text)
	text = unsupportedControl.ReplaceAllString(text, "")

	text = lowerHyphenBreak.ReplaceAllString(text, "$1$2")
	text = keepHyphenBreak.ReplaceAllString(text, "$1-$2")

	var b strings.Builder
	blank := true
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.ReplaceAll(rawLine, "\t", " "))
		line = multiSpace.ReplaceAllString(line, " ")
		if line == "" {
			if !blank {
				b.WriteString("\n\n")
			}
			blank = true
			continue
		}
		// 单行页码、页码分隔符是排版噪音，整行丢弃。
		if pageNumberLine.MatchString(line) {
			continue
		}
		if !blank {
			b.WriteByte(' ')
		}
		b.WriteString(line)
		blank = false
	}

	cleaned := b.String()
	cleaned = multiSpace.ReplaceAllString(cleaned, " ")
	cleaned = spaceBeforePunct.ReplaceAllString(cleaned, "$1")
	return strings.TrimSpace(cleaned)
}

// SplitSentences 按 . ? ! 切分句子，并排除常见缩写、首字母缩写、小数点和省略号。
// 段落空行视为强制边界，避免没有标点的标题粘到下一段。
func SplitSentences(text string) []string {
	var out []string
	for _, paragraph := range strings.Split(text, "\n\n") {
		paragraph = strings.TrimSpace(paragraph)
		if paragraph == "" {
			continue
		}
		out = append(out, splitParagraph([]rune(paragraph))...)
	}
	return out
}

func splitParagraph(runes []rune) []string {
	var out []string
	start := 0
	i := 0
	for i < len(runes) {
		c := runes[i]
		if (c == '.' || c == '!' || c == '?') && isSentenceEnd(runes, i) {
			end := i + 1
			// 句号后的引号、括号属于当前句。
			for end < len(runes) && isClosingRune(runes[end]) {
				end++
			}
			if sentence := strings.TrimSpace(string(runes[start:end])); sentence != "" {
				out = append(out, sentence)
			}
			j := end
			for j < len(runes) && unicode.IsSpace(runes[j]) {
				j++
			}
			start = j
			i = j
			continue
		}
		i++
	}
	if start < len(runes) {
		if sentence := strings.TrimSpace(string(runes[start:])); sentence != "" {
			out = append(out, sentence)
		}
	}

	// 清理纯符号行，并给没有标点的长段落兜底切分，避免单句音频过长。
	filtered := make([]string, 0, len(out))
	for _, sentence := range out {
		sentence = strings.TrimSpace(sentence)
		if sentence == "" || onlyPunctuation.MatchString(sentence) || !hasLetterOrDigit(sentence) {
			continue
		}
		filtered = append(filtered, SplitLongSentence(sentence, 600)...)
	}
	return filtered
}

func isSentenceEnd(runes []rune, i int) bool {
	c := runes[i]

	// 3.14、1.2.3 这类数字中的点不是句末。
	if c == '.' && i > 0 && i+1 < len(runes) && unicode.IsDigit(runes[i-1]) && unicode.IsDigit(runes[i+1]) {
		return false
	}
	// 省略号内部不切分，最后一个点再判断。
	if c == '.' && ((i > 0 && runes[i-1] == '.') || (i+1 < len(runes) && runes[i+1] == '.')) {
		return false
	}

	j := i + 1
	for j < len(runes) && isClosingRune(runes[j]) {
		j++
	}
	if j < len(runes) && !unicode.IsSpace(runes[j]) {
		return false
	}
	if j >= len(runes) {
		return true
	}

	k := j
	for k < len(runes) && unicode.IsSpace(runes[k]) {
		k++
	}
	if k >= len(runes) {
		return true
	}

	if c == '.' {
		word := wordBefore(runes, i)
		normalized := strings.ToLower(strings.TrimSuffix(word, "."))
		if abbreviations[normalized] {
			return false
		}
		// J. K. Rowling：单个大写字母后的点通常是姓名首字母。
		if singleInitial.MatchString(strings.TrimSuffix(word, ".")) && unicode.IsUpper(runes[k]) {
			return false
		}
		// U.S. / A.B.C. 这类带点的缩写。
		if dottedAcronym.MatchString(word) && normalized != "" {
			return false
		}
		// 句点后接小写字母时通常是缩写或列举，不在这里断句。
		if unicode.IsLower(runes[k]) {
			return false
		}
	}
	return true
}

// wordBefore 返回句点前连续的字母、数字和点，用于识别缩写。
func wordBefore(runes []rune, i int) string {
	start := i
	for start > 0 {
		r := runes[start-1]
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '\'' || r == '’' {
			start--
			continue
		}
		break
	}
	return string(runes[start:i])
}

func isClosingRune(r rune) bool {
	switch r {
	case '"', '\'', '”', '’', ')', ']', '}', '》', '」', '』':
		return true
	}
	return false
}

func hasLetterOrDigit(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

// SplitLongSentence 把没有标点的超长句在空格或逗号处切开，保证单句 TTS 能在合理时间内完成。
func SplitLongSentence(s string, maxRunes int) []string {
	runes := []rune(strings.TrimSpace(s))
	if maxRunes <= 0 || len(runes) <= maxRunes {
		return []string{strings.TrimSpace(s)}
	}

	var out []string
	for len(runes) > maxRunes {
		cut := maxRunes
		for cut > maxRunes/2 && !unicode.IsSpace(runes[cut]) && !strings.ContainsRune(",;:，；：", runes[cut]) {
			cut--
		}
		if cut <= maxRunes/2 {
			cut = maxRunes
		}
		piece := strings.TrimSpace(string(runes[:cut+1]))
		if piece != "" {
			out = append(out, piece)
		}
		runes = []rune(strings.TrimSpace(string(runes[cut+1:])))
	}
	if len(runes) > 0 {
		if piece := strings.TrimSpace(string(runes)); piece != "" {
			out = append(out, piece)
		}
	}
	if len(out) == 0 {
		return []string{strings.TrimSpace(s)}
	}
	return out
}
