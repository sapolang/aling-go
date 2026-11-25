package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"aling-go/internal/core"
	"aling-go/internal/pdf"
	"aling-go/internal/store/userdb"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// 同一个进程里可能同时有媒体库导入和精听页懒加载在解析同一本 PDF，
// 用包级互斥锁保证句子表不会被两次导入交叉写入。
var pdfIndexMu sync.Mutex

// PDFService 负责 PDF 导入、句子缓存和阅读进度。
type PDFService struct {
	app     *application.App
	dataDir string
}

func NewPDFService(app *application.App, dataDir string) *PDFService {
	return &PDFService{app: app, dataDir: dataDir}
}

func (s *PDFService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}

func (s *PDFService) ServiceShutdown() error { return nil }

// PDFImport 解析指定 PDF 并用最新结果替换旧句子缓存。
func (s *PDFService) PDFImport(path string) PDFImportResult {
	doc, err := importPDFFile(s.dataDir, path)
	if err != nil {
		loggerOf(s.app).Warn("pdf import", "path", path, "error", err)
		return PDFImportResult{OK: false, Error: err.Error(), Path: path}
	}
	return PDFImportResult{
		OK:            true,
		Path:          doc.Path,
		Title:         doc.Title,
		PageCount:     doc.PageCount,
		SentenceCount: doc.SentenceCount,
	}
}

// PDFLoad 返回精听页所需文档；首次打开尚未索引的 PDF 时会即时解析并落库。
func (s *PDFService) PDFLoad(path string) PDFLoadResult {
	if err := validatePDFPath(path); err != nil {
		return PDFLoadResult{OK: false, Error: err.Error()}
	}

	doc, err := s.loadDocument(path)
	if err == nil {
		return PDFLoadResult{OK: true, Document: doc}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PDFLoadResult{OK: false, Error: err.Error()}
	}

	indexed, err := importPDFFile(s.dataDir, path)
	if err != nil {
		return PDFLoadResult{OK: false, Error: err.Error()}
	}
	return PDFLoadResult{OK: true, Document: indexed}
}

// PDFList 返回已索引的 PDF，最近更新的排在前面。
func (s *PDFService) PDFList() []PDFDocumentSummary {
	rows, err := q().ListPDFDocuments(context.Background())
	if err != nil {
		loggerOf(s.app).Error("pdf list", "error", err)
		return []PDFDocumentSummary{}
	}
	out := make([]PDFDocumentSummary, 0, len(rows))
	for _, row := range rows {
		// 原文件已被移动/删除的条目不再出现在精听列表里。
		if _, err := os.Stat(row.Path); err != nil {
			continue
		}
		out = append(out, PDFDocumentSummary{
			Path:          row.Path,
			Title:         row.Title,
			PageCount:     int(row.PageCount),
			SentenceCount: int(row.SentenceCount),
			LastSentence:  int(row.LastSentence),
			UpdatedAt:     row.UpdatedAt,
		})
	}
	return out
}

// PDFUpdateProgress 保存当前句下标（从 0 开始），用于下次打开时继续。
func (s *PDFService) PDFUpdateProgress(path string, sentenceIndex int) {
	if sentenceIndex < 0 {
		sentenceIndex = 0
	}
	ctx := context.Background()
	row, err := q().GetPDFDocumentByPath(ctx, path)
	if err != nil {
		return
	}
	if err := q().UpdatePDFProgress(ctx, userdb.UpdatePDFProgressParams{
		LastSentence: int64(sentenceIndex),
		ID:           row.ID,
	}); err != nil {
		loggerOf(s.app).Warn("pdf update progress", "path", path, "error", err)
	}
}

// PDFRemove 删除句子索引和阅读进度；不删除原 PDF 文件。
func (s *PDFService) PDFRemove(path string) {
	ctx := context.Background()
	row, err := q().GetPDFDocumentByPath(ctx, path)
	if err != nil {
		return
	}
	if err := q().DeletePDFSentences(ctx, row.ID); err != nil {
		loggerOf(s.app).Warn("pdf remove sentences", "path", path, "error", err)
	}
	if err := q().DeletePDFDocument(ctx, row.ID); err != nil {
		loggerOf(s.app).Warn("pdf remove document", "path", path, "error", err)
	}
}

func (s *PDFService) loadDocument(path string) (PDFDocument, error) {
	ctx := context.Background()
	row, err := q().GetPDFDocumentByPath(ctx, path)
	if err != nil {
		return PDFDocument{}, err
	}
	rows, err := q().ListPDFSentences(ctx, row.ID)
	if err != nil {
		return PDFDocument{}, err
	}
	sentences := make([]PDFSentence, 0, len(rows))
	for _, item := range rows {
		sentences = append(sentences, PDFSentence{
			Index: int(item.Idx) - 1,
			Page:  int(item.Page),
			Text:  item.Text,
		})
	}
	return PDFDocument{
		Path:          row.Path,
		Title:         row.Title,
		PageCount:     int(row.PageCount),
		SentenceCount: int(row.SentenceCount),
		LastSentence:  int(row.LastSentence),
		Sentences:     sentences,
	}, nil
}

// importPDFFile 解析并落库。提取在事务外完成，避免长时间占用 SQLite 的单写连接。
func importPDFFile(dataDir, path string) (PDFDocument, error) {
	pdfIndexMu.Lock()
	defer pdfIndexMu.Unlock()

	if err := validatePDFPath(path); err != nil {
		return PDFDocument{}, err
	}
	extracted, err := pdf.ExtractFile(path)
	if err != nil {
		return PDFDocument{}, err
	}
	sentences := pdf.BuildSentences(extracted.Pages)
	if len(sentences) == 0 {
		return PDFDocument{}, fmt.Errorf("没有从 PDF 中提取到可用句子")
	}

	ctx := context.Background()
	tx, err := core.DB.BeginTx(ctx, nil)
	if err != nil {
		return PDFDocument{}, err
	}
	defer func() { _ = tx.Rollback() }()
	txq := userdb.New(tx)

	row, err := txq.UpsertPDFDocument(ctx, userdb.UpsertPDFDocumentParams{
		Path:          path,
		Title:         extracted.Title,
		PageCount:     int64(extracted.PageCount),
		SentenceCount: int64(len(sentences)),
	})
	if err != nil {
		return PDFDocument{}, err
	}
	if err := txq.DeletePDFSentences(ctx, row.ID); err != nil {
		return PDFDocument{}, err
	}
	for _, sentence := range sentences {
		if err := txq.InsertPDFSentence(ctx, userdb.InsertPDFSentenceParams{
			DocumentID: row.ID,
			Page:       int64(sentence.Page),
			Idx:        int64(sentence.Index),
			Text:       sentence.Text,
		}); err != nil {
			return PDFDocument{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return PDFDocument{}, err
	}

	out := make([]PDFSentence, 0, len(sentences))
	for _, sentence := range sentences {
		out = append(out, PDFSentence{Index: sentence.Index - 1, Page: sentence.Page, Text: sentence.Text})
	}
	return PDFDocument{
		Path:          path,
		Title:         extracted.Title,
		PageCount:     extracted.PageCount,
		SentenceCount: len(sentences),
		LastSentence:  int(row.LastSentence),
		Sentences:     out,
	}, nil
}

func validatePDFPath(path string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("PDF 路径为空")
	}
	if !strings.EqualFold(filepath.Ext(path), ".pdf") {
		return fmt.Errorf("仅支持 PDF 文件")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("找不到 PDF 文件：%w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("不能导入文件夹")
	}
	if info.Size() == 0 {
		return fmt.Errorf("PDF 文件为空")
	}
	return nil
}
