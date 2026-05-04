import type { ComponentInstance, Rotation } from '../circuit/types';

/** Apply rotation+flip to a local symbol point. */
export function transformPoint(
  lx: number,
  ly: number,
  rotation: Rotation,
  flipped: boolean,
): { x: number; y: number } {
  let x = lx;
  let y = flipped ? -ly : ly;
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: -y, y: x };
    case 180: return { x: -x, y: -y };
    case 270: return { x: y, y: -x };
  }
}

export function pinWorld(c: ComponentInstance, pinX: number, pinY: number): { x: number; y: number } {
  const t = transformPoint(pinX, pinY, c.rotation, c.flipped);
  return { x: c.x + t.x, y: c.y + t.y };
}
