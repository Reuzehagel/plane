import type { Camera, Card, HandleCorner, Point } from "./types";
import { HANDLE_HIT_SIZE } from "./constants";

function pointInRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
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
