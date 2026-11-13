CREATE TABLE IF NOT EXISTS words (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	word TEXT NOT NULL,
	definition TEXT DEFAULT '',
	phonetic TEXT DEFAULT '',
	example TEXT DEFAULT '',
	tags TEXT DEFAULT '',
	level INTEGER DEFAULT 1,
	next_review TEXT DEFAULT (date('now')),
	created_at TEXT DEFAULT (datetime('now','localtime')),
	updated_at TEXT DEFAULT (datetime('now','localtime')),
	repetitions INTEGER DEFAULT 0,
	efactor REAL DEFAULT 2.5,
	interval INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tags (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	color TEXT NOT NULL DEFAULT '#3b82f6'
);
CREATE TABLE IF NOT EXISTS typing_records (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	article_id INTEGER NOT NULL,
	mode TEXT NOT NULL,
	accuracy REAL DEFAULT 0,
	wpm REAL DEFAULT 0,
	duration INTEGER DEFAULT 0,
	mistakes TEXT DEFAULT '[]',
	created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS typing_progress (
	article_id INTEGER NOT NULL,
	mode TEXT NOT NULL,
	position INTEGER DEFAULT 0,
	completed INTEGER DEFAULT 0,
	best_accuracy REAL DEFAULT 0,
	best_wpm REAL DEFAULT 0,
	updated_at TEXT DEFAULT (datetime('now','localtime')),
	PRIMARY KEY (article_id, mode)
);
CREATE TABLE IF NOT EXISTS review_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	word_id INTEGER NOT NULL,
	quality INTEGER NOT NULL,
	reviewed_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);
CREATE TABLE IF NOT EXISTS favorite_tags (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS favorite_clips (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	file_path TEXT NOT NULL,
	start_time REAL NOT NULL,
	end_time REAL NOT NULL,
	text TEXT DEFAULT '',
	tag_id INTEGER DEFAULT 0,
	word TEXT DEFAULT '',
	review_count INTEGER DEFAULT 0,
	last_reviewed_at TEXT DEFAULT '',
	next_review TEXT DEFAULT '',
	created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_favorite_clips_tag ON favorite_clips(tag_id);
CREATE TABLE IF NOT EXISTS ai_translations (
	hash TEXT PRIMARY KEY,
	kind TEXT NOT NULL DEFAULT 'translate',
	model TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL,
	target TEXT NOT NULL,
	created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_translations_created ON ai_translations(created_at);
CREATE TABLE IF NOT EXISTS feeds (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	url TEXT NOT NULL UNIQUE,
	title TEXT DEFAULT '',
	description TEXT DEFAULT '',
	image TEXT DEFAULT '',
	site_url TEXT DEFAULT '',
	last_fetched_at TEXT DEFAULT '',
	last_error TEXT DEFAULT '',
	created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS feed_episodes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	feed_id INTEGER NOT NULL,
	guid TEXT NOT NULL,
	title TEXT DEFAULT '',
	description TEXT DEFAULT '',
	audio_url TEXT DEFAULT '',
	link TEXT DEFAULT '',
	duration INTEGER DEFAULT 0,
	published_at TEXT DEFAULT '',
	local_path TEXT DEFAULT '',
	image TEXT DEFAULT '',
	created_at TEXT DEFAULT (datetime('now','localtime')),
	UNIQUE(feed_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_feed_episodes_feed ON feed_episodes(feed_id, published_at);
