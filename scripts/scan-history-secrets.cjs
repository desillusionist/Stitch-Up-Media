// A history scan for secrets, run BEFORE the repository is made public.
//
// It reads every reachable commit's patch and message — not just the working tree — because history is what
// becomes readable, and a token committed once and deleted is still in it. Anything it finds is printed MASKED
// and located by commit and file, never in full: the point is to say where and what kind, not to copy a secret
// into a log.
const { execFileSync } = require('node:child_process')

const RULES = [
  ['github token (classic)', /\bghp_[A-Za-z0-9]{20,}/g],
  ['github token (fine-grained)', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['openai-style key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['aws access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['bearer header', /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/gi],
  ['password assignment', /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi],
]

const mask = (value) => `${value.slice(0, 4)}…(${value.length} chars)`

const findings = []
const scan = (text, where) => {
  for (const [rule, pattern] of RULES) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) findings.push({ rule, where, preview: mask(match[0]) })
  }
}

const git = (args, input) => execFileSync('git', args, { input, maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString()

console.log('\n== every file name ever added ==')
const added = git(['log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A'])
const names = [...new Set(added.split('\n').map((line) => line.trim()).filter(Boolean))]
console.log(`  ${names.length} distinct paths have existed in the history`)
const suspiciousNames = names.filter((name) => /(^|\/)(\.env|\.env\..+|id_rsa|id_ed25519|credentials|secrets?\.(json|ya?ml|toml|txt))$|\.(pem|p12|pfx|key|keystore|mobileprovision|ppk)$/i.test(name))
console.log(suspiciousNames.length ? `  SENSITIVE-LOOKING PATHS: ${suspiciousNames.join(', ')}` : '  no .env, key, certificate or credentials file has ever been committed')

console.log('\n== every commit message ==')
const messages = git(['log', '--all', '--format=%H%n%B%n---'])
scan(messages, 'a commit message')

console.log('\n== every patch, every commit ==')
const patches = git(['log', '--all', '-p', '--unified=0', '--pretty=format:__COMMIT__%H%x20%s'])
let commit = '?'
let file = '(message)'
for (const line of patches.split('\n')) {
  if (line.startsWith('__COMMIT__')) { commit = line.slice(10, 50); file = '(message)'; continue }
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue }
  if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) scan(line, `${commit.slice(0, 8)} ${file}`)
}

console.log(findings.length ? '' : '  nothing matched any of the patterns')
for (const finding of findings) console.log(`  ${finding.rule} @ ${finding.where}  ${finding.preview}`)

console.log('\n== the weight of it ==')
console.log(' ', git(['count-objects', '-vH']).trim().replace(/\n/g, '\n  '))

console.log(findings.length ? `\n${findings.length} POSSIBLE SECRET(S)\n` : '\nNO SECRET FOUND IN THE HISTORY\n')
process.exit(findings.length ? 1 : 0)
