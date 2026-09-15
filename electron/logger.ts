import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const logDirectory = path.join(os.tmpdir(), 'Stitch Up Media')
const logFile = path.join(logDirectory, 'stitch-up-media.log')

export function logEvent(scope: string, message: string, details?: unknown) {
  try {
    fs.mkdirSync(logDirectory, { recursive: true })
    const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${scope}] ${message}${suffix}\n`)
  } catch (error) {
    console.error('Unable to write diagnostic log', error)
  }
  console.log(`[${scope}] ${message}`, details ?? '')
}

export function getLogFile() {
  return logFile
}
