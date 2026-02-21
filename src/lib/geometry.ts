import type { Camera, Card, HandleCorner, Point } from "../types";
import { DOT_SPACING, HANDLE_HIT_SIZE, SNAP_LERP, SNAP_EPSILON } from "../constants";

function pointInRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function rectsIntersect(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax + aw > bx && ax < bx + bw && ay + ah > by && ay < by + bh;
}

export function screenToWorld(sx: number, sy: number, cam: Camera): Point {
  return {
    x: sx / cam.zoom - cam.x,
    y: sy / cam.zoom - cam.y,
  };
}

export function worldToScreen(wx: number, wy: number, cam: Camera): Point {
  return {
    x: (wx + cam.x) * cam.zoom,
    y: (wy + cam.y) * cam.zoom,
  };
}

export function mouseToScreen(e: MouseEvent, rect: DOMRect): Point {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function mouseToWorld(e: MouseEvent, rect: DOMRect, cam: Camera): Point {
  const { x, y } = mouseToScreen(e, rect);
  return screenToWorld(x, y, cam);
}

export function snapToGrid(value: number): number {
  return Math.round(value / DOT_SPACING) * DOT_SPACING;
}

export function snapPoint(x: number, y: number): Point {
  return { x: snapToGrid(x), y: snapToGrid(y) };
}

// Lerp toward target, snapping exactly when close enough to avoid sub-pixel drift
export function lerpSnap(current: number, target: number): number {
  const d = target - current;
  return Math.abs(d) < SNAP_EPSILON ? target : current + d * SNAP_LERP;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getContentBounds(cards: Card[]): Bounds | null {
  if (cards.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.width > maxX) maxX = c.x + c.width;
    if (c.y + c.height > maxY) maxY = c.y + c.height;
  }
  return { minX, minY, maxX, maxY };
}

export function getBoundsCenter(bounds: Bounds): Point {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function isContentVisible(cards: Card[], cam: Camera, viewW: number, viewH: number): boolean {
  if (cards.length === 0) return true;
  const vx = -cam.x;
  const vy = -cam.y;
  const vw = viewW / cam.zoom;
  const vh = viewH / cam.zoom;
  for (const c of cards) {
    if (rectsIntersect(c.x, c.y, c.width, c.height, vx, vy, vw, vh)) {
      return true;
    }
  }
  return false;
}

export function hitTestCards(wx: number, wy: number, cards: Card[]): Card | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (pointInRect(wx, wy, c.x, c.y, c.width, c.height)) return c;
  }
  return null;
}

// Order must match HANDLE_CORNERS — both are co-located to prevent drift
const HANDLE_CORNERS: HandleCorner[] = ["nw", "ne", "sw", "se"];

export function getCardCorners(sx: number, sy: number, sw: number, sh: number): [number, number][] {
  return [[sx, sy], [sx + sw, sy], [sx, sy + sh], [sx + sw, sy + sh]];
}

export function hitTestHandles(
  screenX: number,
  screenY: number,
  cards: Card[],
  selectedCardIds: Set<string>,
  cam: Camera,
): { card: Card; handle: HandleCorner } | null {
  const half = HANDLE_HIT_SIZE / 2;
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    if (!selectedCardIds.has(card.id)) continue;
    const { x: sx, y: sy } = worldToScreen(card.x, card.y, cam);
    const sw = card.width * cam.zoom;
    const sh = card.height * cam.zoom;
    const corners = getCardCorners(sx, sy, sw, sh);
    for (let j = 0; j < corners.length; j++) {
      const [cx, cy] = corners[j];
      if (pointInRect(screenX, screenY, cx - half, cy - half, HANDLE_HIT_SIZE, HANDLE_HIT_SIZE)) {
        return { card, handle: HANDLE_CORNERS[j] };
      }
    }
  }
  return null;
}
