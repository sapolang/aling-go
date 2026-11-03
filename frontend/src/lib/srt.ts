export function timeToSeconds(time: string): number {
  const [h, m, s] = time.split(':')
  const [sec, ms] = s.split(',')
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec) + parseInt(ms || '0') / 1000
}
