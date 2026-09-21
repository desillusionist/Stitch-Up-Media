import { spawn } from 'node:child_process'

/**
 * Runs ffmpeg to completion as a child process, WITHOUT holding the event loop.
 *
 * This function's whole reason to exist is that the main process is the one serving media to every
 * window and answering the queue's own IPC. A child waited for SYNCHRONOUSLY stops the media
 * protocol, the transport and the queue for as long as it runs, and extraction is the slowest thing
 * this process does — so it is exactly the work that must not be done while holding the loop. The
 * difference is not measurable in the output file, which is identical either way; it is measurable
 * only in what ELSE the process manages to do meanwhile, which is what `npm run verify-run` measures.
 *
 * Resolving on the child's exit rather than on a buffered stdout also means the size of ffmpeg's own
 * chatter cannot fail the run, which is what the synchronous buffer's generous `maxBuffer` was for.
 * Only the tail of stderr is kept, because it is only ever read to explain a failure.
 *
 * A run past its bound is killed rather than left to outlive whatever asked for it. The bound is
 * deliberately generous: it is there to catch a decode that has genuinely wedged, not to bound how
 * long a legitimate extraction may take.
 */
export const runFfmpeg = (args: string[], timeoutMs: number, binary = 'ffmpeg'): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 65536) stderr += chunk.toString() })
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error(`${binary} timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('close', (code) => {
    clearTimeout(timer)
    if (code === 0) resolve()
    else reject(new Error(`${binary} exited with ${code}: ${stderr.trim().slice(-400)}`))
  })
})
