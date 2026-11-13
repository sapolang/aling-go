package content

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

// RecentEntry 是最近打开列表的一项，供前端直接渲染。
type RecentEntry struct {
	Path         string  `json:"path"`
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	LastPosition float64 `json:"lastPosition,omitempty"`
}

type LibraryImportResult struct {
	Files    []LibraryFile `json:"files"`
	Imported int           `json:"imported"`
	Skipped  int           `json:"skipped"`
	Dropped  int           `json:"dropped"`
}

type LibraryFile struct {
	Path         string  `json:"path"`
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	FolderID     string  `json:"folderId"`
	AddedAt      string  `json:"addedAt"`
	LastPosition float64 `json:"lastPosition,omitempty"`
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
