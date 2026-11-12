import React from 'react'

/** A release's notes, as the page shows them — the shape `release-notes` answers with. */
export interface ReleaseNotes {
  version: string
  notes: string
  publishedAt: string
}

/**
 * WHAT'S NEW: the notes of the release that is running, opened once after an update.
 *
 * WHAT IT IS FOR: a version number in a menu says nothing about what changed, and a reader who has just installed
 * an update is the one person who wants to know. The notes are the release's OWN — read from GitHub when the page
 * opens, so there is no second copy of them in the bundle to go stale.
 *
 * The markup is drawn from a small part of Markdown rather than a parser: headings, bold, code and bullets, which is
 * what these notes use. Everything else is shown as it is written, which is the honest fallback — a page that showed
 * raw asterisks is better than a page that lost the sentence they were in.
 */
const inline = (line: string): React.ReactNode => {
  // Bold and inline code, in one pass, so `**X**` inside a bullet is bold rather than shown as asterisks.
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <React.Fragment key={index}>{part}</React.Fragment>
  })
}

const Notes: React.FC<{ notes: string }> = ({ notes }) => (
  <div className="whats-new-notes">
    {notes.split('\n').map((line, index) => {
      const text = line.trim()
      if (!text) return null
      if (text.startsWith('### ')) return <h4 key={index}>{inline(text.slice(4))}</h4>
      if (text.startsWith('## ')) return <h3 key={index}>{inline(text.slice(3))}</h3>
      if (text.startsWith('#')) return <h3 key={index}>{inline(text.replace(/^#+\s*/, ''))}</h3>
      if (/^[-*]\s+/.test(text)) return <p key={index} className="whats-new-bullet">{inline(text.replace(/^[-*]\s+/, ''))}</p>
      return <p key={index}>{inline(text)}</p>
    })}
  </div>
)

export const WhatsNew: React.FC<{
  isOpen: boolean
  version: string
  entries: ReleaseNotes[]
  loading: boolean
  onClose: () => void
}> = ({ isOpen, version, entries, loading, onClose }) => {
  if (!isOpen) return null
  // The running release's notes, and anything newer that was published without being installed — the reader may have
  // skipped one. Nothing published yet (a build made before its release) falls back to the newest notes there are.
  const shown = entries.filter((entry) => entry.version === version)
  const list = shown.length ? shown : entries.slice(0, 3)
  return (
    <div className="drop-chooser whats-new" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="drop-chooser-box">
        <span className="panel-kicker">STITCH UP MEDIA // WHAT'S NEW</span>
        <h2>{version ? `VERSION ${version}` : 'WHAT CHANGED'}</h2>
        {loading && <p className="whats-new-empty">READING THE RELEASE NOTES…</p>}
        {!loading && !list.length && <p className="whats-new-empty">THE NOTES FOR THIS RELEASE COULD NOT BE READ. THE RELEASE PAGE HAS THEM.</p>}
        {list.map((entry) => (
          <section key={entry.version} className="whats-new-release">
            {list.length > 1 && <h3 className="whats-new-version">{entry.version}</h3>}
            <Notes notes={entry.notes} />
          </section>
        ))}
        <div className="whats-new-actions">
          <button className="chooser-cancel" onClick={onClose}>GOT IT</button>
        </div>
      </div>
    </div>
  )
}
