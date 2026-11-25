-- name: UpsertPDFDocument :one
INSERT INTO pdf_documents (path, title, page_count, sentence_count)
VALUES (?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET
	title = excluded.title,
	page_count = excluded.page_count,
	sentence_count = excluded.sentence_count,
	last_sentence = CASE
		WHEN pdf_documents.sentence_count = excluded.sentence_count THEN pdf_documents.last_sentence
		ELSE 0
	END,
	updated_at = datetime('now','localtime')
RETURNING id, path, title, page_count, sentence_count, last_sentence, created_at, updated_at;

-- name: GetPDFDocumentByPath :one
SELECT id, path, title, page_count, sentence_count, last_sentence, created_at, updated_at
FROM pdf_documents
WHERE path = ?;

-- name: GetPDFDocument :one
SELECT id, path, title, page_count, sentence_count, last_sentence, created_at, updated_at
FROM pdf_documents
WHERE id = ?;

-- name: ListPDFDocuments :many
SELECT id, path, title, page_count, sentence_count, last_sentence, created_at, updated_at
FROM pdf_documents
ORDER BY updated_at DESC;

-- name: DeletePDFSentences :exec
DELETE FROM pdf_sentences WHERE document_id = ?;

-- name: InsertPDFSentence :exec
INSERT INTO pdf_sentences (document_id, page, idx, text)
VALUES (?, ?, ?, ?);

-- name: ListPDFSentences :many
SELECT id, document_id, page, idx, text
FROM pdf_sentences
WHERE document_id = ?
ORDER BY idx ASC;

-- name: UpdatePDFProgress :exec
UPDATE pdf_documents
SET last_sentence = ?, updated_at = datetime('now','localtime')
WHERE id = ?;

-- name: DeletePDFDocument :exec
DELETE FROM pdf_documents WHERE id = ?;
