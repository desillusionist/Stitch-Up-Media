import React, { useEffect, useState } from 'react'
import { X, Sliders, Bell, Folder } from 'lucide-react'
import { AppSettings } from '../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => void
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSaveSettings }) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings)
  // The panel is always mounted and merely returns null while closed, so this state was
  // captured on the very first render, before the saved settings had been read back from
  // disk. Opening it then showed the defaults, and saving wrote those defaults over every
  // setting the user had not just touched. Re-sync on each open, and whenever the stored
  // settings change underneath.
  useEffect(() => {
    if (isOpen) setLocalSettings(settings)
  }, [isOpen, settings])
  if (!isOpen) return null

  const handleSelectDefaultOutput = async () => {
    const dir = await window.electronAPI?.selectOutputDir()
    if (dir) setLocalSettings((prev) => ({ ...prev, defaultOutputDir: dir }))
  }
  const handleSelectCache = async () => {
    const dir = await window.electronAPI?.selectOutputDir()
    if (dir) setLocalSettings((prev) => ({ ...prev, cacheDirectory: dir, saveTempNextToSource: false }))
  }
  const handleSelectScreenshots = async () => {
    const dir = await window.electronAPI?.selectOutputDir()
    if (dir) setLocalSettings((prev) => ({ ...prev, screenshotDirectory: dir }))
  }
  const handleClearCache = async () => {
    const result = await window.electronAPI?.clearCache(localSettings.cacheDirectory)
    if (result) window.alert(`Cleared ${result.deleted} cached item(s).`)
  }
  const handleSave = () => { onSaveSettings(localSettings); onClose() }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-mac-card border border-white/10 rounded-2xl w-full max-w-md max-h-[calc(100vh-32px)] shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center space-x-2"><Sliders className="w-4 h-4 text-mac-accent" /><h2 className="text-sm font-semibold text-white">Settings</h2></div>
          <button onClick={onClose} className="p-1 rounded-lg text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 text-xs overflow-y-auto min-h-0">
          <div>
            <label className="font-medium text-neutral-200 block mb-1">Parallel Encoding Limit: <span className="text-mac-accent font-semibold">{localSettings.maxConcurrentTasks}</span></label>
            <p className="text-[11px] text-neutral-400 mb-2">Number of files/fragments rendered simultaneously.</p>
            <input type="range" min="1" max="4" value={localSettings.maxConcurrentTasks} onChange={(e) => setLocalSettings({ ...localSettings, maxConcurrentTasks: Number(e.target.value) })} className="w-full accent-mac-accent" />
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between"><div><span className="font-medium text-neutral-200 block">Apple VideoToolbox Acceleration</span><span className="text-[11px] text-neutral-400">Uses Apple Silicon hardware media engines</span></div><input type="checkbox" checked={localSettings.useHardwareAcceleration} onChange={(e) => setLocalSettings({ ...localSettings, useHardwareAcceleration: e.target.checked })} className="w-4 h-4 accent-mac-accent" /></div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between"><div className="flex items-center space-x-2"><Bell className="w-4 h-4 text-neutral-400" /><div><span className="font-medium text-neutral-200 block">macOS Notifications</span><span className="text-[11px] text-neutral-400">Alert when rendering completes</span></div></div><input type="checkbox" checked={localSettings.notifyOnCompletion} onChange={(e) => setLocalSettings({ ...localSettings, notifyOnCompletion: e.target.checked })} className="w-4 h-4 accent-mac-accent" /></div>
          <div className="h-px bg-white/5" />
          <div><span className="font-medium text-neutral-200 block mb-1">Default Output Directory</span><div className="flex items-center space-x-2"><div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-neutral-300 truncate">{localSettings.defaultOutputDir || 'Same as source folder'}</div><button onClick={handleSelectDefaultOutput} className="px-2.5 py-1.5 bg-white/10 rounded-lg text-neutral-200"><Folder className="w-3.5 h-3.5" /></button></div></div>
          <div className="h-px bg-white/5" />
          <div><label className="font-medium text-neutral-200 block mb-1">Default Still Image Duration</label><p className="text-[11px] text-neutral-400 mb-2">Duration used when an image is exported through a video preset.</p><div className="flex items-center gap-2"><input className="flex-1 px-2.5 py-1.5" type="number" min="0.1" step="0.1" value={localSettings.defaultImageDuration} onChange={(event) => setLocalSettings((prev) => ({ ...prev, defaultImageDuration: Math.max(0.1, Number(event.target.value) || 10) }))} /><span className="text-xs text-neutral-400">SECONDS</span></div></div>
          <div className="h-px bg-white/5" />
          <div><label className="font-medium text-neutral-200 block mb-1">Default Image Sequence FPS</label><p className="text-[11px] text-neutral-400 mb-2">Used when importing a numbered image sequence.</p><select className="w-full px-2.5 py-1.5" value={([23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as number[]).includes(Number(localSettings.sequenceFps)) ? String(localSettings.sequenceFps) : "custom"} onChange={(event) => setLocalSettings((prev) => ({ ...prev, sequenceFps: event.target.value === "custom" ? 0 : Number(event.target.value) }))}>{[23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].map((rate) => <option key={rate} value={String(rate)}>{rate} FPS</option>)}<option value="custom">CUSTOM...</option></select>{!([23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as number[]).includes(Number(localSettings.sequenceFps)) && <input className="w-full mt-2 px-2.5 py-1.5" type="number" min="0.001" step="0.001" value={(localSettings.sequenceFps || 0) > 0 ? localSettings.sequenceFps : ""} placeholder="ENTER FPS" onChange={(event) => setLocalSettings((prev) => ({ ...prev, sequenceFps: Number(event.target.value) || 0 }))} />}</div>
                    <div className="h-px bg-white/5" />
                    <div><label className="font-medium text-neutral-200 block mb-1">Default Still Image FPS</label><p className="text-[11px] text-neutral-400 mb-2">Rate a still image is rendered at when it is exported as video. Falls back to the image sequence rate.</p><select className="w-full px-2.5 py-1.5" value={([23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as number[]).includes(Number(localSettings.defaultImageFps)) ? String(localSettings.defaultImageFps) : "custom"} onChange={(event) => setLocalSettings((prev) => ({ ...prev, defaultImageFps: event.target.value === "custom" ? 0 : Number(event.target.value) }))}>{[23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].map((rate) => <option key={rate} value={String(rate)}>{rate} FPS</option>)}<option value="custom">CUSTOM...</option></select>{!([23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as number[]).includes(Number(localSettings.defaultImageFps)) && <input className="w-full mt-2 px-2.5 py-1.5" type="number" min="0.001" step="0.001" value={(localSettings.defaultImageFps || 0) > 0 ? localSettings.defaultImageFps : ""} placeholder="ENTER FPS" onChange={(event) => setLocalSettings((prev) => ({ ...prev, defaultImageFps: Number(event.target.value) || 0 }))} />}</div>
          <div className="h-px bg-white/5" />
          <div><label className="font-medium text-neutral-200 block mb-1">Quick Look Stamp Display</label><p className="text-[11px] text-neutral-400 mb-2">Choose timecode or frame-count stamps in the Advanced helper.</p><select className="w-full px-2.5 py-1.5" value={localSettings.timestampDisplayMode || 'timestamp'} onChange={(event) => setLocalSettings((prev) => ({ ...prev, timestampDisplayMode: event.target.value as 'timestamp' | 'framestamp' }))}><option value="timestamp">TIMESTAMP · HH:MM:SS.FF</option><option value="framestamp">FRAMESTAMP · FRAME NUMBER</option></select></div>
          <div className="h-px bg-white/5" />
          <div><span className="font-medium text-neutral-200 block mb-1">Screenshots</span><div className="flex items-center space-x-2"><div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-neutral-300 truncate">{localSettings.screenshotDirectory || "Pictures folder"}</div><button onClick={handleSelectScreenshots} className="px-2.5 py-1.5 bg-white/10 rounded-lg text-neutral-200"><Folder className="w-3.5 h-3.5" /></button></div><p className="text-[11px] text-neutral-400 mt-1">Cmd+S screenshots are saved here.</p></div><div className="h-px bg-white/5" /><div><span className="font-medium text-neutral-200 block mb-1">Temporary / Cache</span><div className="flex items-center space-x-2"><div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-neutral-300 truncate">{localSettings.saveTempNextToSource ? 'Save next to source' : (localSettings.cacheDirectory || 'System temporary folder')}</div><button onClick={handleSelectCache} className="px-2.5 py-1.5 bg-white/10 rounded-lg text-neutral-200"><Folder className="w-3.5 h-3.5" /></button></div><label className="flex items-center gap-2 mt-2 text-neutral-300"><input type="checkbox" checked={localSettings.saveTempNextToSource} onChange={(e) => setLocalSettings({ ...localSettings, saveTempNextToSource: e.target.checked })} className="w-4 h-4 accent-mac-accent" />Save temporary and trimmed files next to source</label><button onClick={handleClearCache} className="mt-2 px-2.5 py-1.5 bg-white/10 rounded-lg text-neutral-200">Clear Cache</button></div>
        </div>
        <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-white/5 bg-white/[0.02]"><button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-neutral-400">Cancel</button><button onClick={handleSave} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-mac-accent text-white">Save Changes</button></div>
      </div>
    </div>
  )
}
