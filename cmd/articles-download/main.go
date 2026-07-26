package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

const (
	categoryURL = "https://files.typewords.cc/list/article.json"
	articleBase = "https://files.typewords.cc/dicts/en/article/"
)

type Category struct {
	ID          int      `json:"id"`
	EnName      string   `json:"enName"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	URL         string   `json:"url"`
	Length      int      `json:"length"`
	Cover       string   `json:"cover"`
	Tags        []string `json:"tags"`
}

type Article struct {
	ID              int          `json:"id"`
	Title           string       `json:"title"`
	TitleTranslate  string       `json:"titleTranslate"`
	Text            string       `json:"text"`
	TextTranslate   string       `json:"textTranslate"`
	AudioSrc        string       `json:"audioSrc"`
	LrcPosition     [][2]float64 `json:"lrcPosition"`
	Question        *Question    `json:"question"`
}

type Question struct {
	Text      string `json:"text"`
	Translate string `json:"translate"`
	Start     float64 `json:"start"`
	End       float64 `json:"end"`
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	dbPath := "articles.db"
	os.Remove(dbPath)

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := createTables(db); err != nil {
		log.Fatalf("create tables: %v", err)
	}

	log.Println("Fetching category list...")
	categories, err := fetchCategories()
	if err != nil {
		log.Fatalf("fetch categories: %v", err)
	}

	totalArticles := 0
	for _, cat := range categories {
		log.Printf("Fetching articles for %s (%s)...", cat.EnName, cat.Name)
		articles, err := fetchArticles(cat.URL)
		if err != nil {
			log.Printf("  ERROR: %v — skipping", err)
			continue
		}

		if err := insertCategory(db, cat); err != nil {
			log.Fatalf("insert category: %v", err)
		}

		for i, a := range articles {
			if err := insertArticle(db, cat.EnName, i, a); err != nil {
				log.Printf("  ERROR inserting article %d: %v", a.ID, err)
			}
		}

		log.Printf("  %d articles saved", len(articles))
		totalArticles += len(articles)
	}

	log.Printf("Done! %d categories, %d articles → %s", len(categories), totalArticles, dbPath)
}

func fetchCategories() ([]Category, error) {
	resp, err := http.Get(categoryURL)
	if err != nil {
		return nil, fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	var cats []Category
	if err := json.NewDecoder(resp.Body).Decode(&cats); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return cats, nil
}

func fetchArticles(path string) ([]Article, error) {
	url := articleBase + strings.TrimPrefix(path, "/")
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("http get %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var articles []Article
	if err := json.NewDecoder(resp.Body).Decode(&articles); err != nil {
		return nil, fmt.Errorf("decode %s: %w", url, err)
	}
	return articles, nil
}

func createTables(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE categories (
			id INTEGER PRIMARY KEY,
			en_name TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			url TEXT NOT NULL,
			length INTEGER DEFAULT 0,
			cover TEXT DEFAULT ''
		);

		CREATE TABLE articles (
			id INTEGER PRIMARY KEY,
			category_en_name TEXT NOT NULL,
			title TEXT NOT NULL,
			title_translate TEXT DEFAULT '',
			text TEXT NOT NULL,
			text_translate TEXT DEFAULT '',
			audio_src TEXT DEFAULT '',
			lrc_position TEXT DEFAULT '',
			question_json TEXT DEFAULT '',
			index_order INTEGER DEFAULT 0
		);

		CREATE INDEX idx_articles_category ON articles(category_en_name);
	`)
	return err
}

func insertCategory(db *sql.DB, cat Category) error {
	_, err := db.Exec(
		`INSERT OR REPLACE INTO categories (id, en_name, name, description, url, length, cover)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		cat.ID, cat.EnName, cat.Name, cat.Description, cat.URL, cat.Length, cat.Cover,
	)
	return err
}

func insertArticle(db *sql.DB, categoryEnName string, indexOrder int, a Article) error {
	lrcJSON, _ := json.Marshal(a.LrcPosition)
	qJSON, _ := json.Marshal(a.Question)

	_, err := db.Exec(
		`INSERT OR REPLACE INTO articles (id, category_en_name, title, title_translate, text, text_translate, audio_src, lrc_position, question_json, index_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, categoryEnName, a.Title, a.TitleTranslate, a.Text, a.TextTranslate,
		a.AudioSrc, string(lrcJSON), string(qJSON), indexOrder,
	)
	return err
}
