package pdf

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildTestPDF 生成一个带正确 xref 偏移的最小 PDF，用于验证纯 Go 提取链路。
func buildTestPDF(text string) []byte {
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\nBT /F1 12 Tf 72 720 Td (%s) Tj ET\nendstream", len("BT /F1 12 Tf 72 720 Td ("+text+") Tj ET"), text),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}

	var b strings.Builder
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for i, obj := range objects {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xrefOffset := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n", len(objects)+1)
	b.WriteString("0000000000 65535 f \n")
	for _, offset := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xrefOffset)
	return []byte(b.String())
}

func TestExtractFileReadsPlainText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.pdf")
	if err := os.WriteFile(path, buildTestPDF("Hello world. This is a test."), 0o644); err != nil {
		t.Fatal(err)
	}

	extracted, err := ExtractFile(path)
	if err != nil {
		t.Fatalf("ExtractFile: %v", err)
	}
	if extracted.PageCount != 1 {
		t.Fatalf("页数 = %d, want 1", extracted.PageCount)
	}
	var all strings.Builder
	for _, page := range extracted.Pages {
		all.WriteString(page.Text)
	}
	if !strings.Contains(all.String(), "Hello world") {
		t.Fatalf("未提取到文本: %q", all.String())
	}
	sentences := BuildSentences(extracted.Pages)
	if len(sentences) == 0 {
		t.Fatal("未切分出句子")
	}
}
