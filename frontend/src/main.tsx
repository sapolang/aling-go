import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initBridge } from './api/bridge'
import './index.css'

// 必须在首屏渲染前完成，否则子组件（如 Layout）的 effect 会先于 App 的
// effect 执行，拿不到 window.api 导致白屏
initBridge()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
