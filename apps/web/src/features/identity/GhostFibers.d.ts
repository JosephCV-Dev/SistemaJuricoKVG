import type { HTMLAttributes } from 'react';

interface GhostFibersProps extends HTMLAttributes<HTMLDivElement> {
  glowColor?: string;
  secondaryColor?: string;
  lineColor?: string;
  gradient?: 'depth' | 'along' | 'across';
  layers?: number;
  threads?: number;
  speed?: number;
  brightness?: number;
  particles?: number;
  mouseInteraction?: boolean;
  pulseOnClick?: boolean;
  intro?: boolean;
  dpr?: number;
}

export default function GhostFibers(props: GhostFibersProps): React.JSX.Element;
