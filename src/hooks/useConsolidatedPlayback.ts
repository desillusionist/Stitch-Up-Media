import { useCallback, useEffect, useRef, useState } from 'react'
import { TimelineModel, TimelineSegment } from '../lib/timelineModel'
import { nextShuttleRate } from '../lib/shuttleRates'

/** How far a slaved element may drift before it is corrected, in seconds. */
const DRIFT_TOLERANCE = 0.25
/** MediaError.MEDIA_ERR_ABORTED: a load superseded by another, not a failure. */
const MEDIA_ERR_ABORTED = 1

export interface ConsolidatedPlayback {
  /** Callback ref: also (re)binds load handlers, because the element unmounts for stills. */
  attachVideo: (element: HTMLVideoElement | null) => void
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  /** Index of the main-lane segment the video element should be showing. */
  segmentIndex: number
  segment: TimelineSegment | undefined
  position: number
  playing: boolean
  /** Signed shuttle rate. Zero means ordinary playback, negative means reverse. */
  shuttleRate: number
  error: string | null
  toggle: () => void
  pause: () => void
  seek: (seconds: number) => void
  step: (seconds: number) => void
  /** Ramps the rate in the pressed direction, per the J/K/L ladder. */
  shuttle: (direction: 1 | -1) => void
  setShuttleRate: (rate: number) => void
  clearError: () => void
}

/**
 * Plays a whole assembled job rather than a single clip.
 *
 * The main lane's media element is the master clock, so video and its embedded
 * audio stay in sync by construction. Added audio tracks are slaved to it and
 * corrected only once they drift past a tolerance. Still frames have no element
 * to drive time, and a segment being loaded has none yet either, so both fall
 * back to an anchored clock.
 *
 * Rules that keep the transport honest:
 * - A seek is recorded and applied, never inferred from the element.
 * - A `play()` rejected with AbortError is a superseded load, not a stop request.
 * - A media `error` carrying MEDIA_ERR_ABORTED is likewise not a failure.
 * - An anchored clock always continues from the current position, never from the
 *   start of the segment, or pausing on a still would jump backwards.
 *
 * Reverse playback cannot use a media element (there is no negative playback
 * rate), so it is driven by stepping `currentTime` backwards, which is why the
 * reverse ladder stops at 4x.
 */
export const useConsolidatedPlayback = (
  model: TimelineModel,
  audioElements: React.RefObject<Record<string, HTMLAudioElement | null>>,
  options: { playable: boolean; fps: number },
): ConsolidatedPlayback => {
  const { playable, fps } = options
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const [position, setPosition] = useState(0)
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shuttleRate, setShuttleRateState] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mainSegments = model.lanes[0]?.segments ?? []
  const segment = mainSegments[segmentIndex]
  const addedAudioLanes = model.lanes.filter((lane) => !lane.embedded && lane.segments.length > 0)
  const audioLaneSignature = addedAudioLanes.map((lane) => lane.id).join('|')

  // Read inside event handlers and the frame loop so they never capture stale values.
  const stateRef = useRef({ segment, playing, position, duration: model.duration })
  stateRef.current = { segment, playing, position, duration: model.duration }
  const segmentsRef = useRef(mainSegments)
  segmentsRef.current = mainSegments
  const lanesRef = useRef(addedAudioLanes)
  lanesRef.current = addedAudioLanes
  const segmentIndexRef = useRef(segmentIndex)
  segmentIndexRef.current = segmentIndex
  const shuttleRef = useRef(shuttleRate)
  shuttleRef.current = shuttleRate
  const fpsRef = useRef(fps)
  fpsRef.current = Math.max(1, fps)
  const loadedSourceRef = useRef<string | null>(null)
  /** Consolidated position waiting to be applied once the element can seek. */
  const pendingSeekRef = useRef<number | null>(null)
  /** Anchored clock for still frames and for material past the end of the video. */
  const anchorRef = useRef<{ position: number; startedAt: number; key: string | undefined } | null>(null)
  /** Frames owed to reverse playback once they add up to a whole one. */
  const reverseAccumulatorRef = useRef(0)

  const indexForTime = useCallback((seconds: number) => {
    const segments = segmentsRef.current
    if (!segments.length) return 0
    const exact = segments.findIndex((candidate) => seconds >= candidate.start && seconds < candidate.start + candidate.duration)
    if (exact >= 0) return exact
    return seconds <= segments[0].start ? 0 : segments.length - 1
  }, [])

  const syncAddedAudio = useCallback((seconds: number, force: boolean) => {
    lanesRef.current.forEach((lane) => {
      const element = audioElements.current?.[lane.id]
      const laneSegment = lane.segments[0]
      if (!element || !laneSegment) return
      const desired = laneSegment.sourceIn + Math.max(0, Math.min(laneSegment.duration, seconds - laneSegment.start))
      if (force || Math.abs(element.currentTime - desired) > DRIFT_TOLERANCE) element.currentTime = desired
    })
  }, [audioElements])

  const startPlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    void video.play().catch((playError: unknown) => {
      if (playError instanceof DOMException && playError.name === 'AbortError') return
      setPlaying(false)
    })
  }, [])

  /** Moves the element onto the recorded position, once it is able to. */
  const applyPendingSeek = useCallback((force: boolean) => {
    const video = videoRef.current
    const current = stateRef.current.segment
    if (!current) { pendingSeekRef.current = null; return }
    // A still frame renders no video element, so there is nothing to move and the
    // recorded position already IS the position. Leaving it pending would hold the
    // playhead in place forever, because readPosition stands still while one is set.
    if (!video || current.still) { pendingSeekRef.current = null; return }
    if (!force && (video.readyState < 1 || loadedSourceRef.current !== current.sourcePath)) return
    const desired = pendingSeekRef.current
      ?? current.start + Math.max(0, Math.min(current.duration, stateRef.current.position - current.start))
    // A position past this segment, which happens when an added track outlasts the
    // video, is not something this element can show. Clamping it to the segment end
    // would snap the playhead back to the cut, so the anchored clock keeps it
    // instead and the seek is considered settled.
    if (desired < current.start || desired > current.start + current.duration) {
      pendingSeekRef.current = null
      return
    }
    try {
      video.currentTime = current.sourceIn + Math.max(0, Math.min(current.duration, desired - current.start))
      // Cleared only once it lands, so readPosition knows to hold rather than
      // report the element's old clock while a crossing is in flight.
      pendingSeekRef.current = null
    } catch { /* element not seekable yet */ }
  }, [])

  const onLoaded = useCallback(() => {
    const video = videoRef.current
    const current = stateRef.current.segment
    if (!video) return
    loadedSourceRef.current = current?.sourcePath ?? null
    applyPendingSeek(true)
    pendingSeekRef.current = null
    anchorRef.current = null
    reverseAccumulatorRef.current = 0
    setError(null)
    if (stateRef.current.playing && shuttleRef.current >= 0) startPlayback()
  }, [applyPendingSeek, startPlayback])

  const onMediaError = useCallback(() => {
    const mediaError = videoRef.current?.error
    if (mediaError && mediaError.code === MEDIA_ERR_ABORTED) return
    pendingSeekRef.current = null
    setError('UNABLE TO DECODE THIS SOURCE')
    setPlaying(false)
  }, [])

  /**
   * The element unmounts while a still frame is showing, so handlers are bound
   * from a callback ref rather than a mount-once effect.
   */
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    detachRef.current?.()
    detachRef.current = null
    videoRef.current = element
    if (!element) { loadedSourceRef.current = null; return }
    element.addEventListener('loadedmetadata', onLoaded)
    element.addEventListener('error', onMediaError)
    detachRef.current = () => {
      element.removeEventListener('loadedmetadata', onLoaded)
      element.removeEventListener('error', onMediaError)
    }
    if (element.readyState >= 1) onLoaded()
  }, [onLoaded, onMediaError])

  useEffect(() => () => { detachRef.current?.() }, [])

  /** The element's clock is authoritative while it is actually holding this segment. */
  const readPosition = useCallback(() => {
    const snapshot = stateRef.current
    const current = snapshot.segment
    const video = videoRef.current
    const now = performance.now()
    // A crossing or seek is in flight. Holding is the only safe answer, because
    // the element still holds the previous source and would report its clock.
    if (pendingSeekRef.current != null) return snapshot.position
    const anchored = (from: number) => {
      const anchor = anchorRef.current
      if (!anchor || anchor.key !== current?.key) {
        anchorRef.current = { position: from, startedAt: now, key: current?.key }
        return from
      }
      return anchor.position + (now - anchor.startedAt) / 1000
    }

    // A still frame occupies its duration with nothing decoding. It must continue
    // from wherever the playhead sits, not restart at the head of the segment.
    if (current?.still) {
      const from = Math.max(current.start, Math.min(current.start + current.duration, snapshot.position))
      return Math.min(current.start + current.duration, anchored(from))
    }

    if (video && current && video.readyState >= 1) {
      const local = video.currentTime - current.sourceIn
      if (!video.ended && local >= -0.05) {
        anchorRef.current = null
        return current.start + Math.max(0, local)
      }
      // The element finished this source but the timeline continues: an added
      // track can outlast the video, so the tail runs on the anchored clock,
      // continuing from wherever the playhead already sits rather than snapping
      // back to the end of the video.
      const tailFrom = Math.max(current.start + current.duration, Math.min(snapshot.duration, snapshot.position))
      return Math.min(snapshot.duration, anchored(tailFrom))
    }

    // A source is still loading. Hold rather than advance, because the element
    // restarts this segment from its in point once it is ready.
    return snapshot.position
  }, [])

  /** Walks the element's clock backwards, crossing clips through their tails. */
  const advanceReverse = useCallback((dt: number, rate: number) => {
    const video = videoRef.current
    const current = stateRef.current.segment
    if (!video || !current || video.readyState < 1) return
    reverseAccumulatorRef.current += rate * dt * fpsRef.current
    const frames = Math.floor(reverseAccumulatorRef.current)
    if (frames < 1) return
    reverseAccumulatorRef.current -= frames
    const target = video.currentTime - frames / fpsRef.current
    if (target > current.sourceIn) {
      video.currentTime = target
      return
    }
    const index = segmentIndexRef.current
    if (index <= 0) {
      video.currentTime = current.sourceIn
      reverseAccumulatorRef.current = 0
      return
    }
    // Enter the previous clip from its tail, since reverse arrives at its end.
    const previous = segmentsRef.current[index - 1]
    pendingSeekRef.current = previous.start + previous.duration - 1 / fpsRef.current
    anchorRef.current = null
    reverseAccumulatorRef.current = 0
    setPosition(pendingSeekRef.current)
    setSegmentIndex(index - 1)
  }, [])

  // Play and pause the transport with every added track. Re-runs when the segment
  // changes so a junction resumes instead of stalling.
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      // Reverse has no native rate, so the element is paused and stepped instead.
      video.playbackRate = shuttleRate > 0 ? Math.min(16, shuttleRate) : 1
      if (playing && shuttleRate >= 0) { applyPendingSeek(false); startPlayback() }
      else video.pause()
    }
    // Re-anchor whenever the transport moves, or resuming after a pause would
    // credit the paused wall time and jump the playhead forward.
    anchorRef.current = null
    reverseAccumulatorRef.current = 0
    // Added tracks only accompany ordinary forward playback, where they can stay
    // in step; they are dropped from a shuttle rather than smeared or desynced.
    const audible = playing && shuttleRate >= 0 && shuttleRate <= 1
    lanesRef.current.forEach((lane) => {
      const element = audioElements.current?.[lane.id]
      if (!element) return
      if (audible) void element.play().catch(() => { /* element may still be loading */ })
      else element.pause()
    })
  }, [playing, shuttleRate, segment?.key, audioLaneSignature, audioElements, applyPendingSeek, startPlayback])

  // Frame loop: advance the playhead, cross junctions, correct drift.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.25, Math.max(0, (now - previous) / 1000))
      previous = now
      if (shuttleRef.current < 0) advanceReverse(dt, Math.abs(shuttleRef.current))
      const next = readPosition()
      syncAddedAudio(next, false)
      // While a crossing or seek is in flight, the position and the segment index
      // are already decided. Letting the element's stale clock re-derive them here
      // is what would bounce the playhead back to the clip it just left.
      if (pendingSeekRef.current != null) return
      setPosition(next)
      const index = indexForTime(next)
      if (index !== segmentIndexRef.current) setSegmentIndex(index)
      if (next >= stateRef.current.duration - 0.01) {
        setPosition(stateRef.current.duration)
        setPlaying(false)
        setShuttleRateState(0)
      } else if (shuttleRef.current < 0 && next <= 0) {
        setPosition(0)
        setPlaying(false)
        setShuttleRateState(0)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, readPosition, syncAddedAudio, indexForTime, advanceReverse])

  const seek = useCallback((seconds: number) => {
    const bounded = Math.max(0, Math.min(stateRef.current.duration, seconds))
    const index = indexForTime(bounded)
    setPosition(bounded)
    setSegmentIndex(index)
    pendingSeekRef.current = bounded
    anchorRef.current = null
    reverseAccumulatorRef.current = 0
    applyPendingSeek(false)
    syncAddedAudio(bounded, true)
  }, [indexForTime, syncAddedAudio, applyPendingSeek])

  const setShuttleRate = useCallback((rate: number) => {
    setShuttleRateState(rate)
    anchorRef.current = null
    reverseAccumulatorRef.current = 0
  }, [])

  return {
    attachVideo,
    videoRef,
    segmentIndex,
    segment,
    position,
    playing,
    shuttleRate,
    error,
    toggle: useCallback(() => {
      if (!playable) return
      setShuttleRate(0)
      setPlaying((current) => !current)
    }, [playable, setShuttleRate]),
    pause: useCallback(() => { setShuttleRate(0); setPlaying(false) }, [setShuttleRate]),
    seek,
    step: useCallback((seconds: number) => {
      setShuttleRate(0)
      setPlaying(false)
      seek(stateRef.current.position + seconds)
    }, [seek, setShuttleRate]),
    /** Ramps in the pressed direction, so repeated presses speed up. */
    shuttle: useCallback((direction: 1 | -1) => {
      if (!playable) return
      setShuttleRateState((current) => nextShuttleRate(current, direction))
      anchorRef.current = null
      reverseAccumulatorRef.current = 0
      setPlaying(true)
    }, [playable]),
    setShuttleRate,
    clearError: useCallback(() => setError(null), []),
  }
}
