// 跨平台取路径最后一段：同时兼容 POSIX '/' 与 Windows '\'
export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? ''
}
