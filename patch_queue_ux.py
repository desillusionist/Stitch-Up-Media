from pathlib import Path

app = Path('src/App.tsx')
s = app.read_text()
s = s.replace("  const previousTasksRef = useRef<QueueTask[] | null>(null)", "  const previousTasksRef = useRef<QueueTask[] | null>(null)\n  const selectionAnchorRef = useRef<string | undefined>(undefined)")
s = s.replace("  const handleSelectTask = (task: QueueTask, shiftKey = false) => {\n    setSelectedTaskId(task.id)\n    setSelectedTaskIds((current) => {\n      if (!shiftKey) return [task.id]\n      return current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]\n    })\n  }", """  const handleSelectTask = (task: QueueTask, shiftKey = false, additive = false) => {
    const anchorId = selectionAnchorRef.current || selectedTaskId || task.id
    selectionAnchorRef.current = additive ? anchorId : task.id
    setSelectedTaskId(task.id)
    setSelectedTaskIds((current) => {
      if (shiftKey) {
        const anchorIndex = tasks.findIndex((item) => item.id === anchorId)
        const targetIndex = tasks.findIndex((item) => item.id === task.id)
        if (anchorIndex < 0 || targetIndex < 0) return [task.id]
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        const range = tasks.slice(start, end + 1).map((item) => item.id)
        return additive ? Array.from(new Set([...current, ...range])) : range
      }
      if (additive) return current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]
      return [task.id]
    })
  }""")
s = s.replace("      const index = Math.max(0, tasks.findIndex((task) => task.id === selectedTaskId))\n      const nextIndex = Math.min(tasks.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))\n      handleSelectTask(tasks[nextIndex], true)", "      const index = Math.max(0, tasks.findIndex((task) => task.id === selectedTaskId))\n      const nextIndex = Math.min(tasks.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))\n      handleSelectTask(tasks[nextIndex], true, false)")
s = s.replace("      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {", "      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {\n        const ids = selectedTaskIds.length ? selectedTaskIds : (selectedTaskId ? [selectedTaskId] : [])\n        if (ids.length) {\n          event.preventDefault()\n          window.dispatchEvent(new CustomEvent('queue-toggle-sources', { detail: { ids, expanded: event.key === 'ArrowRight' } }))\n        }\n        return\n      }\n      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {")
s = s.replace("          if (selectedTaskIds.length <= 1 || !selectedTaskIds.includes(t.id)) setSelectedTaskIds([t.id])\n          setSelectedTaskId(t.id)", "          if (selectedTaskIds.length <= 1 || !selectedTaskIds.includes(t.id)) { setSelectedTaskIds([t.id]); selectionAnchorRef.current = t.id }\n          setSelectedTaskId(t.id)")
app.write_text(s)

task = Path('src/components/TaskCard.tsx')
s = task.read_text()
s = s.replace("  onSelectTask: (task: QueueTask, shiftKey?: boolean) => void", "  onSelectTask: (task: QueueTask, shiftKey?: boolean, additive?: boolean) => void")
s = s.replace("  useEffect(() => { const expand = () => setExpanded(true); const collapse = () => setExpanded(false); window.addEventListener('queue-expand-all', expand); window.addEventListener('queue-collapse-all', collapse); return () => { window.removeEventListener('queue-expand-all', expand); window.removeEventListener('queue-collapse-all', collapse) } }, [])", """  useEffect(() => {
    const expand = () => setExpanded(true)
    const collapse = () => setExpanded(false)
    const toggle = (event: Event) => {
      const ids = (event as CustomEvent<{ ids: string[]; expanded: boolean }>).detail
      if (selected && ids.ids.includes(task.id)) setExpanded(ids.expanded)
    }
    window.addEventListener('queue-expand-all', expand)
    window.addEventListener('queue-collapse-all', collapse)
    window.addEventListener('queue-toggle-sources', toggle)
    return () => { window.removeEventListener('queue-expand-all', expand); window.removeEventListener('queue-collapse-all', collapse); window.removeEventListener('queue-toggle-sources', toggle) }
  }, [selected, task.id])""")
s = s.replace("onSelectTask(task, event.shiftKey)", "onSelectTask(task, event.shiftKey, event.metaKey || event.ctrlKey)")
task.write_text(s)

css = Path('src/index.css')
s = css.read_text()
s += """
/* Final liquid native-file chooser geometry. */
.drop-chooser { overflow: auto; padding: clamp(10px, 3vw, 32px); }
.drop-chooser-box { width: min(100%, 920px) !important; max-width: none !important; box-sizing: border-box; }
.drop-chooser-grid { display: flex !important; flex-flow: row wrap !important; align-items: stretch; width: 100% !important; }
.drop-chooser-grid button { flex: 1 1 clamp(150px, 22vw, 320px) !important; width: auto !important; min-width: 0 !important; }
"""
css.write_text(s)

# Replace preset modal with grouped sections while preserving keyboard behavior.
modal = Path('src/components/PresetModal.tsx')
s = modal.read_text()
s = s.replace("  const focusedIndexRef = useRef(focusedIndex)", "  const focusedIndexRef = useRef(focusedIndex)\n  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ video: true, image: true, audio: true })")
old_start = "          {DEFAULT_PRESETS.map((preset, index) => {"
start = s.index(old_start)
end = s.index("          })}\n        </div>", start) + len("          })")
new = """          {(['video', 'image', 'audio'] as const).map((group) => {
            const groupPresets = DEFAULT_PRESETS.filter((preset) => group === 'audio' ? preset.outputMode === 'audio' : group === 'image' ? Boolean(preset.imageOutputMode) : preset.outputMode !== 'audio' && !preset.imageOutputMode)
            if (!groupPresets.length) return null
            const label = group === 'video' ? 'VIDEO OUTPUT' : group === 'image' ? 'IMAGE OUTPUT' : 'AUDIO EXTRACTION'
            return <section key={group} className=\"preset-group\">
              <button className=\"preset-group-header\" onClick={() => setOpenGroups((current) => ({ ...current, [group]: !current[group] }))} aria-expanded={openGroups[group]}><span>{openGroups[group] ? '−' : '+'}</span><strong>{label}</strong><span>{groupPresets.length}</span></button>
              {openGroups[group] && groupPresets.map((preset) => {
                const index = DEFAULT_PRESETS.findIndex((item) => item.id === preset.id)
                const selected = preset.id === currentPreset.id
                const focused = index === focusedIndex
                return <button key={preset.id} onMouseEnter={() => { focusedIndexRef.current = index; setFocusedIndex(index) }} onClick={() => { onSelectPreset(preset); onClose() }} className={`preset-option ${selected ? 'preset-option-selected' : ''} ${focused ? 'preset-option-focused' : ''}`}>
                  <span className=\"preset-option-copy\"><span className=\"preset-option-name\">{preset.name}</span><span className=\"preset-option-meta\">{preset.container.toUpperCase()} · {preset.videoCodec.toUpperCase()} · {preset.imageOutputMode === 'sequence' ? 'SEQUENCE' : preset.imageOutputMode === 'still' ? 'STILL' : preset.resolution}{preset.videoBitrate ? ` · ${preset.videoBitrate} VIDEO` : ''}{preset.audioBitrate ? ` · ${preset.audioBitrate} AUDIO` : ''}</span></span>{selected && <Check className=\"preset-option-check\" />}
                </button>
              })}
            </section>
          })}"""
s = s[:start] + new + s[end:]
modal.write_text(s)

css = Path('src/index.css')
s = css.read_text() + """
.preset-group { display: flex; flex-direction: column; gap: 5px; }
.preset-group-header { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; color: var(--ui-accent); background: var(--ui-panel-inset); border: 1px solid var(--ui-border); text-align: left; }
.preset-group-header:hover, .preset-group-header:focus-visible { color: var(--ui-canvas); background: var(--ui-accent); border-color: var(--ui-accent); outline: none; box-shadow: none; }
"""
css.write_text(s)
