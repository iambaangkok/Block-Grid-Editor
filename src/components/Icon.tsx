// Small stroke icon set (24×24, lucide-style) so the UI never depends on emoji/symbol fonts.

const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  pointer: 'M5 3l14 8-6 2-3 6z',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L3 15.5a1.6 1.6 0 0 1 2.4-2L8 16',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  origin: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  rotCw: 'M20 4v6h-6M20 10A8 8 0 1 0 18 17',
  rotCcw: 'M4 4v6h6M4 10a8 8 0 1 1 2 7',
  mirror: 'M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z',
  front: 'M12 19V5M6 11l6-6 6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  close: 'M6 6l12 12M18 6 6 18',
  eraser: 'M7 21h13M5 14l9-9 6 6-9 9H8z',
  chevron: 'm6 9 6 6 6-6',
  key: 'M11 12h10M17 12v3M20 12v2M7 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  keyOff: 'M11 12h10M17 12v3M20 12v2M7 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 3l18 18',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
