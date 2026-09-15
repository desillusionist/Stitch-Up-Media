import React, { useState } from 'react'
import { X, Plus, Trash2, ArrowUp, ArrowDown, Film } from 'lucide-react'
import { DEFAULT_PRESETS } from '../constants/presets'
import { QueueTask } from '../types'

interface StitchModalProps {
  isOpen: boolean
  onClose: () => void
  onAddStitchTask: (task: Partial<QueueTask>) => void
}

export const StitchModal: React.FC<StitchModalProps> = ({
  isOpen,
  onClose,
  onAddStitchTask,
}) => {
  const [clipPaths, setClipPaths] = useState<string[]>([])
  const [outputName, setOutputName] = useState('stitched_output.mp4')
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESETS[0])

  if (!isOpen) return null

  const handlePickClips = async () => {
    if (window.electronAPI) {
      const files = await window.electronAPI.selectFiles()
      if (files && files.length > 0) {
        setClipPaths((prev) => [...prev, ...files])
      }
    }
  }

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const newIdx = direction === 'up' ? index - 1 : index + 1
    if (newIdx < 0 || newIdx >= clipPaths.length) return
    const updated = [...clipPaths]
    const [moved] = updated.splice(index, 1)
    updated.splice(newIdx, 0, moved)
    setClipPaths(updated)
  }

  const handleRemove = (index: number) => {
    setClipPaths((prev) => prev.filter((_, i) => i !== index))
  }

  const handleCreate = () => {
    if (clipPaths.length < 2) return
    onAddStitchTask({
      type: 'stitch',
      sourcePaths: clipPaths,
      outputFilename: outputName,
      preset: selectedPreset,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-mac-card border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center space-x-2">
            <Film className="w-5 h-5 text-purple-400" />
            <h2 className="text-sm font-semibold text-white">Stitch Fragments (Multi-Clip Concat)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <p className="text-xs text-neutral-400 leading-relaxed">
            Merge multiple video fragments or frame sequences seamlessly in order into a single exported video file.
          </p>

          {/* Clips List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-300">
                Fragments ({clipPaths.length})
              </span>
              <button
                onClick={handlePickClips}
                className="flex items-center space-x-1 text-xs text-mac-accent hover:underline font-medium"
              >
                <Plus className="w-3 h-3" />
                <span>Add Fragments</span>
              </button>
            </div>

            {clipPaths.length === 0 ? (
              <div
                onClick={handlePickClips}
                className="border border-dashed border-white/10 rounded-xl p-6 text-center text-xs text-neutral-500 cursor-pointer hover:border-white/20 transition-all"
              >
                Click to select 2 or more video fragments to stitch
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {clipPaths.map((path, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-lg text-xs"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span className="text-neutral-500 font-mono text-[10px] w-4">{idx + 1}.</span>
                      <span className="truncate text-white" title={path}>
                        {path.split('/').pop()}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        disabled={idx === 0}
                        onClick={() => handleMove(idx, 'up')}
                        className="p-1 text-neutral-400 hover:text-white disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={idx === clipPaths.length - 1}
                        onClick={() => handleMove(idx, 'down')}
                        className="p-1 text-neutral-400 hover:text-white disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemove(idx)}
                        className="p-1 text-neutral-500 hover:text-mac-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Target File Name */}
          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1.5">Output Filename</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-mac-accent"
            />
          </div>

          {/* Preset Picker */}
          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1.5">Export Preset</label>
            <select
              value={selectedPreset.id}
              onChange={(e) => {
                const found = DEFAULT_PRESETS.find((p) => p.id === e.target.value)
                if (found) setSelectedPreset(found)
              }}
              className="w-full bg-mac-card border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-mac-accent"
            >
              {DEFAULT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.container.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-white/5 bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            disabled={clipPaths.length < 2}
            onClick={handleCreate}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-mac-accent text-white hover:bg-mac-accentHover disabled:opacity-50 shadow-md transition-all"
          >
            Add Stitch Task to Queue
          </button>
        </div>
      </div>
    </div>
  )
}
