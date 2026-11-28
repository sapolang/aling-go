package tools

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLookup(t *testing.T) {
	for _, name := range []string{"ffmpeg", "yt-dlp", "whisper"} {
		tool, ok := Lookup(name)
		if !ok || tool.Name != name {
			t.Fatalf("Lookup(%q) = %+v, %v", name, tool, ok)
		}
	}
	if _, ok := Lookup("nope"); ok {
		t.Fatal("Lookup 不应找到未知工具")
	}
}

func TestRunListAndHelp(t *testing.T) {
	var out, errOut bytes.Buffer

	if code := Run("", []string{"list"}, &out, &errOut); code != 0 {
		t.Fatalf("tool list 退出码 = %d, want 0; stderr=%s", code, errOut.String())
	}
	list := out.String()
	for _, name := range []string{"ffmpeg", "yt-dlp", "whisper"} {
		if !strings.Contains(list, name) {
			t.Fatalf("tool list 缺少 %q: %s", name, list)
		}
	}

	out.Reset()
	if code := Run("", []string{"--help"}, &out, &errOut); code != 0 {
		t.Fatalf("tool --help 退出码 = %d, want 0", code)
	}
	if !strings.Contains(out.String(), "tool <名称>") {
		t.Fatalf("help 未包含用法: %s", out.String())
	}
}

func TestRunUnknownTool(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := Run("", []string{"nope"}, &out, &errOut); code != 2 {
		t.Fatalf("未知工具退出码 = %d, want 2", code)
	}
	if !strings.Contains(errOut.String(), "未知工具") {
		t.Fatalf("stderr 未提示未知工具: %s", errOut.String())
	}
}

func TestRunMissingBinary(t *testing.T) {
	// 用空数据目录 + 去掉 PATH 的临时环境，确保三个工具都找不到。
	t.Setenv("PATH", t.TempDir())
	var out, errOut bytes.Buffer
	if code := Run(t.TempDir(), []string{"ffmpeg"}, &out, &errOut); code != 1 {
		t.Fatalf("缺少二进制退出码 = %d, want 1; stderr=%s", code, errOut.String())
	}
	if !strings.Contains(errOut.String(), "未找到 ffmpeg") {
		t.Fatalf("stderr 未提示未找到: %s", errOut.String())
	}
}

// TestExecutePassthrough 验证参数、输出流与退出码原样透传。
// 用测试二进制自身作为被调工具，通过环境变量切换到 helper 模式。
func TestExecutePassthrough(t *testing.T) {
	if os.Getenv("TOOLS_TEST_HELPER") == "1" {
		fmt.Fprintln(os.Stdout, "helper-args:", strings.Join(os.Args[2:], "|"))
		fmt.Fprintln(os.Stderr, "helper-stderr")
		os.Exit(7)
	}

	var out, errOut bytes.Buffer
	t.Setenv("TOOLS_TEST_HELPER", "1")
	code := execute(os.Args[0], []string{"-test.run=TestExecutePassthrough", "alpha", "b c"}, "helper", &out, &errOut)
	if code != 7 {
		t.Fatalf("退出码 = %d, want 7; stderr=%s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "helper-args: alpha|b c") {
		t.Fatalf("参数未原样透传: %s", out.String())
	}
	if !strings.Contains(errOut.String(), "helper-stderr") {
		t.Fatalf("stderr 未透传: %s", errOut.String())
	}
}

func TestRunViaFakeBinaryOnPath(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "ffmpeg")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho fake-ffmpeg \"$@\"\nexit 3\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	var out, errOut bytes.Buffer
	code := Run(t.TempDir(), []string{"ffmpeg", "-i", "in.mp4", "out.wav"}, &out, &errOut)
	if code != 3 {
		t.Fatalf("退出码 = %d, want 3; stderr=%s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "fake-ffmpeg -i in.mp4 out.wav") {
		t.Fatalf("参数未透传: %s", out.String())
	}
}
