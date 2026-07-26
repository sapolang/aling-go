package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
)

const waveformSampleCount = 1000

func (a *App) GetWaveformData(filePath string) []float64 {
	cacheDir := filepath.Join(a.dataDir, "aling", "waveforms")
	os.MkdirAll(cacheDir, 0755)
	cacheKey := md5Hash(filePath)
	cachePath := filepath.Join(cacheDir, cacheKey+".json")

	if data, err := os.ReadFile(cachePath); err == nil {
		var result []float64
		if json.Unmarshal(data, &result) == nil {
			return result
		}
	}

	ffmpeg := a.findFFmpeg()
	if ffmpeg == "" {
		fmt.Println("GetWaveformData: ffmpeg not found")
		return nil
	}

	cmd := exec.Command(ffmpeg,
		"-i", filePath,
		"-ac", "1",
		"-f", "f32le",
		"-ar", "8000",
		"pipe:1",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Println("GetWaveformData: stdout pipe error:", err)
		return nil
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Println("GetWaveformData: stderr pipe error:", err)
		return nil
	}

	if err := cmd.Start(); err != nil {
		fmt.Println("GetWaveformData: start error:", err)
		return nil
	}

	go io.Copy(io.Discard, stderr)

	rawBytes, err := io.ReadAll(stdout)
	if err != nil {
		fmt.Println("GetWaveformData: read error:", err)
		return nil
	}

	cmd.Wait()

	if len(rawBytes) == 0 {
		return nil
	}

	sampleCount := len(rawBytes) / 4
	if sampleCount == 0 {
		return nil
	}

	samplesPerSegment := float64(sampleCount) / float64(waveformSampleCount)
	result := make([]float64, waveformSampleCount)

	for i := 0; i < waveformSampleCount; i++ {
		start := int(float64(i) * samplesPerSegment)
		end := int(float64(i+1) * samplesPerSegment)
		if end > sampleCount {
			end = sampleCount
		}
		if start >= end {
			result[i] = 0
			continue
		}
		peak := float64(0)
		for j := start; j < end; j++ {
			bits := binary.LittleEndian.Uint32(rawBytes[j*4 : (j+1)*4])
			val := math.Abs(float64(math.Float32frombits(bits)))
			if val > peak {
				peak = val
			}
		}
		result[i] = peak
	}

	maxVal := float64(0)
	for _, v := range result {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal > 0 {
		for i := range result {
			result[i] = result[i] / maxVal
		}
	}

	jsonBytes, err := json.Marshal(result)
	if err == nil {
		os.WriteFile(cachePath, jsonBytes, 0644)
	}

	return result
}
