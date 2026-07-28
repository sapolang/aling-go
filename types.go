package main

type Word struct {
	ID           int     `json:"id"`
	Word         string  `json:"word"`
	Definition   string  `json:"definition"`
	Phonetic     string  `json:"phonetic"`
	Example      string  `json:"example"`
	Tags         string  `json:"tags"`
	Level        int     `json:"level"`
	NextReview   string  `json:"next_review"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
	Repetitions  int     `json:"repetitions"`
	EFactor      float64 `json:"efactor"`
	Interval     int     `json:"interval"`
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
	Dropped  int           `json:"dropped"`
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

type ArticleCategory struct {
	ID          int    `json:"id"`
	EnName      string `json:"enName"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Cover       string `json:"cover"`
	Length      int    `json:"length"`
}

type ArticleItem struct {
	ID             int    `json:"id"`
	CategoryEnName string `json:"categoryEnName"`
	Title          string `json:"title"`
	TitleTranslate string `json:"titleTranslate"`
	Text           string `json:"text"`
	TextTranslate  string `json:"textTranslate"`
	AudioSrc       string `json:"audioSrc"`
	LrcPosition    string `json:"lrcPosition"`
	QuestionJSON   string `json:"questionJson"`
	IndexOrder     int    `json:"indexOrder"`
}

type TypingRecord struct {
	ID        int     `json:"id"`
	ArticleID int     `json:"articleId"`
	Mode      string  `json:"mode"`
	Accuracy  float64 `json:"accuracy"`
	WPM       float64 `json:"wpm"`
	Duration  int     `json:"duration"`
	Mistakes  string  `json:"mistakes"`
	CreatedAt string  `json:"createdAt"`
}

type TypingProgress struct {
	ArticleID    int     `json:"articleId"`
	Mode         string  `json:"mode"`
	Position     int     `json:"position"`
	Completed    bool    `json:"completed"`
	BestAccuracy float64 `json:"bestAccuracy"`
	BestWPM      float64 `json:"bestWpm"`
	UpdatedAt    string  `json:"updatedAt"`
}

type DictAddResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}
