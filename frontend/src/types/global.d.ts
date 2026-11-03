/// <reference types="vite/client" />

interface WailsEvent {
  name: string
  data: any
}

interface Window {
  runtime: any
  wails: any
  api: any
}
