# Waveform Feature Design

## Summary

在视频/音频播放页下方添加可交互的声音波形图。静态曲线波形（Audacity 风格），支持点击和拖拽跳转播放位置，带一条跟随播放进度移动的光标竖线。

## Architecture

```
Player.tsx
├── <video>                   播放区域 (flex-1, min-h-0)
├── <Waveform>                波形交互区 (48px 视频 / 100px 音频)
│   ├── Canvas: 曲线波形填充路径
│   ├── Canvas: 1px 光标竖线 (跟随 currentTime)
│   └── 事件: onClick / onMouseDown → onSeek(time)
└── <input range>             精简进度条 (保留)
```

### Go Backend: waveform.go

- `GetWaveformData(filePath string) []float64`
- ffmpeg 命令: `ffmpeg -i input -ac 1 -f f32le -ar 8000 pipe:1`
- 读取 f32le PCM 流 → 分 1000 段 → 每段取峰值振幅 → 归一化
- 缓存: `{dataDir}/aling/waveforms/{md5(filePath)}.json`
- 复用已有的 `findFFmpeg()` + `md5Hash()`

### Frontend: Waveform.tsx

- Props: `data: number[]`, `duration: number`, `currentTime: number`, `onSeek: (time: number) => void`
- Canvas 绘制: 填充路径 (上半部 + 镜像下半部), `quadraticCurveTo` 平滑
- 光标竖线: 1px `requestAnimationFrame` 驱动
- 交互: onClick/onMouseDown+onMouseMove+onMouseUp → 坐标换时间 → onSeek

### Integration

- `playerStore` 新增 `waveformData: number[]`, `waveformLoading: boolean`
- `bridge.ts` 新增 `getWaveformData(filePath) => number[]`
- Player.tsx: 视频容器改用 `flex flex-col`, `<video>` 用 `flex-1`, 波形固定高度
- 纯音频文件: 波形 100px, 无视频区域

## Edge Cases

| 场景 | 处理 |
|---|---|
| 无音频轨道 | 返回空数组, 不渲染波形 |
| ffmpeg 不可用 | 返回空数组, 静默降级 |
| 窗口 resize | ResizeObserver 重绘 Canvas |
| DPR 高清屏 | Canvas × devicePixelRatio |
| 拖拽中 | 光标暂不跟随 currentTime, 松手恢复 |
