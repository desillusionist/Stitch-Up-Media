import { useCallback, useEffect, useRef, useState } from 'react'
import { TimelineModel, TimelineSegment } from '../lib/timelineModel'
import { nextShuttleRate, nextTapRate } from '../lib/shuttleRates'
import { advanceClock, elementOwnsPosition } from '../lib/playbackClock'
import { DEFAULT_PREVIEW_SPEED, PreviewSpeed, clampPreviewSpeed, playbackRateFor, preservesPitchFor } from '../lib/previewSpeed'

/** How far a slaved element may drift before it is corrected, in seconds. */
const DRIFT_TOLERANCE = 0.25
/** MediaError.MEDIA_ERR_ABORTED: a load superseded by another, not a failure. */
const MEDIA_ERR_ABORTED = 1
/**
 * How long after the last tick of a scrub the gesture is taken to be over.
 *
 * A wheel fires many small events and never says when it has stopped, so the gesture is a gap rather than an
 * event: short enough that playback resumes the moment the reader's hand does, long enough that the frames
 * between two ticks of the same flick are not mistaken for two gestures.
 */
const SCRUB_IDLE_MS = 140

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
  /**
   * The preview speed being watched at, which is NOT the export's business and not the shuttle's.
   *
   * It multiplies the shuttle and the element's own rate: the monitor is played at this speed, and the
   * export is untouched. See `previewSpeed`.
   */
  speed: PreviewSpeed
  setSpeed: (rate: number) => void
  error: string | null
  toggle: () => void
  pause: () => void
  seek: (seconds: number) => void
  step: (seconds: number) => void
  /** Ramps the rate in the pressed direction, per the J/K/L ladder. */
  shuttle: (direction: 1 | -1) => void
  /**
   * A tap of the forward key: forward playback, onto the fast-forward rung rather than the ordinary speed.
   *
   * It is its own method rather than a call to `shuttle` because the ladder it climbs starts one rung higher —
   * see `nextTapRate` — and because the two are told apart by the key that asked, not by the rate they land on.
   */
  tapForward: () => void
  setShuttleRate: (rate: number) => void
  /**
   * A wheel- or drag-scrub of the playhead.
   *
   * It is a scrub rather than a seek because of who else writes the playhead: a plain `seek` during playback
   * leaves the auto-advance clock running, so a wheel tick and the element's own clock both write, the two
   * fight at every boundary, and the slaved audio is re-seeked on every tick. A scrub stands the auto-advance
   * clock down for the length of the gesture, so one writer at a time, and settles the added tracks and the
   * playback ONCE when it is over.
   */
  scrub: (seconds: number) => void
  /** A scrub by a delta, which is what a wheel gives: applied to the hook's own recorded position. */
  scrubBy: (delta: number) => void
  /** Ends a scrub gesture now, rather than waiting for the wheel to fall idle. */
  endScrub: () => void
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
 * The anchored clock runs at the shuttle rate, because it is the only clock a
 * still frame or a tail beyond the video has: without the rate a shuttle visibly
 * dropped to normal speed on entering such a segment while the indicator still
 * read 2x, 4x or 8x.
 *
 * Reverse playback cannot use a media element (there is no negative playback
 * rate), so the anchored clock owns the playhead outright and the element is
 * seeked frame by frame to paint it. Because that clock does not clamp at a
 * segment edge, reverse can cross a cut, which the frame loop commits.
 */
export const useConsolidatedPlayback = (
  model: TimelineModel,
  audioElements: React.RefObject<Record<string, HTMLAudioElement | null>>,
  options: { playable: boolean; fps: number },
): ConsolidatedPlayback => {
  const { playable, fps } = options
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  /**
   * The element the load handlers are bound to, so being handed it again is answered with nothing.
   *
   * A ref written as an arrow is a new function on every render, and React answers a changed ref by
   * detaching the old one and attaching the new — on every render. Attaching means binding the load
   * handlers and moving the element to the playhead, which is a MOUNT's work: run sixty times a second
   * it seeks the element sixty times a second, and the picture crawls and the element's own audio
   * breaks up. The monitor re-renders on every animation frame while it plays, so that is exactly what
   * it was doing. Remembering the element is what makes a re-attach of the same one a no-op.
   */
  const boundRef = useRef<HTMLVideoElement | null>(null)
  /**
   * A departure that has been asked for but has not gone through yet, so that the next thing to
   * arrive can cancel it. See `attachVideo`, which is the whole of why this exists.
   */
  const pendingDetachRef = useRef<number | null>(null)
  /**
   * Whether a scrub owns the playhead right now, and whether playback should pick up where it left off.
   *
   * The auto-advance clock reads this and stands down for the length of the gesture, so the wheel and the
   * element are never both writing the playhead — which is what made the skimmer fight itself at a cut and
   * re-seek the slaved audio on every tick.
   */
  const scrubbingRef = useRef(false)
  const resumeAfterScrubRef = useRef(false)
  const scrubEndRef = useRef<number | null>(null)
  const [position, setPosition] = useState(0)
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shuttleRate, setShuttleRateState] = useState(0)
  const [speed, setSpeedState] = useState<PreviewSpeed>(DEFAULT_PREVIEW_SPEED)
  const [error, setError] = useState<string | null>(null)

  const mainSegments = model.lanes[0]?.segments ?? []
  const segment = mainSegments[segmentIndex]
  /**
   * The lanes the transport drives, which is every lane that has an element of its own.
   *
   * Every added track, and a main lane that is AUDIO: such a lane has no picture for the video element to
   * carry, so its own <audio> is the only thing that can play it — which is what a CONVERT of an audio
   * file needs in order to be heard as well as drawn. Only a single-segment one, because this loop slaves
   * one element to one segment.
   *
   * The editor renders an element for exactly these lanes; the two tests have to agree.
   */
  const addedAudioLanes = model.lanes.filter((lane) => {
    if (!lane.segments.length) return false
    if (!lane.embedded) return true
    return lane.kind === 'audio' && lane.segments.length === 1
  })
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
  /** The preview speed, read by the frame loop and the rate setter, which are not re-made by a render. */
  const speedRef = useRef<number>(speed)
  speedRef.current = speed
  const fpsRef = useRef(fps)
  fpsRef.current = Math.max(1, fps)
  /**
   * Whether the main lane has no picture at all, which is what a CONVERT of a sound file is.
   *
   * Such a job has no video element to own the playhead and never will have one, so the clock has to fall
   * back to the anchored one and the lane's own <audio> is slaved to it. A ref because the clock reads it
   * every frame and a captured value would be the one from the first render.
   */
  const silentMainLaneRef = useRef(false)
  silentMainLaneRef.current = (model.lanes[0]?.kind ?? 'video') === 'audio'
  const loadedSourceRef = useRef<string | null>(null)
  /** Consolidated position waiting to be applied once the element can seek. */
  const pendingSeekRef = useRef<number | null>(null)
  /** Anchored clock for stills, reverse, and material past the end of the video. */
  const anchorRef = useRef<{ position: number; startedAt: number; key: string | undefined; direction: 1 | -1; rate: number } | null>(null)

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

  /**
   * Applies the shuttle rate to the element.
   *
   * This has to be redone whenever an element is created or its media is loaded,
   * because both reset the rate: a newly created element starts at its default, and
   * the media load algorithm assigns `playbackRate` from `defaultPlaybackRate`.
   * A segment whose media has to be resolved first, an image sequence playing
   * through its generated clip, mounts its element after the transport effect has
   * already run, which is why a forward shuttle dropped to normal speed on entering
   * one while the indicator still read 2x, 4x or 8x. Reverse was unaffected because
   * it seeks rather than plays.
   */
  const applyRate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    // The shuttle's rate and the speed being watched at, composed — see `playbackRateFor`. Reverse has no
    // native rate, so the element is left at 1x (times the speed) and stepped to paint the frames instead.
    video.playbackRate = playbackRateFor(shuttleRef.current, speedRef.current)
    // Pitch-corrected for a steady speed, raised for a fast-forward — see `preservesPitchFor`, which is where
    // the whole of that distinction lives.
    video.preservesPitch = preservesPitchFor(shuttleRef.current)
  }, [])

  const onLoaded = useCallback(() => {
    const video = videoRef.current
    const current = stateRef.current.segment
    if (!video) return
    loadedSourceRef.current = current?.sourcePath ?? null
    applyPendingSeek(true)
    applyRate()
    anchorRef.current = null
    setError(null)
    if (stateRef.current.playing && shuttleRef.current >= 0) startPlayback()
  }, [applyPendingSeek, applyRate, startPlayback])

  const onMediaError = useCallback(() => {
    const mediaError = videoRef.current?.error
    if (mediaError && mediaError.code === MEDIA_ERR_ABORTED) return
    pendingSeekRef.current = null
    setError('UNABLE TO DECODE THIS SOURCE')
    setPlaying(false)
  }, [])

  /** Lets go of the element the handlers are bound to, if any. */
  const unbindVideo = useCallback(() => {
    detachRef.current?.()
    detachRef.current = null
    boundRef.current = null
  }, [])

  /**
   * The element unmounts while a still frame is showing, so handlers are bound
   * from a callback ref rather than a mount-once effect.
   *
   * Handed the element it is already bound to, it does nothing: see `boundRef`. That is the whole
   * difference between a callback ref and a mount handler, and it is what a ref that changes identity
   * every render needs of one.
   *
   * A bare `null` is not taken as a departure until the commit is over, and that delay is the point.
   * React answers a changed ref by calling the old one with null and the new one with the element
   * again — in the SAME commit, back to back — so a null followed by the same element is not a change
   * at all, and treating it as one is exactly how this element came to be unbound and rebound sixty
   * times a second. What comes next cancels the departure; only a null that nothing follows takes the
   * binding away, one turn later.
   */
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    if (pendingDetachRef.current !== null) {
      window.clearTimeout(pendingDetachRef.current)
      pendingDetachRef.current = null
    }
    videoRef.current = element
    if (element) {
      if (boundRef.current === element) return
      unbindVideo()
      boundRef.current = element
      element.addEventListener('loadedmetadata', onLoaded)
      element.addEventListener('error', onMediaError)
      detachRef.current = () => {
        element.removeEventListener('loadedmetadata', onLoaded)
        element.removeEventListener('error', onMediaError)
      }
      applyRate()
      if (element.readyState >= 1) onLoaded()
      return
    }
    if (!boundRef.current) return
    pendingDetachRef.current = window.setTimeout(() => {
      pendingDetachRef.current = null
      unbindVideo()
      loadedSourceRef.current = null
    }, 0)
  }, [onLoaded, onMediaError, applyRate, unbindVideo])

  useEffect(() => () => { unbindVideo() }, [unbindVideo])

  /** The clock that owns the playhead whenever no element is entitled to. */
  const readPosition = useCallback(() => {
    const snapshot = stateRef.current
    const current = snapshot.segment
    const video = videoRef.current
    const now = performance.now()
    // A crossing or seek is in flight. Holding is the only safe answer, because
    // the element still holds the previous source and would report its clock.
    if (pendingSeekRef.current != null) return snapshot.position
    const reverse = shuttleRef.current < 0
    /**
     * Advances the fallback clock, running at the shuttle rate so a shuttle keeps
     * its speed across a container change. It rebases on the value it just
     * computed rather than on the rendered position: that lags a frame, and
     * rebasing on it rewound the playhead at every crossing.
     */
    const anchored = (from: number) => {
      const advanced = advanceClock(anchorRef.current, {
        from,
        now,
        key: current?.key,
        reverse,
        shuttleRate: shuttleRef.current,
        // The speed is the anchored clock's business too: a still or a tail has no element to carry it, so
        // without this a preview at another speed would drop back to 1x for the length of that segment.
        speed: speedRef.current,
      })
      anchorRef.current = advanced.anchor
      return advanced.value
    }

    // Reverse has no element clock and no way to leave a segment backwards through
    // one, so the anchored clock owns the playhead and is free to cross a cut. The
    // frame loop commits the crossing; clamping here would stall on the boundary.
    if (reverse) {
      const from = Math.max(0, Math.min(snapshot.duration, snapshot.position))
      return Math.max(0, Math.min(snapshot.duration, anchored(from)))
    }

    // A still frame has no element clock, so it advances on the anchored clock. The
    // clamp is to the segment end, which still lets the crossing happen because
    // indexForTime reads the end of a segment as the start of the next one. A main lane that is
    // nothing but AUDIO is the same case for the same reason — there is no element to own the playhead
    // and never will be — which is what lets a CONVERT of a sound file play rather than stand still.
    if (current?.still || (silentMainLaneRef.current && !video)) {
      const from = Math.max(current.start, Math.min(current.start + current.duration, snapshot.position))
      return Math.min(current.start + current.duration, anchored(from))
    }

    if (video && current && video.readyState >= 1) {
      const owns = elementOwnsPosition(current, snapshot.position, { readyState: video.readyState, ended: video.ended, clock: video.currentTime })
      if (owns) {
        anchorRef.current = null
        return current.start + Math.max(0, video.currentTime - current.sourceIn)
      }
      // The element finished this source, or the playhead is beyond it: an added
      // track can outlast the video, so the tail runs on the anchored clock,
      // continuing from wherever the playhead already sits.
      const tailFrom = Math.max(current.start + current.duration, Math.min(snapshot.duration, snapshot.position))
      return Math.min(snapshot.duration, anchored(tailFrom))
    }

    // A source is still loading. Hold rather than advance, because the element
    // restarts this segment from its in point once it is ready.
    return snapshot.position
  }, [])

  /**
   * Paints the frame at a reverse position. The element cannot run backwards, so it
   * is seeked instead of played and this is the only thing that moves the picture.
   */
  const renderReverseFrame = useCallback((seconds: number) => {
    const video = videoRef.current
    const current = stateRef.current.segment
    if (!video || !current || current.still || video.readyState < 1) return
    if (loadedSourceRef.current !== current.sourcePath) return
    const target = current.sourceIn + Math.max(0, Math.min(current.duration, seconds - current.start))
    // Half a frame of slack keeps a paused playhead from seeking on every tick while
    // still landing on each frame the clock walks through.
    if (Math.abs(video.currentTime - target) < 0.5 / fpsRef.current) return
    try { video.currentTime = target } catch { /* not seekable yet */ }
  }, [])

  // Play and pause the transport with every added track. Re-runs when the segment
  // changes so a junction resumes instead of stalling.
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      // Reverse has no native rate, so the element is paused and stepped instead.
      applyRate()
      // While a scrub is in flight this effect is skipped from starting playback back up: a scrub that crossed
      // a cut changes the segment, and resuming here would break the one-writer rule the scrub exists for.
      if (playing && shuttleRate >= 0 && !scrubbingRef.current) { applyPendingSeek(false); startPlayback() }
      else video.pause()
    }
    // Re-anchor whenever the transport moves, or resuming after a pause would
    // credit the paused wall time and jump the playhead forward. Resuming is safe
    // because the anchor is rebuilt from the position the playhead already holds.
    anchorRef.current = null
    // Added tracks accompany FORWARD playback at any rate, where they can stay in step — a fast-forward is
    // heard as a fast-forward, with its pitch raised, which is what a tape transport sounds like and what the
    // pitch rule beside it is for. REVERSE is the only case that is silent: an element cannot run backwards,
    // so there is nothing playing at all, and the picture is repainted by seeking instead.
    //
    // What an added track is played at: the same composed rate the picture element is given, so the two never
    // drift apart.
    const rate = playbackRateFor(shuttleRate, speed)
    const audible = playing && shuttleRate >= 0
    lanesRef.current.forEach((lane) => {
      const element = audioElements.current?.[lane.id]
      if (!element) return
      element.playbackRate = rate
      element.preservesPitch = preservesPitchFor(shuttleRate)
      if (audible) void element.play().catch(() => { /* element may still be loading */ })
      else element.pause()
    })
  }, [playing, shuttleRate, speed, segment?.key, audioLaneSignature, audioElements, applyPendingSeek, applyRate, startPlayback])

  // Frame loop: advance the playhead, cross junctions, correct drift.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      // A scrub owns the playhead while it is happening. Standing the auto-advance clock down here is what
      // makes it ONE writer: the wheel positions the playhead and the element is paused, so the two cannot
      // bounce the playhead between them at a cut or re-seek the slaved audio on every frame.
      if (scrubbingRef.current) return
      const reverse = shuttleRef.current < 0
      const next = readPosition()
      syncAddedAudio(next, false)
      // While a crossing or seek is in flight, the position and the segment index
      // are already decided. Letting the element's stale clock re-derive them here
      // is what would bounce the playhead back to the clip it just left.
      if (pendingSeekRef.current != null) return
      const index = indexForTime(next)
      const crossing = index !== segmentIndexRef.current
      // Reverse only moves because of this, and a crossing has no element yet, so
      // painting there would show the outgoing source at the cut instead.
      if (reverse && !crossing) renderReverseFrame(next)
      setPosition(next)
      if (crossing) {
        // Crossing a cut backwards: the incoming element has to be parked on the
        // frame the clock already reached, which its load handler applies. A still
        // renders no element and so never loads one, so a pending seek there would
        // hold the playhead for good.
        const incoming = segmentsRef.current[index]
        if (reverse && incoming && !incoming.still) pendingSeekRef.current = next
        setSegmentIndex(index)
      }
      // Reaching the end stops forward playback only. At the end is exactly where a
      // reverse shuttle starts, so stopping there too made J do nothing at all.
      if (!reverse && next >= stateRef.current.duration - 0.01) {
        setPosition(stateRef.current.duration)
        setPlaying(false)
        setShuttleRateState(0)
      } else if (reverse && next <= 0) {
        setPosition(0)
        setPlaying(false)
        setShuttleRateState(0)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, readPosition, syncAddedAudio, indexForTime, renderReverseFrame])

  const seek = useCallback((seconds: number) => {
    const bounded = Math.max(0, Math.min(stateRef.current.duration, seconds))
    const index = indexForTime(bounded)
    setPosition(bounded)
    setSegmentIndex(index)
    pendingSeekRef.current = bounded
    anchorRef.current = null
    applyPendingSeek(false)
    syncAddedAudio(bounded, true)
  }, [indexForTime, syncAddedAudio, applyPendingSeek])

  /** Ends a scrub: the added tracks and, if it was playing, the playback settle once, from the final position. */
  const finishScrub = useCallback(() => {
    if (scrubEndRef.current != null) { window.clearTimeout(scrubEndRef.current); scrubEndRef.current = null }
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    const wasPlaying = resumeAfterScrubRef.current
    resumeAfterScrubRef.current = false
    // The slaved tracks were re-seeked on every tick of the gesture before this; now they are brought to the
    // settled playhead ONCE. That single re-seek is what stops the audio breaking up under a wheel.
    syncAddedAudio(stateRef.current.position, true)
    anchorRef.current = null
    if (!wasPlaying) return
    const video = videoRef.current
    if (video) { applyPendingSeek(false); startPlayback() }
    // A main lane that is nothing but sound has no element to resume, but its own added lane does, and the
    // element-playing effect will not re-run for it because `playing` never changed. So the lanes are resumed
    // here, at the same composed rate and with the same pitch rule the effect would have used.
    const rate = playbackRateFor(shuttleRef.current, speedRef.current)
    const audible = shuttleRef.current >= 0
    lanesRef.current.forEach((lane) => {
      const element = audioElements.current?.[lane.id]
      if (!element) return
      element.playbackRate = rate
      element.preservesPitch = preservesPitchFor(shuttleRef.current)
      if (audible) void element.play().catch(() => { /* element may still be loading */ })
    })
  }, [syncAddedAudio, applyPendingSeek, startPlayback, audioElements])

  /**
   * Starts a scrub if one is not already in flight, remembering whether playback should resume after it.
   *
   * The elements are stood down here so nothing else advances while the reader scrubs. Reverse already runs on
   * the anchored clock and paints by seeking, so it is left alone — there is nothing playing backwards to stop.
   */
  const beginScrub = useCallback(() => {
    if (scrubbingRef.current) return
    scrubbingRef.current = true
    resumeAfterScrubRef.current = stateRef.current.playing && shuttleRef.current >= 0
    if (shuttleRef.current >= 0) {
      videoRef.current?.pause()
      lanesRef.current.forEach((lane) => { audioElements.current?.[lane.id]?.pause() })
    }
  }, [audioElements])

  /** Positions the playhead for a scrub and re-arms the idle timer that ends the gesture. */
  const positionScrub = useCallback((seconds: number) => {
    const bounded = Math.max(0, Math.min(stateRef.current.duration, seconds))
    const index = indexForTime(bounded)
    setPosition(bounded)
    setSegmentIndex(index)
    pendingSeekRef.current = bounded
    anchorRef.current = null
    applyPendingSeek(false)
    if (scrubEndRef.current != null) window.clearTimeout(scrubEndRef.current)
    scrubEndRef.current = window.setTimeout(() => finishScrub(), SCRUB_IDLE_MS)
  }, [indexForTime, applyPendingSeek, finishScrub])

  /** A scrub to an absolute position, which is what a pointer drag reads off the timeline. */
  const scrub = useCallback((seconds: number) => { beginScrub(); positionScrub(seconds) }, [beginScrub, positionScrub])

  /**
   * A scrub by a DELTA, which is what a wheel is.
   *
   * The delta is applied to the hook's own recorded position, not to the position the caller can see: a burst
   * of wheel events arrives faster than a render, so a caller adding to the rendered value would pile several
   * ticks onto one stale figure and the playhead would lag the wheel.
   */
  const scrubBy = useCallback((delta: number) => { beginScrub(); positionScrub(stateRef.current.position + delta) }, [beginScrub, positionScrub])

  const setShuttleRate = useCallback((rate: number) => {
    setShuttleRateState(rate)
    anchorRef.current = null
  }, [])

  /**
   * Rewinds when playback is asked to start from the very end.
   *
   * A finished transport sits on the last frame, where starting forward would stop
   * again on the same frame and look like the play button had done nothing. Reverse
   * is left alone, because the end is a perfectly good place to shuttle back from.
   */
  const restartIfFinished = useCallback((direction: 1 | -1) => {
    if (direction < 0) return
    const { playing: running, position: at, duration: total } = stateRef.current
    if (!running && total > 0 && at >= total - 0.01) seek(0)
  }, [seek])

  return {
    attachVideo,
    videoRef,
    segmentIndex,
    segment,
    position,
    playing,
    shuttleRate,
    speed,
    setSpeed: useCallback((rate: number) => {
      setSpeedState(clampPreviewSpeed(rate))
      // Re-anchored exactly as the shuttle's own rate change is, so the position is held at the moment the
      // speed changes rather than being credited the wall time at the old rate.
      anchorRef.current = null
    }, []),
    error,
    toggle: useCallback(() => {
      if (!playable) return
      setShuttleRate(0)
      if (stateRef.current.playing) { setPlaying(false); return }
      restartIfFinished(1)
      setPlaying(true)
    }, [playable, setShuttleRate, restartIfFinished]),
    pause: useCallback(() => { setShuttleRate(0); setPlaying(false) }, [setShuttleRate]),
    seek,
    scrub,
    scrubBy,
    endScrub: finishScrub,
    step: useCallback((seconds: number) => {
      setShuttleRate(0)
      setPlaying(false)
      seek(stateRef.current.position + seconds)
    }, [seek, setShuttleRate]),
    /** Ramps in the pressed direction, so repeated presses speed up. */
    shuttle: useCallback((direction: 1 | -1) => {
      if (!playable) return
      restartIfFinished(direction)
      setShuttleRateState((current) => nextShuttleRate(current, direction))
      anchorRef.current = null
      setPlaying(true)
    }, [playable, restartIfFinished]),
    /** A tap of the forward key. See `nextTapRate` for why it does not start on the ordinary speed. */
    tapForward: useCallback(() => {
      if (!playable) return
      restartIfFinished(1)
      setShuttleRateState((current) => nextTapRate(current))
      anchorRef.current = null
      setPlaying(true)
    }, [playable, restartIfFinished]),
    setShuttleRate,
    clearError: useCallback(() => setError(null), []),
  }
}
