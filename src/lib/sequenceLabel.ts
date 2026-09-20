import { SequenceInput } from '../types'

/**
 * How an image sequence is named wherever a source is labelled.
 *
 * A sequence's first frame stands in for the whole thing, but naming it after that one
 * file hides the range: `f_0001.png` says nothing about it running to `f_0240.png`. The
 * range is spelled out instead, padded to the pattern's own width, which is the format
 * the queue's cards have always used.
 */
export const sequenceLabel = (sequence: SequenceInput): string => {
  const width = Number(sequence.pattern?.match(/%0(\d+)d/)?.[1] || 1)
  const files = sequence.files || []
  const lastName = files[files.length - 1]?.split(/[\\/]/).pop() || ''
  const lastNumber = Number(lastName.match(/(\d+)(?=\.[^.]+$)/)?.[1] || sequence.startNumber || 0)
  const pad = (value: number) => String(value).padStart(width, '0')
  return `${sequence.prefix || ''}[${pad(sequence.startNumber)}-${pad(lastNumber)}].${(sequence.ext || 'jpg').toLowerCase()}`
}
