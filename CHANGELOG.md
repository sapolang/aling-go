# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 基础设施：golangci-lint v2 接入（gosec / revive / gocyclo / misspell）
- 基础设施：前端 ESLint + Prettier
- 基础设施：lefthook pre-commit 钩子
- 基础设施：CI 加固（govulncheck、npm audit、frontend lint、prettier check）
- 基础设施：`.editorconfig`
- 基础设施：SECURITY.md / CHANGELOG.md / Issue 模板

### Changed
- `make test` 现运行 typecheck + eslint，原 typecheck 拆为 `make typecheck`
- 升级 Vite 5 → 8、@vitejs/plugin-react 4 → 6，清除 esbuild/vite 的 high 级漏洞
- CI / Release 的 Node 版本由 20 提至 26（LTS，满足 Vite 8 引擎要求）
- ESLint 固定为 9.x（`eslint-plugin-react` 尚未支持 ESLint 10），保证 `npm ci` 无 peer 冲突

## [0.1.0] - 2026-07-28

- 初始版本
