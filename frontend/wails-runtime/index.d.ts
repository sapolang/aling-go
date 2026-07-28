declare module '@wailsio/runtime' {
  export const Events: {
    On(event: string, callback: (e: any) => void): () => void
    OnMultiple(event: string, callback: (e: any) => void, maxCallbacks: number): () => void
    Once(event: string, callback: (e: any) => void): () => void
    Off(...events: string[]): void
    OffAll(): void
    Emit(event: string, data?: any): void
    Types: Record<string, Record<string, string>>
    WailsEvent: new (name: string, data?: any) => { name: string; data: any }
  }

  export const Window: {
    Get(name: string): any
  }

  export const Call: {
    ByID(id: number, ...args: any[]): any
    ByName(name: string, ...args: any[]): any
    RuntimeError: ErrorConstructor
  }

  export const System: {
    IsAMD64(): boolean
    IsARM(): boolean
    IsARM64(): boolean
    IsAndroid(): boolean
    IsDarkMode(): boolean
    IsDebug(): boolean
    IsDesktop(): boolean
    IsIOS(): boolean
    IsLinux(): boolean
    IsMac(): boolean
    IsMobile(): boolean
    IsWindows(): boolean
    Environment(): any
    Capabilities(): any
    invoke(data: any): void
  }

  export const Application: {
    Hide(): void
    Quit(): void
    Show(): void
  }

  export const Browser: {
    OpenURL(url: string): void
  }

  export const Clipboard: {
    SetText(text: string): void
    Text(): string
  }

  export const Dialogs: {
    OpenFile(filters?: any): string[]
    SaveFile(name?: string): string
    Info(message: string): void
    Warning(message: string): void
    Error(message: string): void
    Question(message: string): any
  }

  export const Create: {
    Any(v: any): any
    Array(converter: (v: any) => any): (v: any) => any[]
    ByteSlice(v: any): string
    DateFromTime(t: number): Date
    Events: Record<string, (data: any) => any>
    Map(keyConverter: any, valueConverter: any): (v: any) => Record<string, any>
    Nullable(converter: (v: any) => any): (v: any) => any
    Struct(fields: Record<string, (v: any) => any>): (v: any) => any
  }

  export const Screens: {
    GetAll(): any
    GetByID(id: number): any
    GetByIndex(index: number): any
    GetCurrent(): any
    GetPrimary(): any
  }

  export const clientId: string
  export const objectNames: Record<string, number>

  export function getTransport(): any
  export function setTransport(transport: any): void
  export function loadOptionalScript(url: string): void

  export class CancellablePromise<T> extends Promise<T> {
    cancel(reason?: any): CancellablePromise<void>
    cancelOn(abortSignal: AbortSignal): this
    static cancel(reason?: any): CancellablePromise<never>
    static sleep(ms: number, value?: any): CancellablePromise<any>
    static timeout(ms: number, reason?: any): CancellablePromise<never>
    static withResolvers<T>(): { promise: CancellablePromise<T>; resolve: (v: T) => void; reject: (e: any) => void; oncancelled: ((reason: any) => void) | null }
  }

  export class CancelError extends Error {
    constructor(message?: string, options?: ErrorOptions)
  }

  export class CancelledRejectionError extends Error {
    promise: CancellablePromise<any>
    constructor(promise: CancellablePromise<any>, reason?: any, message?: string)
  }
}
