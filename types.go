package main

type Word struct {
	ID         int    `json:"id"`
	Word       string `json:"word"`
	Definition string `json:"definition"`
	Phonetic   string `json:"phonetic"`
	Example    string `json:"example"`
	Tags       string `json:"tags"`
	Level      int    `json:"level"`
	NextReview string `json:"next_review"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type Tag struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type SubtitleItem struct {
	ID        int     `json:"id"`
	StartTime float64 `json:"startTime"`
	EndTime   float64 `json:"endTime"`
	Text      string  `json:"text"`
}

type WhisperStatus struct {
	Loaded  bool   `json:"loaded"`
	Loading bool   `json:"loading"`
	Model   string `json:"model"`
}

type RecentFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type ImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

type LibraryImportResult struct {
	Files    []LibraryFile `json:"files"`
	Imported int           `json:"imported"`
	Skipped  int           `json:"skipped"`
}

type LibraryFile struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	FolderID string `json:"folderId"`
	AddedAt  string `json:"addedAt"`
}

type Folder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	ParentID  string `json:"parentId"`
}

type LibraryData struct {
	Folders []Folder      `json:"folders"`
	Files   []LibraryFile `json:"files"`
}
