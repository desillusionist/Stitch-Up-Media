import ffmpeg from 'fluent-ffmpeg'

/**
 * Teaches fluent-ffmpeg the name of ffmpeg's own synthetic input format.
 *
 * `-f lavfi` asks ffmpeg to make a picture out of nothing, which is what a job whose one source has
 * no frame of its own needs: a black picture for the export to carry beside the sound. fluent-ffmpeg
 * refuses it before ffmpeg is ever started, because it checks `-f` names against its own parse of
 * ffmpeg's format table — and that parse predates the extra flag column modern builds print. Read
 * against ffmpeg's own table here, `lavfi` is listed with that extra column and the entry is not
 * filed under its own name, so a good `-f lavfi` is answered with "Input format lavfi is not
 * available". (Measured against the ffmpeg this app installs: 409 formats parsed, none of them
 * `lavfi`.)
 *
 * The correction ADDS that one entry rather than dropping the check, which still answers for every
 * other format and codec. It is applied to the table fluent-ffmpeg parses once and caches, so the
 * first read puts `lavfi` in place for every command afterwards, and re-reads find it already there.
 */
interface FormatTable {
  [name: string]: { description: string; canDemux: boolean; canMux: boolean }
}
type FormatCallback = (error: Error | null, formats?: FormatTable) => void

export const teachLavfiFormat = (): void => {
  const prototype = (ffmpeg as unknown as { prototype: { availableFormats: (callback: FormatCallback) => unknown } }).prototype
  const readFormats = prototype.availableFormats
  prototype.availableFormats = function (this: unknown, callback: FormatCallback) {
    return readFormats.call(this, (error: Error | null, formats?: FormatTable) => {
      if (!error && formats && !formats.lavfi) {
        formats.lavfi = { description: 'Libavfilter virtual input device', canDemux: true, canMux: false }
      }
      callback(error, formats)
    })
  }
}
