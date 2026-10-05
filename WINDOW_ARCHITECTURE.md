# Queue and Edit Job windows

## Window management

The primary renderer is the **QUEUE** window. It owns the render list, job-type creation, compact queue cards, start/stop controls, and task progress. A double-click on a queue card invokes the Electron `open-edit-job` IPC method. The main process creates or focuses one child BrowserWindow with the `#edit-job` renderer route, so the queue remains visible while the job is edited.

The child window is intentionally independent from the queue renderer. It receives a typed `QueueTask` through the preload bridge after the page finishes loading. **OK / APPLY** sends an `EditJobPatch` — only the fields the editor owns (`preset`, `outputFilename`, `outputFilenameManuallySet`) — back through IPC and closes the child. The queue subscribes to `edit-job-applied` and merges the patch field-scoped, so the editor's snapshot can never overwrite live encoding state such as progress, status, speed, or eta. The queue also pushes later changes to those same fields through `sync-edit-job-task`, so an open editor is refreshed instead of holding a stale snapshot; if the editor has unsaved edits, it surfaces the change instead of discarding them. **CANCEL** closes it without changing the queue task, confirming first when there are unsaved edits. A second invocation focuses the existing editor window and refreshes its task instead of creating another editor.

Controls the encoder cannot honour yet (burn-in effects, caption output) are shown disabled with an explanatory reason rather than presented as working.

## Preview and timeline

The panel plays the **assembled output**, not a single clip. `src/lib/timelineModel.ts` builds the consolidated timeline from the task, and the lanes are drawn to scale from the real trimmed durations. **STITCH** concatenates every source in order. **TRANSCODE**, **MULTI-TRACK** and **COMBO** map a single video stream and mux their tracks alongside it, so with **stacked** tracks the finished length is the longer of the video and the longest track, which is exactly how the encoder reconciles them by padding video with a freeze frame.

**COMBO's `comboMode` is a second axis of arrangement**, and it is read for a MULTI-TRACK as well as a COMBO because it is a question about how the TRACKS relate to each other rather than how many visuals they play under: `multitrack` stacks them from zero, `stitch` SEQUENCES them end to end into one lane and one output stream (the encoder builds that stream with a `concat` graph — `tracksConcatenate` is the one rule the model and the encoder share). A job whose tracks differ from its visual in length is padded in black either way.

A **MULTI-TRACK/COMBO can retime its visual and its tracks**: `canApplyClipSpeed` allows it, and `executeMultiTrack` places the same `speedVideoFilters`/`speedAudioFilters` chains a CONVERT uses — the visual's on its own chain and each track's in that track's per-stream chain — so FPS/SPEED/DURATION are offered there and the drawn length is the written one.

The main lane's media element is the master clock, so video and its embedded audio stay in sync by construction; added tracks are slaved to it and corrected only once they drift past a tolerance, and a slaved track PAST its own end is paused rather than re-parked (see `slavedAudioAt`). Segment junctions are crossed by pointing the same element at the next source. Where an added track outlasts the video, a wall clock takes over so the playhead still advances.

Local files stream through the `stitch-media` scheme registered in `electron/main.ts`. A plain `file://` URL cannot work: the dev renderer runs on `http://localhost`, where Chromium refuses `file://` media. Byte ranges are resolved explicitly rather than delegated, because a media element only becomes seekable when it receives a `206` with a correct `Content-Range`.

### Clip transitions

`QueueTask.transitions` holds fades at clip boundaries, keyed by the clip that *precedes* the boundary (`"path#index"`) — mirroring how trim points are keyed, so both are re-keyed together when clips move or are removed. A boundary fades the preceding clip out and the following clip in, through black, and the length is clamped to half of the shorter neighbour by `maxFadeAtBoundary`. The encoder and the timeline both call that same clamp, so the drawn ramp is what will actually be rendered, and a fade never overlaps a neighbouring one inside a clip.

The two EDGES of the timeline are keyed by the edge (`#head`/`#tail`) rather than by a clip, since an edge belongs to the timeline and reordering must not move it. An **added audio track** is one clip on a lane of its own, so its two edges are keyed by that clip's own key with the edge appended (`"path#0::head"`), which is what keeps a fade set on one track from being a fade on every track — see `trackEdgeFade`.

Fades are written on **every path that can carry one**. A STITCH and a concatenating COMBO normalize each visual through its own chain (`normalizeStitchSource`), which is where boundary and edge fades have always been placed. A **CONVERT** and a **MULTI-TRACK/COMBO**'s single visual now place their head/tail edges the same way — in `executeTranscode`'s filter chain and in `executeMultiTrack`'s — so the `[+]` a single-source job offers is written rather than merely drawn. Fades are dropped whenever a job changes type, since the clips are reshuffled and index keys can no longer be trusted.

The `[+]` affordance sits on each lane's boundaries: on each cut and at both ends of the main lane, and at both ends of an added track's single clip. Fades are placed by `fade`/`afade` inside the same filter chains the scaling already uses — a second `-vf` would silently replace the first, so they compose rather than append. **CROSSFADE is deliberately absent**: it overlaps clips, which the concat demuxer cannot express, and it shortens the total duration, so it needs the encoder rework and a timeline that accounts for the overlap.

### Audio lanes and the two-up view

A lane is **named for what it holds**, not for what the export writes: an all-sound job's main lane reads `AUDIO 1` whether the preset supplies a black picture beside the track or not, and an added track reads `AUDIO n`. Its KIND still follows the file, so a sound lane is drawn as a waveform either way.

An added audio track is a lane of its own and gets the same in-timeline controls the video lane's clips do — the trim handles (the encoder already applies a track's trim through `applyTrimInput`), a `[+]` with FADE IN/OUT, and ADD SOURCE, which inserts into `additionalAudioTracks` at that lane's own place. When **any** lane asks for a fade the multi-track path filters the audio **per output stream** (`-filter:a:N`), each lane's own `afade`s appended to the resample/layout chain it always had; a job with no fade keeps the one shared `-af`, so the common path is untouched.

While a trim handle is down the monitor becomes a **two-up view** that fills the whole panel: the two frames the cut will join sit side by side, each paned to the OUTPUT's own aspect ratio, and the export frame's enclosure is hidden (`is-trimming`) so nothing else is over them. The clip being trimmed is on the side the handle is NOT — the previous clip's last frame on the LEFT for an IN handle, the next clip's first on the RIGHT for an OUT. The drag's own drawer shows the run a handle is REMOVING as hatching inside the clip and the run it is ADDING as an amber outline outside it, since the clip's box does not move until release.

The two-up view is for the PICTURE, so it is offered on VIDEO lanes only: a SOUND lane has no frame at the end of it to judge a cut against, so `beginTrimDrag` finds no neighbour there and the live seek moves the playhead instead, which is where an audio cut lands. And an expansion at the FIRST clip's head has no room outside the scroll area — the drawer there would sit at a negative x and be clipped — so the pulled edge is ALSO marked INSIDE the clip (`clip-trim-grow-edge`), which cannot be clipped and keeps a growing drag readable at the timeline's own edge.

### A clip's own embedded sound

A video's soundtrack is **part of the clip**: the picture and its sound are one source, and a trim of the clip is a trim of both. `QueueTask.embeddedAudio` holds what a reader has said about that sound, keyed by the clip's OWN id like every other per-clip record, and `src/lib/embeddedAudio.ts` is the one place those rules live. It is offered where the encoder can honour it — a **CONVERT** or a **MULTI-TRACK** maps its one visual straight through — and withheld on a STITCH or a concatenating COMBO, where each visual is normalized into a single stream before it is joined and a clip's streams are no longer separately addressable.

Each embedded stream has a MUTE and a LEVEL, one row per stream (with its language or title where the container carries one). The export maps the ENABLED streams **one at a time** (`-map 0:a:N`) rather than `0:a` (every stream) or the first, and a level becomes a `volume=` on that stream's own chain — which is why a clip with several streams is filtered **per output stream** (`-filter:a:N`), each getting its own gain. An untouched clip keeps ffmpeg's own `-map 0:a?`, so a job that never touched its sound is byte-identical to one saved before this existed.

**EXTRACT AUDIO TO TRACK** moves a stream out of the picture and onto a lane of its own. The new track NAMES the stream (`streamIndex`) and the clip it came from (`sourceClipId`) rather than copying the file, so the source is never altered and nothing double-plays: the picture's mapping drops the extracted stream (`enabledEmbeddedStreams` reads the claim) while the track maps it from its own input, and the track is a real `additionalAudioTracks` entry with an opaque id, so it gets the same lane, trim handles, fade and monitor slaving every added track does. Extraction is recorded as that CLAIM rather than as a flag on the clip, which is what makes it reversible with nothing to undo: deleting the track re-enables the clip's own mapping. The track is seeded with the clip's current trim, so it is in sync by default and only then trims and moves on its own — a J/L cut.

An extracted track's path is the video it came from, and that is the one case a track's file is also a source in `sourcePaths`. `clipKey` would then answer with the CLIP's id, so the track and the picture would be one record; `trackKey` gives an EXTRACTED track its own `${path}#${trackId}` key instead, which the timeline and the encoder both read, so the two cannot trim or fade each other.

**Preview versus export, honestly.** Chromium's `<video>` exposes no `audioTracks` (it is Chrome-only and absent in Electron), so the monitor can only play a source's DEFAULT embedded stream — it cannot isolate the second. A single-stream source is therefore exact in both; a multi-stream one is exact in the EXPORT but the monitor mutes the whole element (when the default stream is dropped) and scales it by that stream's level, and the inspector says so rather than pretending each stream is separately audible. EXTRACTION is the clean path for hearing one stream on its own, because once a stream is a real track file the lane's own `<audio>` element plays it and Web Audio gain applies.

### Levels on tracks and on sound clips

An AUDIO SOURCE clip — a file that has no picture — gets a single LEVEL in PROPERTIES, keyed by the clip's id like the embedded records. It is honest about where it can be written: on a CONVERT the clip's one stream IS the export's stream, so the gain joins the `-af` chain the retime and the fades use; on a STITCH each audio clip is normalized by `normalizeStitchSource`, so the same gain joins that clip's own chain. A job whose picture is a DRAWING writes its audio through the graph, so the gain is passed in as that input's level rather than being applied after the mix.

An ADDED TRACK gets a LEVEL on its own lane, beside its MUTE, as a field of the track (`AudioTrackItem.gainDb`) — the record that travels with it through every list operation, keyed by the track's own stable id. The export writes it as a `volume=` on that track's OUTPUT STREAM, so each track's level is independent of the others: the multi-track path already maps one stream per track, and a job that needs no per-stream chain is switched to one the moment any track has a level, because a shared `-af` would put one track's gain on all of them. Where several inputs are summed — a drawing's `amix` — the level is written on that input's own chain before the sum, because a gain after the mix would move every track together. The monitor applies the same figure to the same lane's `<audio>` element, so a track sounds in the preview as it will in the file.

**EXTRACTION CARRIES THE LEVEL AND THE MUTE.** Taking a stream out to a track hands the new track that stream's dB and, if it was dropped, its mute, so the mix is unchanged at the moment of extraction and only a later edit to the track changes it. The harness measures it: a clip leant -20 dB and the same stream extracted to a track carrying -20 dB both read the same RMS (0.0062 against 0.0062 on the two-stream fixture), and the level is written on the track's own stream.

### Groups, the cut, and the cut's own fade

A clip is clicked to select it, and **Shift** takes the run between the anchor and the clip clicked on the same lane (across lanes it toggles one clip into the set). The selection is a set of clip KEYS, so it survives a reorder; `selected` stays the ANCHOR the inspector describes. The group actions are the ones a single clip has: **RESET TRIM** acts on all of them at once, **REMOVE SOURCE** (and the Delete key) asks one confirmation for the whole group and takes each clip out by its own id, and a drag of a clip that is IN a group moves the group as one block rather than the one clip under the pointer.

**A trim handle dragged with a group in hand trims them TOGETHER.** Each selected clip is given the same TIMELINE delta on the SAME edge — multiplied by that clip's own retime — so a video clip and an audio track trimmed together land their cuts on one instant, and the whole gesture is one undo step (one `trimPoints` write for all of them).

**C cuts the selected clip in two at the skimmer** (bound by physical `KeyC`, so a non-Latin layout still cuts; the clip's menu carries SPLIT AT SKIMMER too, disabled while the skimmer is not strictly inside the clip). The FIRST half keeps the clip's own id, so its records stay on it; the second gets a new id and copy number and a copy of the records that describe the clip — its fit, its crop, its speed, its rate and its own sound — because the two halves are the one clip still. A fade at the original clip's tail moves to the second half, and the new interior cut starts with none.

A cut between two SEQUENCED tracks (a MULTI-TRACK/COMBO in `stitch` mode) now carries the same `[+]` the main lane's cuts do, offering ADD SOURCE — a source goes into the track list at that place. A fade across it is not offered, and the panel says so: the `concat` graph that joins sequenced tracks writes no cross-fade. **X-FADE is disabled everywhere for the same reason**: a crossfade OVERLAPS the two clips, which the concat demuxer cannot express, and it shortens the total duration, so it needs an encoder rework and a timeline that accounts for the overlap before it can be offered.

### Setting trim

**OPEN FRAME-ACCURATE PREVIEW** opens the same native Swift helper the queue uses through the `quick-look` channel, which already provides frame-accurate seeking, in/out handles, frame stepping, undo/redo, screenshot capture, and timestamp or framestamp burn-in readout. Reusing it avoids reimplementing trimming.

Trim stays queue-owned. The native helper reports in/out points, the queue records them on the task, and the editor picks the change up through `sync-edit-job-task`. The editor therefore displays and inspects trim state rather than owning it, and the timeline redraws at the trimmed lengths.

Launch resolution is shared through `src/lib/quickLookTarget.ts`, so the queue rail and the editor cannot drift on image-sequence thumbnail regeneration, still-frame detection, or trim-point lookup. `src/lib/mediaKind.ts` is shared for the same reason: a sequence frame cannot be decoded by a video element, so it is played through its generated preview instead.

Durations and frame rates are resolved per source: an interpreted sequence from its frame count over its fps, a still frame from `stillImageDuration` (defaulting to the encoder's ten seconds), and anything else by probing on demand, because `sourceInfo` and `sourceMetadata` are read across the app but never actually populated. A single `sourceInfo` reading describes the task's first source only, never its tracks.

## Job-type mapping

| Queue type | Task model | Editor timeline seed |
|---|---|---|
| CONVERT | `type: 'transcode'`, one `sourcePaths` entry | One video clip and its embedded audio |
| STITCH UP | `type: 'stitch'`, ordered `sourcePaths` | One video track with one clip block per source and junction markers |
| MULTI-TRACK | `type: 'multitrack'`, one source plus `additionalAudioTracks` | One video track, an audio group, and a captions lane |

The queue drop and picker flows make this choice explicit. This prevents ambiguous task behavior and leaves the editor free to expose type-specific controls later, including transitions, track flags, captions, and duration reconciliation.

## Why two windows

The queue is a monitoring surface and should remain stable during long renders. The editor is a configuration surface with preview, timeline, and export settings. Separating them follows the mental model of Media Encoder plus a lightweight export editor, avoids modal obstruction, and makes it possible to edit one job without losing queue context.
