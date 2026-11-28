package tts

import (
	"encoding/binary"
	"fmt"
	"math"
)

// wrapPCMAsWAV 给裸 PCM 数据加 44 字节标准 WAV 头。
// Piper 的 --output-raw 输出 16-bit little-endian 单声道 PCM，因此这里按采样率
// 和声道数计算字节率，不写临时文件。
func wrapPCMAsWAV(pcm []byte, sampleRate, channels int) ([]byte, error) {
	if len(pcm) == 0 {
		return nil, fmt.Errorf("本地 TTS 没有返回音频数据")
	}
	if sampleRate <= 0 {
		sampleRate = 22050
	}
	if channels <= 0 {
		channels = 1
	}
	const bitsPerSample = 16
	blockAlign := int64(channels * bitsPerSample / 8)
	sampleRate64 := int64(sampleRate)
	channels64 := int64(channels)
	byteRate := sampleRate64 * blockAlign

	dataSize := int64(len(pcm))
	totalSize := 36 + dataSize
	const maxUint32 = int64(math.MaxUint32)
	if dataSize <= 0 || dataSize > maxUint32 || totalSize > maxUint32 ||
		sampleRate64 <= 0 || sampleRate64 > maxUint32 ||
		byteRate <= 0 || byteRate > maxUint32 ||
		channels64 <= 0 || channels64 > math.MaxUint16 ||
		blockAlign <= 0 || blockAlign > math.MaxUint16 {
		return nil, fmt.Errorf("音频数据超出 WAV 头可表示范围")
	}
	out := make([]byte, 44+dataSize)

	copy(out[0:4], "RIFF")
	binary.LittleEndian.PutUint32(out[4:8], uint32(totalSize))
	copy(out[8:12], "WAVE")
	copy(out[12:16], "fmt ")
	binary.LittleEndian.PutUint32(out[16:20], 16) // fmt chunk size
	binary.LittleEndian.PutUint16(out[20:22], 1)  // PCM
	binary.LittleEndian.PutUint16(out[22:24], uint16(channels64))
	binary.LittleEndian.PutUint32(out[24:28], uint32(sampleRate64))
	binary.LittleEndian.PutUint32(out[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(out[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(out[34:36], bitsPerSample)
	copy(out[36:40], "data")
	binary.LittleEndian.PutUint32(out[40:44], uint32(dataSize))
	copy(out[44:], pcm)
	return out, nil
}
