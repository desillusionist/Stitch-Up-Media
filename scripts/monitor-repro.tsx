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
  __joinedAudio?: Array<HTMLAudioElement | null>
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

const model = (() => {
  const lanes = [
    // The PICTURE's one clip is TRIMMED to leave a tail: its segment stops a second short of the job, which
    // the added track below runs through. That is the padding a longer track draws, and the stretch where a
    // trimmed visual's own sound used to run on.
    { id: 'main', label: 'VIDEO', kind: 'video' as const, embedded: false, duration: globals.__duration - 1, segments: [{ key: 'main#0', sourcePath: globals.__file, start: 0, duration: globals.__duration - 1, sourceUsedSeconds: globals.__duration - 1, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: true }] },
    // An ADDED track, which is the lane whose sound the scrub is measured on: over a still or the black tail
    // there is no video element, so this element is the only thing that can be audible, and it is the one the
    // per-tick seek used to jog.
    { id: 'sound', label: 'AUDIO', kind: 'audio' as const, embedded: false, duration: globals.__duration, segments: [{ key: 'sound#0', sourcePath: globals.__file, start: 0, duration: globals.__duration, sourceUsedSeconds: globals.__duration, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }] },
    // A LANE OF TWO JOINED TRACKS, half the file's length, so the handover between them and the SILENCE after
    // the second are both measurable. Its segments stop at half the file, which leaves a stretch of timeline
    // past its end where neither track may sound — the phantom tail the two-segment lane used to play.
    { id: 'joined', label: 'AUDIO', kind: 'audio' as const, embedded: false, duration: globals.__duration / 2, segments: [
      { key: 'joined#0', sourcePath: globals.__file, start: 0, duration: globals.__duration / 4, sourceUsedSeconds: globals.__duration / 4, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false },
      { key: 'joined#1', sourcePath: globals.__file, start: globals.__duration / 4, duration: globals.__duration / 4, sourceUsedSeconds: globals.__duration / 4, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false },
    ] },
  ]
  return { lanes, duration: globals.__duration, unusedVideoSources: [] as string[] }
})()

/**
 * The FROZEN case: a MULTI-TRACK whose VISUAL lane is EMPTY — no video source at all.
 *
 * This is the job reported as "a track looping on one frame": with no main-lane segment, the clock had nothing
 * to own it and held the playhead wherever it stood, so every added track was re-seeked onto that same frame
 * for as long as playback ran. NOTHING here mounts a video element, which is the whole point of the case.
 */
const frozenModel = {
  lanes: [
    { id: 'main', label: 'VIDEO', kind: 'video' as const, embedded: true, duration: 0, segments: [] as never[] },
    { id: 'sound', label: 'AUDIO 1', kind: 'audio' as const, embedded: false, duration: globals.__duration, segments: [{ key: 'sound#0', sourcePath: globals.__file, start: 0, duration: globals.__duration, sourceUsedSeconds: globals.__duration, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }] },
  ],
  duration: globals.__duration,
  unusedVideoSources: [] as string[],
}

/**
 * The BLANK-TAIL case: a BLANK as the LAST thing on the VISUAL lane, with a LONGER added track under it.
 *
 * The main lane ends two seconds before the output, so past the blank the tail has to run on the anchored clock
 * rather than hold on the blank's last frame. This is the other half of the reported freeze, and no video element
 * is mounted for a placeholder here either.
 */
const blankTailModel = {
  lanes: [
    { id: 'main', label: 'VIDEO', kind: 'video' as const, embedded: true, duration: globals.__duration - 2, segments: [{ key: 'blank#0', sourcePath: 'placeholder:video:harness:000000', start: 0, duration: globals.__duration - 2, sourceUsedSeconds: globals.__duration - 2, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }] },
    { id: 'sound', label: 'AUDIO 1', kind: 'audio' as const, embedded: false, duration: globals.__duration, segments: [{ key: 'sound#0', sourcePath: globals.__file, start: 0, duration: globals.__duration, sourceUsedSeconds: globals.__duration, speed: 1, speedInterpolation: 'sampling' as const, maintainPitch: true, sourceIn: 0, trimmed: false }] },
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
  const caseName = new URLSearchParams(window.location.search).get('case') || 'default'
  const used = caseName === 'frozen' ? frozenModel : caseName === 'blanktail' ? blankTailModel : model
  const mainSegment = used.lanes[0].segments[0] as { sourcePath: string } | undefined
  // A still or a BLANK draws no element in the real monitor, so the harness mounts none either: that absence is
  // the whole reason the clock has to fall back to the anchored one.
  const hasVideo = Boolean(mainSegment) && !mainSegment!.sourcePath.startsWith('placeholder:')
  const playback = useConsolidatedPlayback(used, audioElements, { playable: true, fps: globals.__fps })
  globals.__renders += 1
  React.useEffect(() => {
    globals.__playback = playback
    globals.__video = playback.videoRef.current
    globals.__audio = audioElements.current['sound#0'] ?? null
    globals.__joinedAudio = [audioElements.current['joined#0'] ?? null, audioElements.current['joined#1'] ?? null]
  }, [playback])
  const attach = variant === 'stable'
    ? playback.attachVideo
    : (element: HTMLVideoElement | null) => { playback.attachVideo(element); logMediaElement(element, 'monitor-video') }
  return <>
    {hasVideo && <video
      ref={attach}
      src={mediaUrl(globals.__file)}
      preload="metadata"
      playsInline
      muted
      style={{ width: 240, background: '#000' }}
    />}
    <audio ref={(element) => { audioElements.current['sound#0'] = element }} src={mediaUrl(globals.__file)} preload="auto" />
    {caseName === 'default' && <audio ref={(element) => { audioElements.current['joined#0'] = element }} src={mediaUrl(globals.__file)} preload="auto" />}
    {caseName === 'default' && <audio ref={(element) => { audioElements.current['joined#1'] = element }} src={mediaUrl(globals.__file)} preload="auto" />}
  </>
}

const variant = (new URLSearchParams(window.location.search).get('variant') || 'stable') as 'stable' | 'inline'
globals.__renders = 0
globals.__log = []
createRoot(document.getElementById('root') as HTMLElement).render(<Monitor variant={variant} />)
