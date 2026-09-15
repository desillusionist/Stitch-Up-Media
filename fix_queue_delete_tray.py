from pathlib import Path

p=Path('src/App.tsx'); s=p.read_text()
s=s.replace("  const fileInputRef = useRef<HTMLInputElement>(null)", "  const fileInputRef = useRef<HTMLInputElement>(null)\n  const lastDeletedTasksRef = useRef<QueueTask[]>([])")
old="""  const handleRemoveTask = (taskId: string) => {
    window.electronAPI?.cancelTask(taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (selectedTaskId === taskId) setSelectedTaskId(undefined)
  }"""
new="""  const handleRemoveTask = (taskId: string) => {
    window.electronAPI?.cancelTask(taskId)
    setTasks((prev) => {
      const removed = prev.filter((t) => t.id === taskId)
      if (removed.length) lastDeletedTasksRef.current = removed
      return prev.filter((t) => t.id !== taskId)
    })
    if (selectedTaskId === taskId) setSelectedTaskId(undefined)
    setSelectedTaskIds((ids) => ids.filter((id) => id !== taskId))
  }"""
if old not in s: raise SystemExit('remove handler missing')
s=s.replace(old,new)
# Replace both duplicate delete effects with one undo-capable effect.
first=s.index('  useEffect(() => {\n    const onDelete = (event: KeyboardEvent) => {')
second=s.index('  const handleChangeJobType', first)
effect="""  useEffect(() => {
    const onQueueKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable=\"true\"]')) return
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z'
      if (isUndo && lastDeletedTasksRef.current.length) {
        event.preventDefault()
        const restored = lastDeletedTasksRef.current
        setTasks((prev) => [...prev, ...restored.filter((item) => !prev.some((task) => task.id === item.id))])
        setSelectedTaskIds(restored.map((item) => item.id))
        setSelectedTaskId(restored[0]?.id)
        lastDeletedTasksRef.current = []
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const ids = selectedTaskIds.length ? selectedTaskIds : (selectedTaskId ? [selectedTaskId] : [])
      if (!ids.length) return
      event.preventDefault()
      const removed = tasks.filter((task) => ids.includes(task.id))
      if (removed.length) lastDeletedTasksRef.current = removed
      ids.forEach((id) => window.electronAPI?.cancelTask(id))
      setTasks((prev) => prev.filter((task) => !ids.includes(task.id)))
      setSelectedTaskIds([])
      setSelectedTaskId(undefined)
    }
    window.addEventListener('keydown', onQueueKey)
    return () => window.removeEventListener('keydown', onQueueKey)
  }, [tasks, selectedTaskId, selectedTaskIds])
"""
s=s[:first]+effect+s[second:]
p.write_text(s)

p=Path('src/components/TaskCard.tsx'); s=p.read_text()
# Remove the card X action entirely; context menu remains the removal route.
start=s.find("\n          {task.status !== 'encoding' && (\n            <button\n              onClick={() => onRemoveTask(task.id)}")
if start >= 0:
    end=s.find("          )}\n", start)+len("          )}\n")
    s=s[:start]+s[end:]
# Deduplicate expand effect if prior patch was applied twice.
needle="  useEffect(() => { const expand = () => setExpanded(true); const collapse = () => setExpanded(false); window.addEventListener('queue-expand-all', expand); window.addEventListener('queue-collapse-all', collapse); return () => { window.removeEventListener('queue-expand-all', expand); window.removeEventListener('queue-collapse-all', collapse) } }, [])\n"
s=s.replace(needle+needle, needle)
p.write_text(s)

p=Path('src/components/QueueList.tsx'); s=p.read_text()
# Do not open the tray when Finder is over an existing card.
s=s.replace("    setIsDragOver(true)\n    setDropTray(true)", "    if ((e.target as HTMLElement).closest('.queue-card')) { setDropTray(false); setIsDragOver(false); return }\n    setIsDragOver(true)\n    setDropTray(true)")
# Remove the cancel control.
s=s.replace("<button className=\"chooser-cancel\" onClick={() => { setDroppedFiles(null); setDropTray(false) }}>CANCEL</button>", "")
# Remove container icon elements while retaining textual labels.
for icon in ['<b>▣</b>', '<b>▣▣</b>', '<b>▣≈</b>', '<b>▣≋</b>']:
    s=s.replace(icon, '')
p.write_text(s)

p=Path('src/index.css'); s=p.read_text()+"""
/* Final drag tray behavior: fluid text-only targets, no lingering cancel action. */
.drop-tray .drop-chooser-box { width: 100% !important; max-width: none !important; }
.drop-tray-grid { width: 100%; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
.drop-tray-grid button { min-height: 30px !important; height: 30px; align-items: center !important; justify-content: center !important; }
.drop-tray-grid button span { font-size: 10px; }
.drop-tray-grid button small { display: none; }
"""; p.write_text(s)
