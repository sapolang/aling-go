package store

import _ "embed"

// Schema 是用户库的建表语句，运行时建表与 sqlc schema 的唯一来源。
//
//go:embed schema.sql
var Schema string
