import { useCallback, useEffect, useRef, useState } from 'react'
import { TimelineModel, TimelineSegment } from '../lib/timelineModel'

/** How far a slaved element may drift before it is corrected, in seconds. */
const DRIFT_TOLERANCE = 0.25

export interface ConsolidatedPlayback {
  videoRef: React.RefObject<HTMLVideoElement>
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
 * audio stay in sync by construction. Added audio tracks, and any material that
 * outlasts the video lane, are slaved to that clock and corrected only once they
 * drift past a tolerance, which keeps playback smooth instead of chasing frames.
 *
 * Segment junctions are crossed by pointing the same element at the next source,
 * so audio never stops while the playhead sweeps the timeline.
 */
export const useConsolidatedPlayback = (
  model: TimelineModel,
  audioElements: React.RefObject<Record<string, HTMLAudioElement | null>>,
  options: { playable: boolean },
): ConsolidatedPlayback => {
  const { playable } = options
  const videoRef = useRef<HTMLVideoElement>(null)
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
  const tailAnchorRef = useRef<{ position: number; startedAt: number } | null>(null)

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

  /** The element's own clock is authoritative while the main lane still has media. */
  const readPosition = useCallback(() => {
    const video = videoRef.current
    const snapshot = stateRef.current
    const current = snapshot.segment
    if (video && current && video.readyState >= 1 && !video.ended) {
      const local = video.currentTime - current.sourceIn
      if (local >= -0.05) {
        tailAnchorRef.current = null
        return current.start + Math.max(0, local)
      }
    }
    // Past the end of the main lane: added audio can outlast the video, so fall
    // back to a wall clock rather than freezing the playhead.
    const now = performance.now()
    const anchor = tailAnchorRef.current
    if (!anchor) {
      tailAnchorRef.current = { position: snapshot.position, startedAt: now }
      return snapshot.position
    }
    return Math.min(snapshot.duration, anchor.position + (now - anchor.startedAt) / 1000)
  }, [])

  // Bind element events once; everything mutable is read through refs.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onLoaded = () => {
      const current = stateRef.current.segment
      loadedSourceRef.current = current?.sourcePath ?? null
      if (current && current.sourceIn > 0) {
        try { video.currentTime = current.sourceIn } catch { /* seek before readiness is ignored */ }
      }
      if (stateRef.current.playing) void video.play().catch(() => setPlaying(false))
    }
    const onError = () => { setError('UNABLE TO DECODE THIS SOURCE'); setPlaying(false) }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
  }, [])

  // Play and pause the main element together with every added track.
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      if (playing) void video.play().catch(() => setPlaying(false))
      else video.pause()
    }
    lanesRef.current.forEach((lane) => {
      const element = audioElements.current?.[lane.id]
      if (!element) return
      if (playing) void element.play().catch(() => { /* element may still be loading */ })
      else element.pause()
    })
  }, [playing, audioLaneSignature, audioElements])

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
    const target = segmentsRef.current[index]
    setPosition(bounded)
    setSegmentIndex(index)
    tailAnchorRef.current = null
    const video = videoRef.current
    // Same source: seek directly. Different source: the src change reloads the
    // element, and loadedmetadata positions it at the segment's in point.
    if (video && target && loadedSourceRef.current === target.sourcePath) {
      const desired = target.sourceIn + Math.max(0, Math.min(target.duration, bounded - target.start))
      try { video.currentTime = desired } catch { /* not seekable yet */ }
    }
    syncAddedAudio(bounded, true)
  }, [indexForTime, syncAddedAudio])

  return {
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
