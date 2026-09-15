from pathlib import Path

p=Path('src/components/QueueList.tsx'); s=p.read_text()
s=s.replace("  const [dropTray, setDropTray] = React.useState(false)", "  const [dropTray, setDropTray] = React.useState(false)\n  const [hoveredDropType, setHoveredDropType] = React.useState<string | null>(null)")
s=s.replace("    setDropTray(false)\n    const dropped", "    setDropTray(false)\n    setHoveredDropType(null)\n    const dropped", 1)
# Replace the single-line mode button event handlers with propagation-safe handlers and hover classes.
for typ in ['transcode','stitch','multitrack','combo']:
    s=s.replace(f"onDragOver={{(event) => event.preventDefault()}} onDrop={{(event) => void handleDrop(event, '{typ}')}}", f"onDragEnter={{(event) => {{ event.preventDefault(); event.stopPropagation(); setHoveredDropType('{typ}') }}}} onDragOver={{(event) => {{ event.preventDefault(); event.stopPropagation(); setHoveredDropType('{typ}') }}}} onDragLeave={{(event) => {{ event.preventDefault(); event.stopPropagation(); setHoveredDropType(null) }}}} onDrop={{(event) => {{ event.preventDefault(); event.stopPropagation(); void handleDrop(event, '{typ}') }}}}")
# Add a stateful class to each button.
for typ in ['transcode','stitch','multitrack','combo']:
    label={'transcode':'CONVERT','stitch':'STITCH UP','multitrack':'MULTI-TRACK','combo':'COMBO'}[typ]
    s=s.replace(f"<button onDragEnter={{(event) => {{ event.preventDefault(); event.stopPropagation(); setHoveredDropType('{typ}') }}}}", f"<button className={{hoveredDropType === '{typ}' ? 'drop-target-hover' : ''}} onDragEnter={{(event) => {{ event.preventDefault(); event.stopPropagation(); setHoveredDropType('{typ}') }}}}")
p.write_text(s)

p=Path('src/App.tsx'); s=p.read_text()
# Add task history refs.
s=s.replace("  const lastDeletedTasksRef = useRef<QueueTask[]>([])", "  const lastDeletedTasksRef = useRef<QueueTask[]>([])\n  const taskHistoryPastRef = useRef<QueueTask[][]>([])\n  const taskHistoryFutureRef = useRef<QueueTask[][]>([])\n  const previousTasksRef = useRef<QueueTask[] | null>(null)\n  const applyingHistoryRef = useRef(false)")
# Add snapshot tracking after settings state block, before initial effects.
marker="  // Load initial settings and set up IPC event listeners"
history="""  useEffect(() => {
    if (previousTasksRef.current === null) { previousTasksRef.current = tasks; return }
    if (applyingHistoryRef.current) { applyingHistoryRef.current = false; previousTasksRef.current = tasks; return }
    if (JSON.stringify(previousTasksRef.current) !== JSON.stringify(tasks)) {
      taskHistoryPastRef.current.push(previousTasksRef.current)
      if (taskHistoryPastRef.current.length > 100) taskHistoryPastRef.current.shift()
      taskHistoryFutureRef.current = []
      previousTasksRef.current = tasks
    }
  }, [tasks])
  const handleUndo = () => {
    const previous = taskHistoryPastRef.current.pop()
    if (!previous) return
    taskHistoryFutureRef.current.push(tasks)
    applyingHistoryRef.current = true
    setTasks(previous)
    setSelectedTaskIds(previous.filter((task) => selectedTaskIds.includes(task.id)).map((task) => task.id))
    setSelectedTaskId((id) => previous.some((task) => task.id === id) ? id : previous[0]?.id)
  }
  const handleRedo = () => {
    const next = taskHistoryFutureRef.current.pop()
    if (!next) return
    taskHistoryPastRef.current.push(tasks)
    applyingHistoryRef.current = true
    setTasks(next)
    setSelectedTaskIds(next.filter((task) => selectedTaskIds.includes(task.id)).map((task) => task.id))
    setSelectedTaskId((id) => next.some((task) => task.id === id) ? id : next[0]?.id)
  }
"""
if marker not in s: raise SystemExit('App effect marker missing')
s=s.replace(marker, history+marker)
# Replace undo branch and add redo branch in the existing queue key handler.
old="""      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z'
      if (isUndo && lastDeletedTasksRef.current.length) {
        event.preventDefault()
        const restored = lastDeletedTasksRef.current
        setTasks((prev) => [...prev, ...restored.filter((item) => !prev.some((task) => task.id === item.id))])
        setSelectedTaskIds(restored.map((item) => item.id)); setSelectedTaskId(restored[0]?.id); lastDeletedTasksRef.current = []
        return
      }"""
new="""      const isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
      const isRedo = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z'
      if (isUndo) { event.preventDefault(); handleUndo(); return }
      if (isRedo) { event.preventDefault(); handleRedo(); return }"""
if old not in s: raise SystemExit('undo branch missing')
s=s.replace(old,new)
# Add history callbacks to effect dependencies.
s=s.replace("  }, [tasks, selectedTaskId, selectedTaskIds])", "  }, [tasks, selectedTaskId, selectedTaskIds, handleUndo, handleRedo])", 1)
p.write_text(s)

p=Path('src/index.css'); s=p.read_text()+"""
.drop-tray-grid button.drop-target-hover { background: var(--ui-accent) !important; color: var(--ui-canvas) !important; border-color: var(--ui-accent) !important; outline: 1px solid var(--ui-accent) !important; }
"""; p.write_text(s)
