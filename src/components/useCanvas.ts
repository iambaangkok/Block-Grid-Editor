import { useEffect, useRef, useState } from 'react'

/** Tracks a canvas's CSS size and keeps its backing store at device resolution. */
export function useCanvasSize() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const update = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const bw = Math.max(1, Math.round(rect.width * dpr))
      const bh = Math.max(1, Math.round(rect.height * dpr))
      // Resizing the backing store clears it, so only touch it on a real change — and then
      // always publish a new size so the owner redraws.
      if (canvas.width === bw && canvas.height === bh) return
      canvas.width = bw
      canvas.height = bh
      setSize({ w: rect.width, h: rect.height, dpr })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  return { ref, ...size }
}
