package content

import "testing"

func TestBilibiliFeedTitle(t *testing.T) {
	tests := []struct {
		name     string
		nickname string
		mid      string
		want     string
	}{
		{name: "有昵称时使用昵称", nickname: "英语兔", mid: "483162496", want: "英语兔"},
		{name: "昵称带空白时去除空白", nickname: "  英语兔  ", mid: "483162496", want: "英语兔"},
		{name: "昵称获取失败时回退到 mid", nickname: "", mid: "483162496", want: "Bilibili UP主 483162496"},
		{name: "昵称为空白时回退到 mid", nickname: "   ", mid: "483162496", want: "Bilibili UP主 483162496"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := bilibiliFeedTitle(tt.nickname, tt.mid); got != tt.want {
				t.Errorf("bilibiliFeedTitle(%q, %q) = %q, want %q", tt.nickname, tt.mid, got, tt.want)
			}
		})
	}
}
