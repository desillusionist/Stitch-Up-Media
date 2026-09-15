import React, { useState } from 'react'
import { X, Plus, Trash2, Music, Video } from 'lucide-react'
import { DEFAULT_PRESETS } from '../constants/presets'
import { QueueTask, AudioTrackItem } from '../types'

interface MultiAudioModalProps {
  isOpen: boolean
  onClose: () => void
  onAddMultiAudioTask: (task: Partial<QueueTask>) => void
}

export const MultiAudioModal: React.FC<MultiAudioModalProps> = ({
  isOpen,
  onClose,
  onAddMultiAudioTask,
}) => {
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [tracks, setTracks] = useState<AudioTrackItem[]>([])
  const [outputName, setOutputName] = useState('multitrack_video.mp4')
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESETS[0])

  if (!isOpen) return null

  const handlePickVideo = async () => {
    if (window.electronAPI) {
      const files = await window.electronAPI.selectFiles()
      if (files && files.length > 0) {
        setVideoPath(files[0])
      }
    }
  }

  const handleAddAudioTrack = async () => {
    if (window.electronAPI) {
      const files = await window.electronAPI.selectFiles()
      if (files && files.length > 0) {
        const newTracks: AudioTrackItem[] = files.map((filePath, i) => ({
          id: Math.random().toString(36).substring(7),
          path: filePath,
          language: 'eng',
          title: `Track ${tracks.length + i + 1}`
        }))
        setTracks((prev) => [...prev, ...newTracks])
      }
    }
  }

  const handleUpdateTrack = (id: string, field: 'language' | 'title', value: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    )
  }

  const handleRemoveTrack = (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id))
  }

  const handleCreate = () => {
    if (!videoPath || tracks.length === 0) return
    onAddMultiAudioTask({
      type: 'multitrack',
      sourcePaths: [videoPath],
      additionalAudioTracks: tracks,
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
            <Music className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Multi-Track Audio Muxer</h2>
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
            Attach multiple separate language audio tracks (e.g. English, Spanish, French) into a single container with proper stream tags.
          </p>

          {/* Master Video Selector */}
          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1.5">Master Video</label>
            {videoPath ? (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 px-3 py-2 rounded-lg text-xs">
                <div className="flex items-center space-x-2 truncate">
                  <Video className="w-4 h-4 text-neutral-400" />
                  <span className="truncate text-white" title={videoPath}>
                    {videoPath.split('/').pop()}
                  </span>
                </div>
                <button
                  onClick={handlePickVideo}
                  className="text-xs text-mac-accent hover:underline font-medium ml-2"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={handlePickVideo}
                className="w-full border border-dashed border-white/10 rounded-xl p-4 text-center text-xs text-neutral-400 hover:border-white/20 transition-all flex items-center justify-center space-x-2"
              >
                <Video className="w-4 h-4" />
                <span>Select Master Video File</span>
              </button>
            )}
          </div>

          {/* Audio Tracks List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-300">
                Additional Audio Tracks ({tracks.length})
              </span>
              <button
                onClick={handleAddAudioTrack}
                className="flex items-center space-x-1 text-xs text-mac-accent hover:underline font-medium"
              >
                <Plus className="w-3 h-3" />
                <span>Add Audio Track</span>
              </button>
            </div>

            {tracks.length === 0 ? (
              <div
                onClick={handleAddAudioTrack}
                className="border border-dashed border-white/10 rounded-xl p-5 text-center text-xs text-neutral-500 cursor-pointer hover:border-white/20 transition-all"
              >
                Click to add audio track files (WAV, AAC, MP3, FLAC, AC3)
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center space-x-2 bg-white/5 border border-white/5 p-2.5 rounded-lg text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-white truncate font-medium" title={track.path}>
                        {track.path.split('/').pop()}
                      </div>
                      <div className="flex items-center space-x-2 mt-1.5">
                        <input
                          type="text"
                          placeholder="Title (e.g. Director Commentary)"
                          value={track.title || ''}
                          onChange={(e) => handleUpdateTrack(track.id, 'title', e.target.value)}
                          className="bg-black/30 border border-white/10 rounded px-2 py-0.5 text-[11px] text-white flex-1 focus:outline-none"
                        />
                        <select
                          value={track.language}
                          onChange={(e) => handleUpdateTrack(track.id, 'language', e.target.value)}
                          className="bg-black/30 border border-white/10 rounded px-2 py-0.5 text-[11px] text-white focus:outline-none"
                        >
                          <option value="eng">English (eng)</option>
                          <option value="spa">Spanish (spa)</option>
                          <option value="fra">French (fra)</option>
                          <option value="deu">German (deu)</option>
                          <option value="ita">Italian (ita)</option>
                          <option value="jpn">Japanese (jpn)</option>
                          <option value="rus">Russian (rus)</option>
                          <option value="und">Undetermined (und)</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveTrack(track.id)}
                      className="p-1 text-neutral-500 hover:text-mac-danger"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Output Filename */}
          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1.5">Output Filename</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-mac-accent"
            />
          </div>

          {/* Preset Selector */}
          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1.5">Preset</label>
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
            disabled={!videoPath || tracks.length === 0}
            onClick={handleCreate}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-mac-accent text-white hover:bg-mac-accentHover disabled:opacity-50 shadow-md transition-all"
          >
            Add Multi-Audio Task to Queue
          </button>
        </div>
      </div>
    </div>
  )
}
