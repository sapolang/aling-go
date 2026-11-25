package content

// PDFSentence 是 PDF 精听列表中的一句。
type PDFSentence struct {
	Index int    `json:"index"`
	Page  int    `json:"page"`
	Text  string `json:"text"`
}

// PDFDocument 是前端精听页需要的完整文档：元信息 + 句子列表。
type PDFDocument struct {
	Path          string        `json:"path"`
	Title         string        `json:"title"`
	PageCount     int           `json:"pageCount"`
	SentenceCount int           `json:"sentenceCount"`
	LastSentence  int           `json:"lastSentence"`
	Sentences     []PDFSentence `json:"sentences"`
}

// PDFDocumentSummary 用于列表展示，不携带句子正文。
type PDFDocumentSummary struct {
	Path          string `json:"path"`
	Title         string `json:"title"`
	PageCount     int    `json:"pageCount"`
	SentenceCount int    `json:"sentenceCount"`
	LastSentence  int    `json:"lastSentence"`
	UpdatedAt     string `json:"updatedAt"`
}

// PDFImportResult 是导入/重新解析 PDF 的结果。
type PDFImportResult struct {
	OK            bool   `json:"ok"`
	Error         string `json:"error"`
	Path          string `json:"path"`
	Title         string `json:"title"`
	PageCount     int    `json:"pageCount"`
	SentenceCount int    `json:"sentenceCount"`
}

// PDFLoadResult 同时携带成功数据和可展示的错误信息，避免前端只拿到 Promise 异常。
type PDFLoadResult struct {
	OK       bool        `json:"ok"`
	Error    string      `json:"error"`
	Document PDFDocument `json:"document"`
}
