interface SpeakerIconProps {
  /** 正在朗读时让喇叭的声波弧线依次闪动 */
  speaking: boolean
  className?: string
}

/**
 * 喇叭图标（与 lucide Volume2 形状一致）。朗读时图标内的两条声波弧线
 * 依次向外扩散闪动，图标本体不缩放。
 */
export default function SpeakerIcon({ speaking, className }: SpeakerIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className ?? ''}${speaking ? ' tts-speaking' : ''}`}
      aria-hidden="true"
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.302z" />
      <path d="M16 9a5 5 0 0 1 0 6" className={`tts-arc${speaking ? ' tts-arc-1' : ''}`} />
      <path
        d="M19.364 18.364a9 9 0 0 0 0-12.728"
        className={`tts-arc${speaking ? ' tts-arc-2' : ''}`}
      />
    </svg>
  )
}
