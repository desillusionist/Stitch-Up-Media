import { useCallback, useEffect, useRef, useState } from 'react'
import { TimelineModel, TimelineSegment } from '../lib/timelineModel'

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
  error: string | null
  toggle: () => void
  pause: () => void
  seek: (seconds: number) => void
  step: (seconds: number) => void
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
 * Three rules keep the transport honest:
 * - A seek is recorded and applied, never inferred from the element. Inferring it
 *   is what used to snap the playhead back to wherever the element last sat.
 * - A `play()` rejected with AbortError is a superseded load, not a stop request.
 * - A media `error` event carrying MEDIA_ERR_ABORTED is likewise not a failure.
 *
 * Together, the last two are why playback used to freeze at every junction.
 */
export const useConsolidatedPlayback = (
  model: TimelineModel,
  audioElements: React.RefObject<Record<string, HTMLAudioElement | null>>,
  options: { playable: boolean },
): ConsolidatedPlayback => {
  const { playable } = options
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const [position, setPosition] = useState(0)
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
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
  const loadedSourceRef = useRef<string | null>(null)
  /** Consolidated position waiting to be applied once the element can seek. */
  const pendingSeekRef = useRef<number | null>(null)
  /** Anchored clock for still frames and for material past the end of the video. */
  const anchorRef = useRef<{ position: number; startedAt: number; key: string | undefined } | null>(null)

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
    if (!video || !current) return
    if (!force && (video.readyState < 1 || loadedSourceRef.current !== current.sourcePath)) return
    const desired = pendingSeekRef.current
      ?? current.start + Math.max(0, Math.min(current.duration, stateRef.current.position - current.start))
    try {
      video.currentTime = current.sourceIn + Math.max(0, Math.min(current.duration, desired - current.start))
    } catch { /* element not seekable yet */ }
  }, [])

  const onLoaded = useCallback(() => {
    const video = videoRef.current
    const current = stateRef.current.segment
    if (!video) return
    loadedSourceRef.current = current?.sourcePath ?? null
    // Honour a seek made while this segment was loading, not merely its in point.
    applyPendingSeek(true)
    pendingSeekRef.current = null
    anchorRef.current = null
    setError(null)
    if (stateRef.current.playing) startPlayback()
  }, [applyPendingSeek, startPlayback])

  const onMediaError = useCallback(() => {
    const mediaError = videoRef.current?.error
    // Changing src aborts the pending load and reports it as an error; that is a
    // junction, not a broken source.
    if (mediaError && mediaError.code === MEDIA_ERR_ABORTED) return
    setError('UNABLE TO DECODE THIS SOURCE')
    setPlaying(false)
  }, [])

  /**
   * The element unmounts while a still frame is showing, so handlers are bound
   * from a callback ref rather than a mount-once effect. Otherwise the segment
   * after a still would have nobody listening for its metadata.
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
    // A remounted element may already hold metadata.
    if (element.readyState >= 1) onLoaded()
  }, [onLoaded, onMediaError])

  useEffect(() => () => { detachRef.current?.() }, [])

  /** The element's clock is authoritative while it is actually holding this segment. */
  const readPosition = useCallback(() => {
    const snapshot = stateRef.current
    const current = snapshot.segment
    const video = videoRef.current
    const now = performance.now()
    const anchored = (from: number) => {
      const anchor = anchorRef.current
      if (!anchor || anchor.key !== current?.key) {
        anchorRef.current = { position: from, startedAt: now, key: current?.key }
        return from
      }
      return anchor.position + (now - anchor.startedAt) / 1000
    }

    // A still frame occupies its duration with nothing decoding.
    if (current?.still) return Math.min(current.start + current.duration, anchored(current.start))

    if (video && current && video.readyState >= 1) {
      const local = video.currentTime - current.sourceIn
      if (!video.ended && local >= -0.05) {
        anchorRef.current = null
        return current.start + Math.max(0, local)
      }
      // The element finished this source but the timeline continues: an added
      // track can outlast the video, so the tail runs on the anchored clock.
      return Math.min(snapshot.duration, anchored(current.start + current.duration))
    }

    // A source is still loading. Hold rather than advance, because the element
    // restarts this segment from its in point once it is ready.
    return snapshot.position
  }, [])

  // Play and pause the transport with every added track. Re-runs when the segment
  // changes so a junction resumes instead of stalling.
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      if (playing) { applyPendingSeek(false); startPlayback() }
      else video.pause()
    }
    lanesRef.current.forEach((lane) => {
      const element = audioElements.current?.[lane.id]
      if (!element) return
      if (playing) void element.play().catch(() => { /* element may still be loading */ })
      else element.pause()
    })
  }, [playing, segment?.key, audioLaneSignature, audioElements, applyPendingSeek, startPlayback])

  // Frame loop: advance the playhead, cross junctions, correct drift.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const next = readPosition()
      setPosition(next)
      syncAddedAudio(next, false)
      const index = indexForTime(next)
      if (index !== segmentIndexRef.current) setSegmentIndex(index)
      if (next >= stateRef.current.duration - 0.01) {
        setPosition(stateRef.current.duration)
        setPlaying(false)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, readPosition, syncAddedAudio, indexForTime])

  const seek = useCallback((seconds: number) => {
    const bounded = Math.max(0, Math.min(stateRef.current.duration, seconds))
    const index = indexForTime(bounded)
    setPosition(bounded)
    setSegmentIndex(index)
    pendingSeekRef.current = bounded
    anchorRef.current = null
    // Remembered rather than inferred: if the target segment still has to load,
    // loadedmetadata applies this instead of the segment's in point.
    applyPendingSeek(false)
    syncAddedAudio(bounded, true)
  }, [indexForTime, syncAddedAudio, applyPendingSeek])

  return {
    attachVideo,
    videoRef,
    segmentIndex,
    segment,
    position,
    playing,
    error,
    toggle: useCallback(() => { if (playable) setPlaying((current) => !current) }, [playable]),
    pause: useCallback(() => setPlaying(false), []),
    seek,
    step: useCallback((seconds: number) => {
      setPlaying(false)
      seek(stateRef.current.position + seconds)
    }, [seek]),
    clearError: useCallback(() => setError(null), []),
  }
}
