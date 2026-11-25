package tts

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
)

// Edge-TTS 的 Sec-MS-GEC v2 令牌算法。它把 Windows 文件时间（按 5 分钟取整）
// 与 TrustedClientToken 拼接后，同时做 SHA-256 和 CS64 摘要，输出
// "<16 位十六进制>-<64 位十六进制>"。SHA-256/CS64 的常量与轮函数来自
// rany2/edge-tts 的 v2 实现（PR #492），必须逐位一致。

var sha256Initial = [8]uint32{
	0x6A09E667,
	0xBB67AE85,
	0x3C6EF372,
	0xA54FF53A,
	0x510E527F,
	0x9B05688C,
	0x1F83D9AB,
	0x5BE0CD19,
}

var sha256State = [8]uint32{
	0xFD9FBEA2,
	0x91243CE7,
	0xBE499094,
	0xCD2E1E0A,
	0x6C006F49,
	0x04BD35AB,
	0xFEB0A7E4,
	0x03EFFBD2,
}

var sha256Schedule = [14]uint32{
	0xEB24BF9E,
	0x1558691F,
	0xA0C09EE2,
	0x0CFA32BA,
	0xA622EE8C,
	0xD1DD9491,
	0xC0DD25A0,
	0xF9E70AB6,
	0xF0C31573,
	0x7058CE4E,
	0x7188E606,
	0x00E5AB33,
	0xD258B060,
	0x72766564,
}

var sha256RoundConstants = [64]uint32{
	0x428A2F98,
	0x71374491,
	0xB5C0FBCF,
	0xE9B5DBA5,
	0x3956C25B,
	0x59F111F1,
	0x923F82A4,
	0xAB1C5ED5,
	0xD807AA98,
	0x12835B01,
	0x243185BE,
	0x550C7DC3,
	0x72BE5D74,
	0x80DEB1FE,
	0x9BDC06A7,
	0xC19BF174,
	0xE49B69C1,
	0xEFBE4786,
	0x0FC19DC6,
	0x240CA1CC,
	0x2DE92C6F,
	0x4A7484AA,
	0x5CB0A9DC,
	0x76F988DA,
	0x983E5152,
	0xA831C66D,
	0xB00327C8,
	0xBF597FC7,
	0xC6E00BF3,
	0xD5A79147,
	0x06CA6351,
	0x14292967,
	0x27B70A85,
	0x2E1B2138,
	0x4D2C6DFC,
	0x53380D13,
	0x650A7354,
	0x766A0ABB,
	0x81C2C92E,
	0x92722C85,
	0xA2BFE8A1,
	0xA81A664B,
	0xC24B8B70,
	0xC76C51A3,
	0xD192E819,
	0xD6990624,
	0xF40E3585,
	0x106AA070,
	0x19A4C116,
	0x1E376C08,
	0x2748774C,
	0x34B0BCB5,
	0x391C0CB3,
	0x4ED8AA4A,
	0x5B9CCA4F,
	0x682E6FF3,
	0x748F82EE,
	0x78A5636F,
	0x84C87814,
	0x8CC70208,
	0x90BEFFFA,
	0xA4506CEB,
	0xBEF9A3F7,
	0xC67178F2,
}

const (
	sha256Adjustment        = 0xC9DC06A7
	sha256Sigma0Adjustment  = 0x059C0B80
	sha256Sigma1Adjustment  = 0x000B92C0
	cs64Factor              = 0x82893933
	cs64Adjustment0         = 0xF2F90B1A
	cs64Adjustment1         = 0x0B1A0000
	windowsFileTimeEpochSec = 11644473600
)

// sha256BlockConstants 与标准轮常量只差第 15 个常量（索引 14）。
var sha256BlockConstants = func() [64]uint32 {
	var result [64]uint32
	copy(result[:], sha256RoundConstants[:])
	result[14] = sha256Adjustment
	return result
}()

var cs64Coefficients = [14][2]uint32{
	{0xE82E91B1, 0xB32700D0},
	{0x44DE24C6, 0x88DFF51D},
	{0x3BEB65BC, 0x29514038},
	{0xC89C5933, 0xB328CBDF},
	{0x8D1EC211, 0xD405B4D5},
	{0x314EF5D5, 0x26E55F3C},
	{0xE92491B1, 0x607801C6},
	{0xF0A5B9D5, 0x82B2C1FB},
	{0x06064CF3, 0xFA51A3DA},
	{0xDA79FA60, 0x207CC464},
	{0xBED20560, 0x3C3C74F3},
	{0x89F9C9F8, 0xD2D14B61},
	{0x35FA38C6, 0xBB04A2C1},
	{0xCB49E3C6, 0xC5626167},
}

// rol16 把 32 位值循环左移 16 位。
func rol16(value uint32) uint32 {
	return value<<16 | value>>16
}

// sha256Sigma0 是 SHA-256 的小 sigma0。uint32 的移位与异或天然按 32 位截断，
// 与 Python 实现“最后一次 mask”等价。
func sha256Sigma0(value uint32) uint32 {
	return (value >> 7) ^ (value << 25) ^ (value >> 18) ^ (value << 14) ^ (value >> 3)
}

func sha256Sigma1(value uint32) uint32 {
	return (value >> 17) ^ (value << 15) ^ (value >> 19) ^ (value << 13) ^ (value >> 10)
}

// sha256BigSigma0/1 复用“乘以 2^32+1 后右移”的技巧计算 ROTR。
func sha256BigSigma0(value uint32) uint64 {
	rot := uint64(value) * 0x100000001
	return (rot >> 2) ^ (rot >> 13) ^ (rot >> 22)
}

func sha256BigSigma1(value uint32) uint64 {
	rot := uint64(value) * 0x100000001
	return (rot >> 6) ^ (rot >> 11) ^ (rot >> 25)
}

func sha256ExpandSchedule(words []uint32, firstWord int) {
	for index := firstWord; index < 64; index++ {
		x, y := words[index-2], words[index-15]
		sigma1 := (x >> 17) ^ (x << 15) ^ (x >> 19) ^ (x << 13) ^ (x >> 10)
		sigma0 := (y >> 7) ^ (y << 25) ^ (y >> 18) ^ (y << 14) ^ (y >> 3)
		words[index] = sigma1 + words[index-7] + sigma0 + words[index-16]
	}
}

const u32Mask = uint64(0xFFFFFFFF)

func sha256Rounds(state [8]uint32, words []uint32, firstRound int) [8]uint32 {
	a, b, c, d, e, f, g, h := state[0], state[1], state[2], state[3], state[4], state[5], state[6], state[7]
	constants := sha256RoundConstants[:]
	if firstRound == 14 {
		constants = sha256BlockConstants[:]
	}
	aligned := ((firstRound + 7) / 8) * 8
	if aligned > 64 {
		aligned = 64
	}
	for index := firstRound; index < aligned; index++ {
		t1 := uint64(h) +
			sha256BigSigma1(e) +
			uint64(g^(e&(f^g))) +
			uint64(constants[index]) +
			uint64(words[index])
		t2 := sha256BigSigma0(a) + uint64((a&b)|(c&(a|b)))
		newA := uint32((t1 + t2) & u32Mask)
		newD := uint32((uint64(d) + t1) & u32Mask)
		a, b, c, d, e, f, g, h = newA, a, b, c, newD, e, f, g
	}
	// 每 8 轮寄存器名称回到原位，因此用表达式轮换代替逐轮搬移。
	for index := aligned; index < 64; index += 8 {
		t1 := uint64(h) +
			sha256BigSigma1(e) +
			uint64(g^(e&(f^g))) +
			uint64(constants[index]) +
			uint64(words[index])
		d = uint32((uint64(d) + t1) & u32Mask)
		h = uint32((t1 + sha256BigSigma0(a) + uint64((a&b)|(c&(a|b)))) & u32Mask)

		t1 = uint64(g) +
			sha256BigSigma1(d) +
			uint64(f^(d&(e^f))) +
			uint64(constants[index+1]) +
			uint64(words[index+1])
		c = uint32((uint64(c) + t1) & u32Mask)
		g = uint32((t1 + sha256BigSigma0(h) + uint64((h&a)|(b&(h|a)))) & u32Mask)

		t1 = uint64(f) +
			sha256BigSigma1(c) +
			uint64(e^(c&(d^e))) +
			uint64(constants[index+2]) +
			uint64(words[index+2])
		b = uint32((uint64(b) + t1) & u32Mask)
		f = uint32((t1 + sha256BigSigma0(g) + uint64((g&h)|(a&(g|h)))) & u32Mask)

		t1 = uint64(e) +
			sha256BigSigma1(b) +
			uint64(d^(b&(c^d))) +
			uint64(constants[index+3]) +
			uint64(words[index+3])
		a = uint32((uint64(a) + t1) & u32Mask)
		e = uint32((t1 + sha256BigSigma0(f) + uint64((f&g)|(h&(f|g)))) & u32Mask)

		t1 = uint64(d) +
			sha256BigSigma1(a) +
			uint64(c^(a&(b^c))) +
			uint64(constants[index+4]) +
			uint64(words[index+4])
		h = uint32((uint64(h) + t1) & u32Mask)
		d = uint32((t1 + sha256BigSigma0(e) + uint64((e&f)|(g&(e|f)))) & u32Mask)

		t1 = uint64(c) +
			sha256BigSigma1(h) +
			uint64(b^(h&(a^b))) +
			uint64(constants[index+5]) +
			uint64(words[index+5])
		g = uint32((uint64(g) + t1) & u32Mask)
		c = uint32((t1 + sha256BigSigma0(d) + uint64((d&e)|(f&(d|e)))) & u32Mask)

		t1 = uint64(b) +
			sha256BigSigma1(g) +
			uint64(a^(g&(h^a))) +
			uint64(constants[index+6]) +
			uint64(words[index+6])
		f = uint32((uint64(f) + t1) & u32Mask)
		b = uint32((t1 + sha256BigSigma0(c) + uint64((c&d)|(e&(c|d)))) & u32Mask)

		t1 = uint64(a) +
			sha256BigSigma1(f) +
			uint64(h^(f&(g^h))) +
			uint64(constants[index+7]) +
			uint64(words[index+7])
		e = uint32((uint64(e) + t1) & u32Mask)
		a = uint32((t1 + sha256BigSigma0(b) + uint64((b&c)|(d&(b|c)))) & u32Mask)
	}
	return [8]uint32{a, b, c, d, e, f, g, h}
}

// sha256Init 计算令牌 SHA-256 的初始状态：前 7 个字节固定作为盐，
// 其余部分在 digest 中作为数据块继续处理。
func sha256Init(data []byte) [8]uint32 {
	words := make([]uint32, 64)
	words[14] = uint32(data[0])<<16 | uint32(data[1])<<8 | uint32(data[2])
	words[15] = uint32(data[3])<<24 | uint32(data[4])<<16 | uint32(data[5])<<8 | uint32(data[6])
	for index := 16; index < 30; index++ {
		value := uint64(sha256Schedule[index-16])
		if index-2 >= 14 {
			sigma := uint64(sha256Sigma1(words[index-2]))
			if index == 16 {
				sigma ^= uint64(sha256Sigma1Adjustment)
			}
			value += sigma
		}
		if index-7 >= 14 {
			value += uint64(words[index-7])
		}
		if index-15 >= 14 {
			sigma := uint64(sha256Sigma0(words[index-15]))
			if index == 29 {
				sigma ^= uint64(sha256Sigma0Adjustment)
			}
			value += sigma
		}
		words[index] = uint32(value & u32Mask)
	}
	words[30] = uint32((uint64(sha256Sigma1(words[28])) +
		uint64(words[23]) +
		uint64(sha256Sigma0(words[15])) +
		uint64(words[14]) +
		uint64(sha256Adjustment) -
		uint64(sha256RoundConstants[14])) & u32Mask)
	sha256ExpandSchedule(words, 31)

	working := sha256Rounds(sha256State, words, 14)
	var state [8]uint32
	for index := range state {
		state[index] = sha256Initial[index] + working[index]
	}
	return state
}

func tokenSHA256Digest(data []byte) ([]byte, error) {
	if len(data) < 7 {
		return nil, errors.New("token salt must contain at least seven bytes")
	}
	length := 57 + len(data)
	padded := make([]byte, 0, len(data)+72)
	padded = append(padded, data[7:]...)
	padded = append(padded, 0x80)
	pad := (55 - length) % 64
	if pad < 0 {
		pad += 64
	}
	padded = append(padded, make([]byte, pad)...)
	var lengthBytes [8]byte
	binary.BigEndian.PutUint64(lengthBytes[:], uint64(length)*8)
	padded = append(padded, lengthBytes[:]...)

	state := sha256Init(data[:7])
	for offset := 0; offset < len(padded); offset += 64 {
		words := make([]uint32, 64)
		for index := 0; index < 16; index++ {
			words[index] = binary.BigEndian.Uint32(padded[offset+index*4:])
		}
		sha256ExpandSchedule(words, 16)
		working := sha256Rounds(state, words, 0)
		for index := range state {
			state[index] += working[index]
		}
	}
	digest := make([]byte, 32)
	for index := 0; index < 8; index++ {
		binary.BigEndian.PutUint32(digest[index*4:], state[index])
	}
	return digest, nil
}

// wordsLE4Even 把数据按小端 32 位切分，不足 4 字节补零，并保证字数为偶数。
func wordsLE4Even(data []byte) []uint32 {
	padded := data
	if remainder := len(data) % 4; remainder != 0 {
		padded = make([]byte, len(data)+4-remainder)
		copy(padded, data)
	}
	if len(padded) == 0 {
		return nil
	}
	words := make([]uint32, len(padded)/4)
	for index := range words {
		words[index] = binary.LittleEndian.Uint32(padded[index*4:])
	}
	if len(words)%2 != 0 {
		words = append(words, 0)
	}
	return words
}

func cs64Digest(data, digest []byte) (uint32, uint32) {
	keyA := binary.LittleEndian.Uint32(digest[0:4]) | 1
	keyB := binary.LittleEndian.Uint32(digest[4:8]) | 1
	factors := [2]uint32{keyA * cs64Factor, keyB * cs64Factor}

	terms := make([]uint32, 0, len(cs64Coefficients)+32)
	offsets := make([]uint32, 0, len(cs64Coefficients)+32)
	for index, coefficient := range cs64Coefficients {
		terms = append(terms, coefficient[0]*factors[index%2])
		offsets = append(offsets, coefficient[1])
	}
	input := make([]byte, 0, len(data)+1)
	input = append(input, 0)
	input = append(input, data...)
	for index, word := range wordsLE4Even(input) {
		key := keyA
		multiplier := uint32(0xEF0569FB)
		if index%2 != 0 {
			key = keyB
			multiplier = 0xC31713DB
		}
		term := word * key
		offset := rol16(word) * multiplier
		if index == 0 {
			term += cs64Adjustment0 * factors[0]
			offset += cs64Adjustment1
		}
		terms = append(terms, term)
		offsets = append(offsets, offset)
	}

	var swapAcc, swapLast, state, acc uint32
	for index := 0; index < len(terms); index += 2 {
		x, y := terms[index], terms[index+1]
		t := rol16(offsets[index] + x)
		q := t * 0x76F50F34
		swapAcc += rol16(q)*0xC3EFEA97 + q
		t = rol16(offsets[index+1] + y)
		q = t * 0x1881CE3C
		swapLast = rol16(q)*0x35BD1EC9 + q
		swapAcc = swapAcc + swapLast

		state = state*keyA + x
		state = rol16(state) * 0xCF98B111
		state = rol16(state) * 0x87085B9F
		state = rol16(state) * 0x12CEB96D
		state = rol16(state) * 0x257E1D83
		acc += state
		t = state*keyB + y
		t = rol16(t) * 0xA27416F5
		t = rol16(t) * 0xD38396FF
		state = rol16(rol16(t)*0x7C932B89) * 0xBFA49F69
		acc = acc + state
	}
	return swapLast ^ state, swapAcc ^ acc
}

func edgeTokenHash(data []byte) (string, string, error) {
	digest, err := tokenSHA256Digest(data)
	if err != nil {
		return "", "", err
	}
	first, second := cs64Digest(data, digest)
	cs64Bytes := make([]byte, 8)
	binary.LittleEndian.PutUint32(cs64Bytes[0:], first)
	binary.LittleEndian.PutUint32(cs64Bytes[4:], second)
	return strings.ToUpper(hex.EncodeToString(cs64Bytes)),
		strings.ToUpper(hex.EncodeToString(digest)),
		nil
}

// generateSecMSGECV2 生成 Sec-MS-GEC v2 令牌。时间按 5 分钟窗口取整。
func generateSecMSGECV2(unixTimestamp float64) string {
	ticks := unixTimestamp
	ticks += windowsFileTimeEpochSec
	ticks -= math.Mod(ticks, 300)
	ticks *= 1e7
	strToHash := fmt.Sprintf("%.0f%s", ticks, edgeTrustedToken)
	cs64, sha256Value, err := edgeTokenHash([]byte(strToHash))
	if err != nil {
		return ""
	}
	return cs64 + "-" + sha256Value
}
