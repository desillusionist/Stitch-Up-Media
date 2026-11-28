import React, { useEffect, useRef } from 'react'

/**
 * A take being written, drawn as it grows.
 *
 * WHY IT DRAWS ITSELF: the microphone's peaks arrive every few frames, and putting them through the editor's own
 * state would re-render the whole job — every clip, every cue and the monitor — sixty times a second for one row of
 * bars. So the component owns its own animation frame and writes the width and the path straight onto its elements;
 * the editor only re-renders when the take CHANGES STATE, which is a handful of times per recording.
 *
 * THE ONE ANALYSER is created when the microphone is armed (see `armTake`). Nothing about it reaches the file.
 *
 * A PAUSED take freezes the box where it stands: `recording` stops the clock, and the width is the milliseconds
 * actually recorded rather than wall time, so a pause neither draws nor lengthens anything.
 */
export const TakeWave: React.FC<{
  /** The microphone's level meter, or null when the browser refused one. */
  analyser: AnalyserNode | null
  /** Where the take begins on the timeline, in pixels from the lane area's left edge. */
  left: number
  /** The timeline's rate: pixels per second at the current zoom. */
  pxPerSecond: number
  /** True while the recorder is actually writing. */
  recording: boolean
  /** The lane's own height, which the drawing is centred in. */
  height: number
}> = ({ analyser, left, pxPerSecond, recording, height }) => {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const pathRef = useRef<SVGPathElement | null>(null)
  const peaksRef = useRef<number[]>([])
  const elapsedRef = useRef(0)
  useEffect(() => {
    let alive = true
    let last = performance.now()
    let lastSample = 0
    let frame = 0
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      if (recording) elapsedRef.current += now - last
      last = now
      // A PEAK EVERY NINETY MILLISECONDS rather than every frame: a bar a frame at sixty hertz would be six hundred
      // bars a second on a lane that is a few hundred pixels wide, and every one of them would be drawn over the
      // last. Ninety milliseconds is one bar every two or three pixels at the default zoom, which is what the
      // finished waveform looks like too.
      if (recording && analyser && now - lastSample >= 90) {
        lastSample = now
        const bins = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(bins)
        let peak = 0
        for (let index = 1; index < bins.length; index += 1) if (bins[index] > peak) peak = bins[index]
        peaksRef.current.push(Math.max(0.03, Math.min(1, peak / 255)))
      }
      const width = Math.max(2, (elapsedRef.current / 1000) * pxPerSecond)
      if (boxRef.current) boxRef.current.style.width = `${width}px`
      const peaks = peaksRef.current
      const path = pathRef.current
      if (path && peaks.length) {
        let d = ''
        for (let index = 0; index < peaks.length; index += 1) {
          const x = ((index + 0.5) / peaks.length) * width
          const half = Math.max(0.6, peaks[index] * height * 0.45)
          d += `M${x.toFixed(1)} ${(height / 2 - half).toFixed(1)}V${(height / 2 + half).toFixed(1)}`
        }
        path.setAttribute('d', d)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(frame) }
  }, [recording, analyser, pxPerSecond, height])
  return (
    <div className="timeline-take-wave" ref={boxRef} style={{ left: `${left}px` }} aria-hidden="true">
      {/* No viewBox: the path is written in the same pixels the box is wide, so a bar stays two pixels however long
          the take runs. A viewBox would stretch every bar with the container. */}
      <svg width="100%" height="100%">
        <line x1="0" y1={height / 2} x2="100%" y2={height / 2} stroke="var(--ui-border)" strokeWidth={1} />
        <path ref={pathRef} fill="none" stroke="var(--crt-red)" strokeWidth={2} strokeLinecap="square" />
      </svg>
    </div>
  )
}
