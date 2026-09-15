import React from 'react'

/** Pixel-style vertical track stack: three independent horizontal layers. */
export const MultiTrackIcon = ({ size = 20, ...props }: { size?: number } & React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="currentColor" shapeRendering="crispEdges" {...props}>
    <rect x="2" y="2" width="20" height="2" />
    <rect x="2" y="4" width="2" height="4" />
    <rect x="20" y="4" width="2" height="4" />
    <rect x="4" y="6" width="16" height="2" />
    <rect x="2" y="10" width="20" height="2" />
    <rect x="2" y="12" width="2" height="4" />
    <rect x="20" y="12" width="2" height="4" />
    <rect x="4" y="14" width="16" height="2" />
    <rect x="2" y="18" width="20" height="2" />
    <rect x="2" y="20" width="2" height="2" />
    <rect x="20" y="20" width="2" height="2" />
  </svg>
)
