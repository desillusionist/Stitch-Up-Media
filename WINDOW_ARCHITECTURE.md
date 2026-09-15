# Queue and Edit Job windows

## Window management

The primary renderer is the **QUEUE** window. It owns the render list, job-type creation, compact queue cards, start/stop controls, and task progress. A double-click on a queue card invokes the Electron `open-edit-job` IPC method. The main process creates or focuses one child BrowserWindow with the `#edit-job` renderer route, so the queue remains visible while the job is edited.

The child window is intentionally independent from the queue renderer. It receives a typed `QueueTask` through the preload bridge after the page finishes loading. **OK / APPLY** sends an `EditJobPatch` — only the fields the editor owns (`preset`, `outputFilename`, `outputFilenameManuallySet`) — back through IPC and closes the child. The queue subscribes to `edit-job-applied` and merges the patch field-scoped, so the editor's snapshot can never overwrite live encoding state such as progress, status, speed, or eta. The queue also pushes later changes to those same fields through `sync-edit-job-task`, so an open editor is refreshed instead of holding a stale snapshot; if the editor has unsaved edits, it surfaces the change instead of discarding them. **CANCEL** closes it without changing the queue task, confirming first when there are unsaved edits. A second invocation focuses the existing editor window and refreshes its task instead of creating another editor.

Controls the encoder cannot honour yet (burn-in effects, caption output) are shown disabled with an explanatory reason rather than presented as working.

## Job-type mapping

| Queue type | Task model | Editor timeline seed |
|---|---|---|
| CONVERT | `type: 'transcode'`, one `sourcePaths` entry | One video clip and its embedded audio |
| STITCH UP | `type: 'stitch'`, ordered `sourcePaths` | One video track with one clip block per source and junction markers |
| MULTI-TRACK | `type: 'multitrack'`, one source plus `additionalAudioTracks` | One video track, an audio group, and a captions lane |

The queue drop and picker flows make this choice explicit. This prevents ambiguous task behavior and leaves the editor free to expose type-specific controls later, including transitions, track flags, captions, and duration reconciliation.

## Why two windows

The queue is a monitoring surface and should remain stable during long renders. The editor is a configuration surface with preview, timeline, and export settings. Separating them follows the mental model of Media Encoder plus a lightweight export editor, avoids modal obstruction, and makes it possible to edit one job without losing queue context.
