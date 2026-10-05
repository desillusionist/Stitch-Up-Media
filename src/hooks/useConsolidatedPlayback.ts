import { useCallback, useEffect, useRef, useState } from 'react'
import { TimelineModel, TimelineSegment, audioSlaveKey, laneNeedsOwnAudio } from '../lib/timelineModel'
import { nextShuttleRate, nextForwardRung } from '../lib/shuttleRates'
import { advanceClock, elementOwnsPosition } from '../lib/playbackClock'
import { DEFAULT_PREVIEW_SPEED, MAX_PLAYBACK_RATE, PreviewSpeed, clampPreviewSpeed, playbackRateFor, preservesPitchFor } from '../lib/previewSpeed'
import { sourceTimeAt, timelineTimeAt } from '../lib/clipSpeed'
import { scrubRateFor } from '../lib/scrubAudio'

/** How far a slaved element may drift before it is corrected, in seconds. */
const DRIFT_TOLERANCE = 0.25
/** MediaError.MEDIA_ERR_ABORTED: a load superseded by another, not a failure. */
const MEDIA_ERR_ABORTED = 1
/**
 * How long after the last tick of a scrub the gesture is taken to be over.
 *
 * A wheel fires many small events and never says when it has stopped, so the gesture is a gap rather than an
 * event: short enough that playback resumes the moment the reader's hand does, long enough that a slow turn
 * between two notches is not mistaken for the end of the gesture.
 */
const SCRUB_IDLE_MS = 200
/** How far a slaved track may drift from the scrubbed playhead before the scrub corrects it with a seek. */
const SCRUB_DRIFT_SECONDS = 0.25

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
   * A tap of the forward key: PLAY from rest, or the next speed rung up when already running.
   *
   * It writes the SAME speed value the selector and the wheel write, and clears the shuttle first, so a tap
   * ramps from whatever was set there rather than from the shuttle's own ladder. From rest it is simply PLAY
   * at the ordinary speed; the fast-forward is for a transport already running. See `nextForwardRung`.
   */
  accelerate: () => void
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
  /**
   * The last tick of a scrub: when it happened, where the playhead was left, and the rate the sound is at.
   *
   * The velocity between two ticks is what the sound is driven at, so the previous tick is the whole of what
   * a new one needs to know. Reset at the start of a gesture.
   */
  const scrubTickRef = useRef<{ at: number; position: number; rate: number } | null>(null)
  const [position, setPosition] = useState(0)
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shuttleRate, setShuttleRateState] = useState(0)
  const [speed, setSpeedState] = useState<PreviewSpeed>(DEFAULT_PREVIEW_SPEED)
  const [error, setError] = useState<string | null>(null)

  const mainSegments = model.lanes[0]?.segments ?? []
  const segment = mainSegments[segmentIndex]
  const slaveLanes = model.lanes.filter(laneNeedsOwnAudio)
  /**
   * One entry per SEGMENT of those lanes, not one per lane.
   *
   * A lane can hold several tracks joined end to end — a COMBO/MULTI-TRACK whose tracks are STITCHED, or a
   * STITCH UP of sound — and a single element slaved to the lane's first segment played only that one and
   * left the rest silent. An element per segment, each with the segment's own source, is what lets every
   * track of a joined lane be heard and what stops a finished segment from sounding under the one after it.
   *
   * The editor renders an element for exactly these segments; the two lists have to agree.
   */
  const slaves = slaveLanes.flatMap((lane) => lane.segments.map((segment, index) => ({ key: audioSlaveKey(lane.id, index), segment })))
  const slaveSignature = slaves.map((slave) => slave.key).join('|')

  // Read inside event handlers and the frame loop so they never capture stale values.
  const stateRef = useRef({ segment, playing, position, duration: model.duration })
  stateRef.current = { segment, playing, position, duration: model.duration }
  const segmentsRef = useRef(mainSegments)
  segmentsRef.current = mainSegments
  const slavesRef = useRef(slaves)
  slavesRef.current = slaves
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
    slavesRef.current.forEach(({ key, segment }) => {
      const element = audioElements.current?.[key]
      if (!element) return
      // ONLY THE SEGMENT THE PLAYHEAD IS INSIDE SOUNDS. A lane of several joined tracks has an element per
      // segment, so every element must be parked outside its own span: a segment before the playhead is not
      // yet playing, and one the playhead has LEFT is exactly the final syllable that used to cycle under the
      // picture while the rest of the job ran on. `sourceTimeAt` clamps to the segment, so a seek is only
      // ever asked for while the playhead is inside it.
      const active = stateRef.current.playing && seconds >= segment.start && seconds < segment.start + segment.duration
      if (!active) {
        if (!element.paused) element.pause()
        return
      }
      // The track's own speed maps the timeline offset onto the source: a clip retimed to 2x is two
      // source seconds in for every one the playhead has crossed, which is the same mapping the
      // picture element is given and the same one the encoder writes — see `sourceTimeAt`.
      const desired = sourceTimeAt(seconds, segment)
      if (force || Math.abs(element.currentTime - desired) > DRIFT_TOLERANCE) element.currentTime = desired
      if (element.paused) void element.play().catch(() => { /* element may still be loading */ })
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
      video.currentTime = sourceTimeAt(desired, current)
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
    const current = stateRef.current.segment
    // The shuttle's rate and the speed being watched at, composed — see `playbackRateFor` — then the
    // CLIP's own speed, which is what makes a sped clip play fast in the monitor as it does in the
    // file. Reverse has no native rate, so the element is left at the clip's rate and stepped to paint
    // the frames instead.
    const clip = current && current.speed > 0 ? current.speed : 1
    video.playbackRate = playbackRateFor(shuttleRef.current, speedRef.current * clip)
    // Pitch-corrected for a steady speed, raised for a fast-forward — see `preservesPitchFor` — and
    // raised again for a clip that asked for its pitch to ride the speed.
    video.preservesPitch = preservesPitchFor(shuttleRef.current) && (!current || current.maintainPitch !== false)
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
        return timelineTimeAt(video.currentTime, current)
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
    const target = sourceTimeAt(seconds, current)
    // Half a frame of slack keeps a paused playhead from seeking on every tick while
    // still landing on each frame the clock walks through.
    if (Math.abs(video.currentTime - target) < 0.5 / fpsRef.current) return
    try { video.currentTime = target } catch { /* not seekable yet */ }
  }, [])

  // Play and pause the transport with every added track. Re-runs when the segment
  // changes so a junction resumes instead of stalling.
  useEffect(() => {
    const video = videoRef.current
    // A SCRUB OWNS THE SOUND AND THE PLAY STATE while it is in flight. This effect stands aside so it neither
    // pauses the picture (which is what silenced a scrub over a still or the tail) nor resets the slaved tracks
    // to their ordinary rate — the scrub sets that rate itself, and the settle from `finishScrub` puts it back.
    if (scrubbingRef.current) { anchorRef.current = null; return }
    if (video) {
      // Reverse has no native rate, so the element is paused and stepped instead.
      applyRate()
      if (playing && shuttleRate >= 0) { applyPendingSeek(false); startPlayback() }
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
    // What an added track is played at: the composed rate the picture element is given, so the two never drift
    // apart — EXCEPT in reverse, where an element cannot run at a negative rate. There the shuttle's MAGNITUDE
    // is used and the track plays FORWARD while the anchored clock walks the playhead back, the clock's own
    // drift correction pulling it onto the playhead as it goes. That is a rewind rather than a true reversal —
    // the same trade a backward scrub makes, and for the same reason — and it is deliberately audible: pausing
    // the track outright, which is what this was, is why J had no sound at all.
    const reverse = shuttleRate < 0
    const composed = reverse ? (Math.abs(shuttleRate) || 1) * speed : playbackRateFor(shuttleRate, speed)
    slavesRef.current.forEach(({ key, segment: slaveSegment }) => {
      const element = audioElements.current?.[key]
      if (!element) return
      // The lane's clip carries its own speed, and the track is driven at the composed rate times it, so
      // a retimed track is heard as fast as the picture beside it plays. Its pitch follows the same rule
      // the picture element's does: kept unless the clip asked for it to ride the speed.
      const clip = slaveSegment.speed > 0 ? slaveSegment.speed : 1
      element.playbackRate = Math.min(MAX_PLAYBACK_RATE, composed * clip)
      element.preservesPitch = preservesPitchFor(shuttleRate) && slaveSegment.maintainPitch !== false
    })
    // START, STOP AND SEEK each element onto its OWN segment in one place, so a lane of several joined tracks
    // resumes the one under the playhead and parks the rest rather than starting them all together.
    syncAddedAudio(stateRef.current.position, false)
  }, [playing, shuttleRate, speed, segment?.key, slaveSignature, audioElements, applyPendingSeek, applyRate, startPlayback, syncAddedAudio])

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

  /**
   * Ends a scrub: the tracks are put onto the settled playhead and given back their ordinary rate, ONCE.
   *
   * Nothing here resumes the picture, because nothing ever paused it: the scrub drives the sound by rate and
   * leaves the element running, so the picture and its own sound were audible throughout. If the transport was
   * stopped before the scrub it is stopped here too — a wheel over a paused job is a seek and nothing more.
   */
  const finishScrub = useCallback(() => {
    if (scrubEndRef.current != null) { window.clearTimeout(scrubEndRef.current); scrubEndRef.current = null }
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    scrubTickRef.current = null
    const wasPlaying = resumeAfterScrubRef.current
    resumeAfterScrubRef.current = false
    const settled = stateRef.current.position
    if (wasPlaying) {
      const video = videoRef.current
      if (video) { applyPendingSeek(false); startPlayback() }
    }
    // ONE settle: the tracks were driven by rate through the gesture and are now brought onto the settled
    // playhead and handed back the rate they would have had without the scrub.
    syncAddedAudio(settled, true)
    const rate = playbackRateFor(shuttleRef.current, speedRef.current)
    slavesRef.current.forEach(({ key, segment: slaveSegment }) => {
      const element = audioElements.current?.[key]
      if (!element) return
      const clip = slaveSegment.speed > 0 ? slaveSegment.speed : 1
      element.playbackRate = Math.min(MAX_PLAYBACK_RATE, rate * clip)
      element.preservesPitch = preservesPitchFor(shuttleRef.current) && slaveSegment.maintainPitch !== false
      // The segment the settled playhead rests inside is the only one woken, so a scrub that ended over the
      // second of a joined lane leaves the first parked.
      const active = wasPlaying && settled >= slaveSegment.start && settled < slaveSegment.start + slaveSegment.duration
      if (active) void element.play().catch(() => { /* element may still be loading */ })
      else element.pause()
    })
  }, [syncAddedAudio, applyPendingSeek, startPlayback, audioElements])

  /**
   * Drives the slaved tracks to follow a scrub by RATE, correcting with a seek only once one has drifted.
   *
   * This is the whole of the still/placeholder fix. Driving the sound by per-tick seeks tore the decoder down
   * and restarted it faster than it could start, which read as a jog; setting the rate and letting the element
   * play on has no such seam, and because the rate tracks the wheel the sound is sped with the scroll. A seek
   * is held in reserve for the case the rate cannot keep up — a backward drag, where the element plays forward
   * while the playhead walks back — and fires only past `SCRUB_DRIFT_SECONDS`, a handful of times at most.
   */
  const driveScrubAudio = useCallback((position: number, rate: number) => {
    slavesRef.current.forEach(({ key, segment }) => {
      const element = audioElements.current?.[key]
      if (!element) return
      // ONLY the segment under the scrub's playhead is driven: the rest are parked, so a scrub across a lane
      // of joined tracks hands the sound from one segment to the next rather than playing them all at once.
      if (position < segment.start || position >= segment.start + segment.duration) {
        if (!element.paused) element.pause()
        return
      }
      const laneClip = segment.speed > 0 ? segment.speed : 1
      element.playbackRate = Math.min(MAX_PLAYBACK_RATE, rate * laneClip)
      element.preservesPitch = true
      const desired = sourceTimeAt(position, segment)
      if (Math.abs(element.currentTime - desired) > SCRUB_DRIFT_SECONDS) element.currentTime = desired
    })
  }, [audioElements])

  /**
   * Starts a scrub if one is not already in flight, remembering whether playback should pick up after it.
   *
   * NOTHING is paused here, and that is the whole of the change from the pass that silenced the sound: the
   * slaved tracks are only made sure to be running, so the rate the scrub sets has something to act on. Reverse
   * is left alone — there is nothing playing backwards to drive.
   */
  const beginScrub = useCallback(() => {
    if (scrubbingRef.current) return
    scrubbingRef.current = true
    // Seeded with where and when the GESTURE began, not left empty: the very first tick then has a previous
    // tick to measure its velocity against, so the sound is driven at the wheel's speed from the first event
    // rather than lagging for two of them and having to be corrected.
    scrubTickRef.current = { at: performance.now(), position: stateRef.current.position, rate: 1 }
    resumeAfterScrubRef.current = stateRef.current.playing && shuttleRef.current >= 0
    if (!resumeAfterScrubRef.current) return
    // Only the segment under the playhead is woken: the rest of a joined lane's segments are parked, and
    // playing them all here is what would put every track of the lane on at once for the gesture's length.
    const position = stateRef.current.position
    slavesRef.current.forEach(({ key, segment }) => {
      const element = audioElements.current?.[key]
      if (!element) return
      if (position < segment.start || position >= segment.start + segment.duration) return
      element.preservesPitch = true
      void element.play().catch(() => { /* element may still be loading */ })
    })
  }, [audioElements])

  /**
   * Positions the playhead for a scrub and re-arms the idle timer that ends the gesture.
   *
   * The velocity of the wheel — how much timeline the last tick moved, over how long — is what the sound is
   * driven at, so a slow drag plays slow and a flick plays fast. It is measured between ticks here rather than
   * asked of the caller: the wheel gives deltas, and only the hook knows how long ago the last one was.
   */
  const positionScrub = useCallback((seconds: number) => {
    const bounded = Math.max(0, Math.min(stateRef.current.duration, seconds))
    const now = performance.now()
    const tick = scrubTickRef.current
    const previous = tick?.rate ?? 1
    const rate = tick ? scrubRateFor((bounded - tick.position) / Math.max(0.008, (now - tick.at) / 1000), previous) : previous
    scrubTickRef.current = { at: now, position: bounded, rate }
    setPosition(bounded)
    setSegmentIndex(indexForTime(bounded))
    pendingSeekRef.current = bounded
    anchorRef.current = null
    // The PICTURE is still moved by seeking, which is what it always was and what rode smoothly; the SOUND is
    // moved by the rate below. `positionScrub` never touches the audio elements.
    applyPendingSeek(false)
    if (resumeAfterScrubRef.current) driveScrubAudio(bounded, rate)
    if (scrubEndRef.current != null) window.clearTimeout(scrubEndRef.current)
    scrubEndRef.current = window.setTimeout(() => finishScrub(), SCRUB_IDLE_MS)
  }, [indexForTime, applyPendingSeek, finishScrub, driveScrubAudio])

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

  /**
   * Sets the shuttle rate, and — for any rate that actually drives the transport — makes it RUN.
   *
   * The slow motion (K+J / K+L) sets a rate while the transport is paused, because K pauses: without the run
   * here the readout showed 0.5x while the playhead stood perfectly still, which is exactly the fault reported.
   * A rate of ZERO only clears the shuttle, so a release after the slow motion leaves ordinary playback going
   * rather than stopping it.
   */
  const setShuttleRate = useCallback((rate: number) => {
    setShuttleRateState(rate)
    anchorRef.current = null
    if (rate !== 0) setPlaying(true)
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
    /**
     * Play or pause, and put the transport back to ORDINARY while doing it.
     *
     * A stop or a play is a return to normal, so it clears the shuttle AND the shared speed that L accelerates
     * through — otherwise a speed L left at 2x (or 4x, or 8x) survived the stop and the next play, and the only
     * way back to 1x was to pick it from the selector. See `accelerate`, which is what set it.
     */
    toggle: useCallback(() => {
      if (!playable) return
      setShuttleRate(0)
      setSpeedState(DEFAULT_PREVIEW_SPEED)
      if (stateRef.current.playing) { setPlaying(false); return }
      restartIfFinished(1)
      setPlaying(true)
    }, [playable, setShuttleRate, restartIfFinished]),
    /** A stop: the same return to ordinary as PLAY/PAUSE, with the transport left stopped. */
    pause: useCallback(() => { setShuttleRate(0); setSpeedState(DEFAULT_PREVIEW_SPEED); setPlaying(false) }, [setShuttleRate]),
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
    /**
     * A tap of the forward key. From rest it plays; already running it steps the shared speed value up.
     *
     * The effective speed is what the climb is measured against, so a wheeled 1.5x becomes 2x and a wheeled 3x
     * becomes 4x — the value the selector and the wheel own, not the shuttle's ladder. The shuttle is cleared
     * so that value is the rate itself rather than a multiplier on it; reverse counts as not-forward, so a tap
     * out of a reverse shuttle starts playing forward.
     */
    accelerate: useCallback(() => {
      if (!playable) return
      if (!stateRef.current.playing || shuttleRef.current < 0) {
        restartIfFinished(1)
        setShuttleRateState(0)
        anchorRef.current = null
        setPlaying(true)
        return
      }
      const effective = (shuttleRef.current > 0 ? shuttleRef.current : 1) * speedRef.current
      setShuttleRateState(0)
      setSpeedState(clampPreviewSpeed(nextForwardRung(effective)))
      anchorRef.current = null
    }, [playable, restartIfFinished]),
    setShuttleRate,
    clearError: useCallback(() => setError(null), []),
  }
}
