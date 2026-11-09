package system

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
)

// trayTemplateIcon 从彩色应用图标中提取深色笔画，生成 macOS 菜单栏模板图标。
// 模板图标只使用 alpha 通道，系统会自动适配浅色/深色菜单栏。
func TrayTemplateIcon(src []byte) ([]byte, error) {
	img, err := png.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, fmt.Errorf("decode icon: %w", err)
	}
	bounds := img.Bounds()
	side := bounds.Dx()
	if bounds.Dy() < side {
		side = bounds.Dy()
	}
	// 裁掉图标外圈留白，聚焦中间的图形主体
	crop := side * 72 / 100
	x0 := bounds.Min.X + (bounds.Dx()-crop)/2
	y0 := bounds.Min.Y + (bounds.Dy()-crop)/2

	const size = 44 // 22pt @2x
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := range size {
		for x := range size {
			sx := x0 + x*crop/size
			sy := y0 + y*crop/size
			r, g, b, _ := img.At(sx, sy).RGBA()
			lum := (int(r>>8)*299 + int(g>>8)*587 + int(b>>8)*114) / 1000
			alpha := uint8(0)
			if lum < 150 {
				alpha = 255
			}
			out.SetNRGBA(x, y, color.NRGBA{A: alpha})
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, fmt.Errorf("encode icon: %w", err)
	}
	return buf.Bytes(), nil
}
