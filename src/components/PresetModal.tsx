import React, { useEffect, useRef, useState } from 'react'
import { X, Check } from 'lucide-react'
import { EncodingPreset } from '../types'
import { DEFAULT_PRESETS } from '../constants/presets'

interface PresetModalProps {
  isOpen: boolean
  currentPreset: EncodingPreset
  onSelectPreset: (preset: EncodingPreset) => void
  onClose: () => void
  onOpenCustom?: () => void
  jobType?: 'transcode' | 'stitch' | 'multitrack' | 'combo'
  inputKind?: 'image' | 'sequence' | 'video'
}

export const PresetModal: React.FC<PresetModalProps> = ({
  isOpen,
  currentPreset,
  onSelectPreset,
  onClose,
  onOpenCustom,
  jobType = 'transcode',
  inputKind = 'video',
}) => {
  const availablePresets = DEFAULT_PRESETS.filter((preset) => {
    if (inputKind === 'sequence' && preset.imageOutputMode === 'still') return false
    if (inputKind === 'image' && preset.outputMode === 'audio') return false
    if (jobType === 'transcode') return true
    // Image-sequence inputs may be exported as image sequences regardless of job mode; still-image output remains invalid.
    if (inputKind === 'sequence') return preset.imageOutputMode === 'sequence' || !preset.imageOutputMode
    // Stitching and track-compositing operate on playable video/audio outputs; still-image exports remain hidden.
    if (inputKind === 'image' && jobType === 'stitch') return preset.imageOutputMode === 'sequence' || !preset.imageOutputMode
    return !preset.imageOutputMode
  })
  const [focusedIndex, setFocusedIndex] = useState(() => Math.max(0, availablePresets.findIndex((preset) => preset.id === currentPreset.id)))
  const focusedIndexRef = useRef(focusedIndex)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ video: true, image: true, audio: true })
  const [sortMode, setSortMode] = useState<'media' | 'format'>('media')

  useEffect(() => {
    if (!isOpen) return
    const initialIndex = Math.max(0, availablePresets.findIndex((preset) => preset.id === currentPreset.id))
    focusedIndexRef.current = initialIndex
    setFocusedIndex(initialIndex)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusedIndex((index) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1
          const nextIndex = (index + delta + availablePresets.length) % availablePresets.length
          focusedIndexRef.current = nextIndex
          return nextIndex
        })
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const preset = availablePresets[focusedIndexRef.current]
        if (preset) {
          onSelectPreset(preset)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPreset.id, isOpen, jobType, inputKind])

  if (!isOpen) return null

  return (
    <div className="preset-selector-overlay" role="dialog" aria-modal="true" aria-label="Select encoding preset">
      <div className="preset-selector-panel">
        <div className="preset-selector-header">
          <h2 className="panel-kicker">SELECT ENCODING PRESET</h2>
          <button onClick={onClose} className="preset-selector-close" aria-label="Close preset selector"><X className="w-4 h-4" /></button>
        </div>
        <div className="preset-selector-list">
          <button onClick={() => (onOpenCustom ? onOpenCustom() : onClose())} className="preset-option preset-custom-option">CUSTOM...</button>
          <div className="preset-sort-switcher" role="tablist" aria-label="Preset sorting"><button className={sortMode === 'media' ? 'active' : ''} onClick={() => setSortMode('media')}>BY MEDIA TYPE</button><button className={sortMode === 'format' ? 'active' : ''} onClick={() => setSortMode('format')}>BY FORMAT</button></div>
          {(sortMode === 'media' ? (['video', 'image', 'audio'] as const).map((group) => ({ key: group, label: group === 'video' ? 'VIDEO OUTPUT' : group === 'image' ? 'IMAGE OUTPUT' : 'AUDIO EXTRACTION', presets: availablePresets.filter((preset) => group === 'audio' ? preset.outputMode === 'audio' : group === 'image' ? Boolean(preset.imageOutputMode) : preset.outputMode !== 'audio' && !preset.imageOutputMode) })) : Array.from(new Map(availablePresets.map((preset) => { const key = preset.outputMode === 'audio' ? 'AUDIO' : preset.imageOutputMode ? (preset.imageOutputMode === 'sequence' ? 'IMAGE SEQUENCE' : 'IMAGE STILL') : `${preset.container.toUpperCase()} / ${(preset.videoCodec || 'VIDEO').toUpperCase()}`; return [key, key] })).keys()).map((key) => ({ key, label: key, presets: availablePresets.filter((preset) => { const candidate = preset.outputMode === 'audio' ? 'AUDIO' : preset.imageOutputMode ? (preset.imageOutputMode === 'sequence' ? 'IMAGE SEQUENCE' : 'IMAGE STILL') : `${preset.container.toUpperCase()} / ${(preset.videoCodec || 'VIDEO').toUpperCase()}`; return candidate === key }) }))).map((group) => {
            if (!group.presets.length) return null
            return <section key={group.key} className="preset-group"><button className="preset-group-header" onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !current[group.key] }))} aria-expanded={openGroups[group.key] !== false}><span>{openGroups[group.key] === false ? '+' : '−'}</span><strong>{group.label}</strong><span>{group.presets.length}</span></button>{openGroups[group.key] !== false && group.presets.map((preset) => { const index = availablePresets.findIndex((item) => item.id === preset.id); const selected = preset.id === currentPreset.id; const focused = index === focusedIndex; return <button key={preset.id} onMouseEnter={() => { focusedIndexRef.current = index; setFocusedIndex(index) }} onClick={() => { onSelectPreset(preset); onClose() }} className={`preset-option ${selected ? 'preset-option-selected' : ''} ${focused ? 'preset-option-focused' : ''}`}><span className="preset-option-copy"><span className="preset-option-name">{preset.name}</span><span className="preset-option-meta">{preset.container.toUpperCase()} · {preset.videoCodec.toUpperCase()} · {preset.imageOutputMode === 'sequence' ? 'SEQUENCE' : preset.imageOutputMode === 'still' ? 'STILL' : preset.resolution}{preset.videoBitrate ? ` · ${preset.videoBitrate} VIDEO` : ''}{preset.audioBitrate ? ` · ${preset.audioBitrate} AUDIO` : ''}</span></span>{selected && <Check className="preset-option-check" />}</button> })}</section>
          })}
        </div>
      </div>
    </div>
  )
}
