package study

type Word struct {
	ID          int     `json:"id"`
	Word        string  `json:"word"`
	Definition  string  `json:"definition"`
	Phonetic    string  `json:"phonetic"`
	Example     string  `json:"example"`
	Tags        string  `json:"tags"`
	Level       int     `json:"level"`
	NextReview  string  `json:"next_review"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
	Repetitions int     `json:"repetitions"`
	EFactor     float64 `json:"efactor"`
	Interval    int     `json:"interval"`
}

type Tag struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type ImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

type DailyReview struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type LearningStats struct {
	TotalReviews int           `json:"totalReviews"`
	TodayReviews int           `json:"todayReviews"`
	Streak       int           `json:"streak"`
	TotalWords   int           `json:"totalWords"`
	Mastered     int           `json:"mastered"`
	Daily        []DailyReview `json:"daily"`
}

type DictAddResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

type FavoriteClip struct {
	ID             int     `json:"id"`
	FilePath       string  `json:"filePath"`
	FileName       string  `json:"fileName"`
	StartTime      float64 `json:"startTime"`
	EndTime        float64 `json:"endTime"`
	Text           string  `json:"text"`
	TagID          int     `json:"tagId"`
	TagName        string  `json:"tagName"`
	Word           string  `json:"word"`
	ReviewCount    int     `json:"reviewCount"`
	LastReviewedAt string  `json:"lastReviewedAt"`
	NextReview     string  `json:"nextReview"`
	CreatedAt      string  `json:"createdAt"`
}

type FavoriteTag struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}
