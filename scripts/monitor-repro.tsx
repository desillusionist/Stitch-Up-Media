/**
 * The monitor's transport, on a real file, with the ref written two ways.
 *
 * This is a reproduction harness, not a spec: it renders the app's own playback hook against the app's
 * own media URL and a real video, and measures how fast the picture actually moves — once with the
 * <video>'s ref handed the hook's own stable callback (what the monitor used to do), and once with the
 * ref written as an inline arrow that also logs (what it does now).
 *
 * Nothing here is app code. It exists to answer "how fast does this play, and how often is the element
 * seeked" without a window the user has to watch.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useConsolidatedPlayback, ConsolidatedPlayback } from '../src/hooks/useConsolidatedPlayback'
import { mediaUrl } from '../src/lib/mediaUrl'

/** The values the harness's page is handed, and the handles the measurement reads back. */
type ReproGlobals = {
  __file: string
  __duration: number
  __fps: number
  __playback?: ConsolidatedPlayback
  __video?: HTMLVideoElement | null
  __audio?: HTMLAudioElement | null
  __renders: number
  __log: Array<{ kind: string; src: string }>
}

const globals = window as unknown as ReproGlobals

/**
 * The same shape of logger the app's monitor uses: idempotent per element, and not the point of the
 * harness. Its only job is to make the ref an inline arrow, which is what gives it a new identity on
 * every render.
 */
const logMediaElement = (element: HTMLVideoElement | null, kind: string) => {
  const marked = element as (HTMLVideoElement & { __reproLogged?: string }) | null
  if (!marked || marked.__reproLogged === kind) return
  marked.__reproLogged = kind
  globals.__log.push({ kind, src: marked.currentSrc || marked.src })
}

const model = {
  lanes: [
    { id: 'main', label: 'VIDEO', kind: 'video' as const, embedded: false, duration: globals.__duration, segments: [{ key: 'main#0', sourcePath: globals.__file, start: 0, duration: globals.__duration, sourceUsedSeconds: globals.__duration, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }] },
    // An ADDED track, which is the lane whose sound the scrub is measured on: over a still or the black tail
    // there is no video element, so this element is the only thing that can be audible, and it is the one the
    // per-tick seek used to jog.
    { id: 'sound', label: 'AUDIO', kind: 'audio' as const, embedded: false, duration: globals.__duration, segments: [{ key: 'sound#0', sourcePath: globals.__file, start: 0, duration: globals.__duration, sourceUsedSeconds: globals.__duration, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }] },
  ],
  duration: globals.__duration,
  unusedVideoSources: [] as string[],
}

/**
 * `variant` picks how the ref is written, and nothing else.
 *
 * `stable` is the hook's own callback, which never changes identity; `inline` is an arrow created
 * during render, which is a new function every time.
 */
const Monitor: React.FC<{ variant: 'stable' | 'inline' }> = ({ variant }) => {
  const audioElements = React.useRef<Record<string, HTMLAudioElement | null>>({})
  const playback = useConsolidatedPlayback(model, audioElements, { playable: true, fps: globals.__fps })
  globals.__renders += 1
  React.useEffect(() => {
    globals.__playback = playback
    globals.__video = playback.videoRef.current
    globals.__audio = audioElements.current.sound ?? null
  }, [playback])
  const attach = variant === 'stable'
    ? playback.attachVideo
    : (element: HTMLVideoElement | null) => { playback.attachVideo(element); logMediaElement(element, 'monitor-video') }
  return <>
    <video
      ref={attach}
      src={mediaUrl(globals.__file)}
      preload="metadata"
      playsInline
      muted
      style={{ width: 240, background: '#000' }}
    />
    <audio ref={(element) => { audioElements.current.sound = element }} src={mediaUrl(globals.__file)} preload="auto" />
  </>
}

const variant = (new URLSearchParams(window.location.search).get('variant') || 'stable') as 'stable' | 'inline'
globals.__renders = 0
globals.__log = []
createRoot(document.getElementById('root') as HTMLElement).render(<Monitor variant={variant} />)
