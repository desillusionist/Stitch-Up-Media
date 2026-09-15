import React, { useState } from 'react'
import { X } from 'lucide-react'
import { EncodingPreset } from '../types'

interface Props { onApply: (preset: EncodingPreset) => void; onClose: () => void }
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block text-neutral-300">{label}<div className="mt-1">{children}</div></label>
const selectClass = 'w-full bg-white/5 border border-white/10 rounded p-2 text-white'
const inputClass = 'w-full bg-white/5 border border-white/10 rounded p-2 text-white'

export const CustomSettingsSidebar: React.FC<Props> = ({ onApply, onClose }) => {
  const [mode, setMode] = useState<'video' | 'audio'>('video')
  const [container, setContainer] = useState<EncodingPreset['container']>('mp4')
  const [videoCodec, setVideoCodec] = useState<EncodingPreset['videoCodec']>('h264')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [ratio, setRatio] = useState<NonNullable<EncodingPreset['aspectRatio']>>('source')
  const [videoBitrate, setVideoBitrate] = useState(750)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [audioFormat, setAudioFormat] = useState<NonNullable<EncodingPreset['audioFormat']>>('aac')
  const [audioBitrate, setAudioBitrate] = useState(96)
  const [sampleRate, setSampleRate] = useState(48000)
  const [frameRate, setFrameRate] = useState(30)
  const [customName, setCustomName] = useState('Custom')
  const apply = () => {
    const audioContainer = audioFormat === 'pcm' ? 'wav' : audioFormat === 'opus' || audioFormat === 'aac' ? 'm4a' : audioFormat
    onApply({ id: `custom_${Date.now()}`, name: customName || (mode === 'audio' ? 'Audio extraction' : 'Custom'), container: mode === 'audio' ? audioContainer : container, videoCodec: mode === 'audio' ? 'copy' : videoCodec, audioCodec: mode === 'audio' ? audioFormat : (audioEnabled ? audioFormat : 'copy'), resolution: ratio === 'source' ? 'source' : 'source', width: mode === 'video' ? width : undefined, height: mode === 'video' ? height : undefined, aspectRatio: ratio, videoBitrate: mode === 'video' && videoCodec !== 'copy' ? `${videoBitrate}k` : undefined, audioEnabled, audioBitrate: audioEnabled ? `${audioBitrate}k` : undefined, audioSampleRate: sampleRate, frameRate, fps: frameRate, audioFormat, outputMode: mode, suffix: mode === 'audio' ? `Audio_${audioFormat}` : `Custom_${container.toUpperCase()}_${width}x${height}` })
  }
  return <aside className="relative z-40 w-[360px] shrink-0 overflow-y-auto bg-mac-card border-l border-white/10 shadow-2xl p-5 text-xs">
    <div className="flex items-center justify-between mb-5"><div><h2 className="font-semibold text-white">Custom Output Settings</h2><p className="text-[11px] text-neutral-400 mt-1">Fine-tune export parameters</p></div><button onClick={onClose} className="p-1 text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button></div>
    <div className="flex rounded-lg bg-white/5 p-1 mb-5"><button onClick={() => setMode('video')} className={`flex-1 rounded p-2 ${mode === 'video' ? 'bg-mac-accent text-white' : 'text-neutral-400'}`}>Video export</button><button onClick={() => setMode('audio')} className={`flex-1 rounded p-2 ${mode === 'audio' ? 'bg-mac-accent text-white' : 'text-neutral-400'}`}>Audio extraction</button></div>
    {mode === 'video' ? <div className="space-y-4">
      <Field label="Container"><select value={container} onChange={e => setContainer(e.target.value as EncodingPreset['container'])} className={selectClass}><option value="mp4">MP4</option><option value="mov">MOV</option><option value="mkv">MKV</option><option value="webm">WebM</option></select></Field>
      <Field label="Video codec"><select value={videoCodec} onChange={e => setVideoCodec(e.target.value as EncodingPreset['videoCodec'])} className={selectClass}><option value="h264">H.264</option><option value="hevc">HEVC</option><option value="prores">ProRes</option><option value="copy">Copy</option></select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Width (px)"><input type="number" min="16" value={width} onChange={e => setWidth(Number(e.target.value))} className={inputClass} /></Field><Field label="Height (px)"><input type="number" min="16" value={height} onChange={e => setHeight(Number(e.target.value))} className={inputClass} /></Field></div>
      <Field label="Aspect ratio"><select value={ratio} onChange={e => setRatio(e.target.value as NonNullable<EncodingPreset['aspectRatio']>)} className={selectClass}><option value="source">Preserve source</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="custom">Custom dimensions</option></select></Field>
      <label className="flex items-center justify-between text-neutral-300"><span>Include audio track</span><input type="checkbox" checked={audioEnabled} onChange={e => setAudioEnabled(e.target.checked)} className="w-4 h-4 accent-mac-accent" /></label>
            <Field label={`Video bitrate: ${videoBitrate} kb/s`}><input type="range" min="100" max="50000" step="50" value={videoBitrate} onChange={e => setVideoBitrate(Number(e.target.value))} className="w-full accent-mac-accent" /></Field>
      <Field label="Frame rate"><select value={frameRate} onChange={e => setFrameRate(Number(e.target.value))} className={selectClass}><option value="0">Source</option><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="50">50 fps</option><option value="60">60 fps</option></select></Field>
    </div> : <div className="space-y-4"><div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-emerald-300">Extract the selected audio stream without rendering video.</div><Field label="Audio format"><select value={audioFormat} onChange={e => setAudioFormat(e.target.value as NonNullable<EncodingPreset['audioFormat']>)} className={selectClass}><option value="aac">AAC (.m4a)</option><option value="mp3">MP3</option><option value="opus">Opus</option><option value="pcm">WAV / PCM</option><option value="flac">FLAC</option></select></Field><Field label={`Audio bitrate: ${audioBitrate} kb/s`}><input type="range" min="32" max="512" step="8" value={audioBitrate} onChange={e => setAudioBitrate(Number(e.target.value))} className="w-full accent-mac-accent" /></Field><Field label="Sample rate"><select value={sampleRate} onChange={e => setSampleRate(Number(e.target.value))} className={selectClass}><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="96000">96 kHz</option></select></Field></div>}
    <div className="border-t border-white/10 mt-5 pt-4 space-y-3"><Field label="Preset label"><input value={customName} onChange={e => setCustomName(e.target.value)} className={inputClass} /></Field><button onClick={apply} className="w-full rounded-lg bg-mac-accent px-3 py-2 font-semibold text-white hover:bg-mac-accentHover">Apply Custom Settings</button></div>
  </aside>
}
