// Subtle animated film grain: dithers gradient banding in the blurred backdrop
// and glass (the "blocky" look), deterministic per frame.
import React from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame } from 'remotion';

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  const x = (frame * 137) % 512;
  const y = (frame * 251) % 512;
  return (
    <AbsoluteFill
      data-bleed="1"
      style={{
        pointerEvents: 'none',
        backgroundImage: `url(${staticFile('img/grain.png')})`,
        backgroundPosition: `${x}px ${y}px`,
        backgroundSize: '512px 512px',
        mixBlendMode: 'overlay',
        opacity,
      }}
    />
  );
};
