package pdf

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	pdfreader "github.com/dslipak/pdf"
)

// PageText 是清洗后的一页文本。
type PageText struct {
	Page int
	Text string
}

// Extracted 是整本 PDF 的提取结果。
type Extracted struct {
	Title     string
	PageCount int
	Pages     []PageText
}

// Sentence 是最终落库的朗读单元。Index 从 1 开始，跨页连续。
type Sentence struct {
	Index int
	Page  int
	Text  string
}

// ExtractFile 使用纯 Go 解析器读取 PDF 文本。扫描版 PDF 没有文本层时返回明确错误，
// 由调用方提示用户改用 OCR 或其它素材。
func ExtractFile(path string) (result Extracted, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("解析 PDF 失败：%v", r)
		}
	}()

	f, err := os.Open(path)
	if err != nil {
		return Extracted{}, fmt.Errorf("打开 PDF 失败：%w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Extracted{}, fmt.Errorf("读取 PDF 信息失败：%w", err)
	}
	reader, err := pdfreader.NewReader(f, info.Size())
	if err != nil {
		return Extracted{}, fmt.Errorf("解析 PDF 失败：%w", err)
	}

	title := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	pageCount := reader.NumPage()
	if pageCount <= 0 {
		return Extracted{}, fmt.Errorf("PDF 没有可读取的页面")
	}

	pages := make([]PageText, 0, pageCount)
	for pageNum := 1; pageNum <= pageCount; pageNum++ {
		raw, ok := readPage(reader, pageNum)
		if !ok {
			continue
		}
		cleaned := CleanPageText(raw)
		if cleaned == "" {
			continue
		}
		pages = append(pages, PageText{Page: pageNum, Text: cleaned})
	}

	if len(pages) == 0 {
		return Extracted{}, fmt.Errorf("没有从 PDF 中提取到文本，可能是扫描版或受保护的 PDF")
	}
	return Extracted{Title: title, PageCount: pageCount, Pages: pages}, nil
}

func readPage(reader *pdfreader.Reader, pageNum int) (text string, ok bool) {
	defer func() {
		if recover() != nil {
			text = ""
			ok = false
		}
	}()

	page := reader.Page(pageNum)
	if page.V.IsNull() {
		return "", false
	}
	// fonts 传 nil，由库内部按页自行解析字体映射。跨页共享字体缓存会在不同页用
	// 同名资源（如 /F1）指向不同字体时产出无报错的乱码句子。
	value, err := page.GetPlainText(nil)
	if err != nil {
		return "", false
	}
	return value, true
}

// BuildSentences 把逐页文本切成连续的句子列表，并在页内保留页码。
func BuildSentences(pages []PageText) []Sentence {
	sentences := make([]Sentence, 0, len(pages)*8)
	index := 1
	for _, page := range pages {
		for _, text := range SplitSentences(page.Text) {
			for _, part := range SplitLongSentence(text, 600) {
				part = strings.TrimSpace(part)
				if part == "" {
					continue
				}
				sentences = append(sentences, Sentence{Index: index, Page: page.Page, Text: part})
				index++
			}
		}
	}
	return sentences
}
