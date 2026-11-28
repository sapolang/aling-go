package tools

import (
	"strings"
	"testing"
)

func TestShellQuote(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"/Applications/My App.app/Contents/MacOS/aling-go", "'/Applications/My App.app/Contents/MacOS/aling-go'"},
		{"/opt/a'b/bin", `'/opt/a'\''b/bin'`},
	}
	for _, tt := range tests {
		if got := shellQuote(tt.in); got != tt.want {
			t.Fatalf("shellQuote(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestAppleScriptQuote(t *testing.T) {
	got := appleScriptQuote(`mkdir -p "/usr/local/bin" && ln -sf x`)
	want := `"mkdir -p \"/usr/local/bin\" && ln -sf x"`
	if got != want {
		t.Fatalf("appleScriptQuote = %q, want %q", got, want)
	}
	if strings.Contains(got, "\n") {
		t.Fatal("AppleScript 命令不应含换行")
	}
}

func TestInstallHelpText(t *testing.T) {
	var out strings.Builder
	printUsage(&out)
	for _, name := range []string{"install-cli", "uninstall-cli"} {
		if !strings.Contains(out.String(), name) {
			t.Fatalf("帮助文本缺少 %q: %s", name, out.String())
		}
	}
}
