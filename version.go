package main

// appVersion 由构建流程通过
// -ldflags "-X main.appVersion=<version>" 注入（版本号来源为 build/config.yml）。
// 未注入时（如 go run）回退为 dev。
var appVersion = "dev"
