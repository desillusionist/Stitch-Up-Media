from pathlib import Path
# Swift compile fix and artwork layering
p=Path('electron/quicklook-preview.swift'); s=p.read_text(); old='imageView.isHidden = !(stillMode || audioArtwork); imageView.alphaValue = audioArtwork ? 0.22 : 1.0; imageView.imageScaling = .scaleProportionallyUpOrDown; addSubview(imageView); if audioArtwork { sendSubviewToBack(imageView) }'; new='imageView.isHidden = !(stillMode || audioArtwork); imageView.alphaValue = audioArtwork ? 0.22 : 1.0; imageView.imageScaling = .scaleProportionallyUpOrDown; if audioArtwork { addSubview(imageView, positioned: .below, relativeTo: playerView) } else { addSubview(imageView) }'; assert old in s; s=s.replace(old,new,1); p.write_text(s)
# Encoding type extensions
p=Path('src/types/index.ts'); s=p.read_text(); s=s.replace("'png' | 'jpg'", "'png' | 'jpg' | 'gif'",1); s=s.replace("  imageOutputMode?: 'sequence' | 'still'\n", "  imageOutputMode?: 'sequence' | 'still'\n  gifMode?: 'regular' | 'loop' | 'bounce'\n",1); p.write_text(s)
# Presets
p=Path('src/constants/presets.ts'); s=p.read_text(); insert='''  {
    id: 'gif_regular',
    name: 'GIF Animation — Regular',
    container: 'gif',
    videoCodec: 'copy',
    audioCodec: 'copy',
    resolution: 'source',
    fps: 12,
    gifMode: 'regular',
    suffix: 'GIF_Regular',
  },
  {
    id: 'gif_loop',
    name: 'GIF Animation — Loop',
    container: 'gif',
    videoCodec: 'copy',
    audioCodec: 'copy',
    resolution: 'source',
    fps: 12,
    gifMode: 'loop',
    suffix: 'GIF_Loop',
  },
  {
    id: 'gif_bounce',
    name: 'GIF Animation — Bounce',
    container: 'gif',
    videoCodec: 'copy',
    audioCodec: 'copy',
    resolution: 'source',
    fps: 12,
    gifMode: 'bounce',
    suffix: 'GIF_Bounce',
  },
'''
assert s.rstrip().endswith('}')
pos=s.rfind(']'); s=s[:pos]+insert+s[pos:]; p.write_text(s)
# Engine GIF handling
p=Path('electron/ffmpeg/engine.ts'); s=p.read_text(); needle="    // Custom stream selection and exact dimensions\n"; insert="""    if (preset.container === 'gif') {
      cmd.outputOptions(['-an', '-f gif', '-loop ' + (preset.gifMode === 'regular' ? '1' : '0')])
      if (preset.gifMode === 'bounce') {
        cmd.outputOptions(['-filter_complex [0:v]split[a][b];[b]reverse[rev];[a][rev]concat=n=2:v=1:a=0[v]', '-map [v]'])
      }
    }
    // Custom stream selection and exact dimensions
"""; assert needle in s; s=s.replace(needle,insert,1); p.write_text(s)
