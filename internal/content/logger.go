package content

import (
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// loggerOf 返回服务绑定的日志器；构造时未注入应用（如单元测试）则退回默认日志器，
// 保证失败路径始终有一条可观测日志，而不用业务代码直接写 os.Stderr。
func loggerOf(app *application.App) *slog.Logger {
	if app != nil && app.Logger != nil {
		return app.Logger
	}
	return slog.Default()
}
