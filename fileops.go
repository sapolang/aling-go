package main

import (
	"os"
)

func (a *App) ReadTextFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func (a *App) WriteTextFile(path, content string) {
	os.WriteFile(path, []byte(content), 0644)
}
