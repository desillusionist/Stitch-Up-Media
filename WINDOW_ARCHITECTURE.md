# Queue and Edit Job windows

## Window management

The primary renderer is the **QUEUE** window. It owns the render list, job-type creation, compact queue cards, start/stop controls, and task progress. A double-click on a queue card invokes the Electron `open-edit-job` IPC method. The main process creates or focuses one child BrowserWindow with the `#edit-job` renderer route, so the queue remains visible while the job is edited.

The child window is intentionally independent from the queue renderer. It receives a typed `QueueTask` through the preload bridge after the page finishes loading. **OK / APPLY** sends an `EditJobPatch` — only the fields the editor owns (`preset`, `outputFilename`, `outputFilenameManuallySet`) — back through IPC and closes the child. The queue subscribes to `edit-job-applied` and merges the patch field-scoped, so the editor's snapshot can never overwrite live encoding state such as progress, status, speed, or eta. The queue also pushes later changes to those same fields through `sync-edit-job-task`, so an open editor is refreshed instead of holding a stale snapshot; if the editor has unsaved edits, it surfaces the change instead of discarding them. **CANCEL** closes it without changing the queue task, confirming first when there are unsaved edits. A second invocation focuses the existing editor window and refreshes its task instead of creating another editor.

Controls the encoder cannot honour yet (burn-in effects, caption output) are shown disabled with an explanatory reason rather than presented as working.

## Preview and timeline

The panel plays the **assembled output**, not a single clip. `src/lib/timelineModel.ts` builds the consolidated timeline from the task, and the lanes are drawn to scale from the real trimmed durations. **STITCH** concatenates every source in order. **TRANSCODE**, **MULTI-TRACK** and **COMBO** map a single video stream with their audio tracks muxed alongside it from zero, so the finished length is the longer of the video and the longest track — which is exactly how the encoder reconciles them by padding video with a freeze frame. COMBO is modelled as multi-track because the encoder dispatches purely on `type` and never reads `comboMode`.

The main lane's media element is the master clock, so video and its embedded audio stay in sync by construction; added tracks are slaved to it and corrected only once they drift past a tolerance. Segment junctions are crossed by pointing the same element at the next source. Where an added track outlasts the video, a wall clock takes over so the playhead still advances.

Local files stream through the `stitch-media` scheme registered in `electron/main.ts`. A plain `file://` URL cannot work: the dev renderer runs on `http://localhost`, where Chromium refuses `file://` media. Byte ranges are resolved explicitly rather than delegated, because a media element only becomes seekable when it receives a `206` with a correct `Content-Range`.

### Setting trim

**OPEN FRAME-ACCURATE PREVIEW** opens the same native Swift helper the queue uses through the `quick-look` channel, which already provides frame-accurate seeking, in/out handles, frame stepping, undo/redo, screenshot capture, and timestamp or framestamp burn-in readout. Reusing it avoids reimplementing trimming.

Trim stays queue-owned. The native helper reports in/out points, the queue records them on the task, and the editor picks the change up through `sync-edit-job-task`. The editor therefore displays and inspects trim state rather than owning it, and the timeline redraws at the trimmed lengths.

Launch resolution is shared through `src/lib/quickLookTarget.ts`, so the queue rail and the editor cannot drift on image-sequence thumbnail regeneration, still-frame detection, or trim-point lookup. `src/lib/mediaKind.ts` is shared for the same reason: a sequence frame cannot be decoded by a video element, so it is played through its generated preview instead.

Durations and frame rates come from probe data on the task. An image sequence reports duration as frame count over its interpreted fps, matching the helper's `displayFps` rule, so both windows agree on frame numbers for the same media.

## Job-type mapping

| Queue type | Task model | Editor timeline seed |
|---|---|---|
| CONVERT | `type: 'transcode'`, one `sourcePaths` entry | One video clip and its embedded audio |
| STITCH UP | `type: 'stitch'`, ordered `sourcePaths` | One video track with one clip block per source and junction markers |
| MULTI-TRACK | `type: 'multitrack'`, one source plus `additionalAudioTracks` | One video track, an audio group, and a captions lane |

The queue drop and picker flows make this choice explicit. This prevents ambiguous task behavior and leaves the editor free to expose type-specific controls later, including transitions, track flags, captions, and duration reconciliation.

## Why two windows

The queue is a monitoring surface and should remain stable during long renders. The editor is a configuration surface with preview, timeline, and export settings. Separating them follows the mental model of Media Encoder plus a lightweight export editor, avoids modal obstruction, and makes it possible to edit one job without losing queue context.
