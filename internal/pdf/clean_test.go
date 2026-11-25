package pdf

import (
	"strings"
	"testing"
)

func TestCleanPageTextRepairsHyphenationAndPageNoise(t *testing.T) {
	raw := "The inter-\nnational team met in New York.\n12\nThey discussed self-\nEsteem and other topics.\nPage 3 of 10\n"
	got := CleanPageText(raw)
	if !strings.Contains(got, "international team") {
		t.Fatalf("断词未合并: %q", got)
	}
	if !strings.Contains(got, "self-Esteem") {
		t.Fatalf("大写断词应保留连字符: %q", got)
	}
	if strings.Contains(got, "12") || strings.Contains(got, "Page 3 of 10") {
		t.Fatalf("孤立页码未过滤: %q", got)
	}
}

func TestCleanPageTextKeepsParagraphBreaks(t *testing.T) {
	raw := "First paragraph.\n\nSecond paragraph."
	got := CleanPageText(raw)
	if got != "First paragraph.\n\nSecond paragraph." {
		t.Fatalf("段落分隔被破坏: %q", got)
	}
}

func TestSplitSentencesAbbreviationsDecimalsAndQuotes(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []string
	}{
		{
			name: "abbreviations",
			text: "Mr. Smith went to Washington. Dr. Lee stayed home.",
			want: []string{"Mr. Smith went to Washington.", "Dr. Lee stayed home."},
		},
		{
			name: "country abbreviation",
			text: "He lives near the U.S. Army base.",
			want: []string{"He lives near the U.S. Army base."},
		},
		{
			name: "initials",
			text: "J. K. Rowling wrote the book.",
			want: []string{"J. K. Rowling wrote the book."},
		},
		{
			name: "decimal",
			text: "The value is 3.14 exactly. Then it changes.",
			want: []string{"The value is 3.14 exactly.", "Then it changes."},
		},
		{
			name: "ellipsis",
			text: "Wait... what happened?",
			want: []string{"Wait... what happened?"},
		},
		{
			name: "quote belongs to sentence",
			text: `He said "Hello." Then he left.`,
			want: []string{`He said "Hello."`, "Then he left."},
		},
		{
			name: "latin abbreviation",
			text: "I.e. this stays together. Next sentence.",
			want: []string{"I.e. this stays together.", "Next sentence."},
		},
		{
			name: "currency decimal",
			text: "It costs $3.50. Next item.",
			want: []string{"It costs $3.50.", "Next item."},
		},
		{
			name: "paragraph heading",
			text: "Chapter 1\n\nSome text follows.",
			want: []string{"Chapter 1", "Some text follows."},
		},
		{
			name: "question and exclamation",
			text: "Really?! Yes!",
			want: []string{"Really?!", "Yes!"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SplitSentences(tc.text)
			if len(got) != len(tc.want) {
				t.Fatalf("SplitSentences(%q) = %#v, want %#v", tc.text, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("第 %d 句 = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestSplitLongSentence(t *testing.T) {
	text := strings.Repeat("word ", 200)
	parts := SplitLongSentence(text, 100)
	if len(parts) < 2 {
		t.Fatalf("超长句未切分: %#v", parts)
	}
	for _, part := range parts {
		if len([]rune(part)) > 101 {
			t.Fatalf("切分后仍过长: %d", len([]rune(part)))
		}
	}
}

func TestBuildSentencesKeepsPageNumbers(t *testing.T) {
	pages := []PageText{
		{Page: 1, Text: "First page sentence. Another one."},
		{Page: 2, Text: "Second page sentence."},
	}
	sentences := BuildSentences(pages)
	if len(sentences) != 3 {
		t.Fatalf("句子数量 = %d, want 3: %#v", len(sentences), sentences)
	}
	if sentences[0].Page != 1 || sentences[2].Page != 2 {
		t.Fatalf("页码映射错误: %#v", sentences)
	}
	if sentences[2].Index != 3 {
		t.Fatalf("索引应从 1 连续递增: %#v", sentences)
	}
}
