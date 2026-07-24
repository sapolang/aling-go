export class TaskQueue {
  private queue: (() => Promise<void>)[] = []
  private active = 0
  private concurrency: number

  constructor(concurrency = 1) {
    this.concurrency = concurrency
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task()
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
      this.processNext()
    })
  }

  private processNext(): void {
    if (this.active >= this.concurrency || this.queue.length === 0) return
    this.active++
    const task = this.queue.shift()!
    task().finally(() => {
      this.active--
      this.processNext()
    })
  }

  get length(): number {
    return this.queue.length
  }

  get activeCount(): number {
    return this.active
  }

  clear(): void {
    this.queue = []
  }
}
