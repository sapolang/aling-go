package content

import (
	"aling-go/internal/core"
	"aling-go/internal/store/userdb"
)

// q 返回基于当前用户库句柄的类型安全查询集合，供整个 content 包复用。
func q() *userdb.Queries {
	return userdb.New(core.DB)
}
