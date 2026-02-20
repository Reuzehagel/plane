import type { Camera, Card, HandleCorner, Point } from "./types";
import { HANDLE_HIT_SIZE } from "./constants";

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

export function mouseToWorld(e: MouseEvent, canvas: HTMLCanvasElement, cam: Camera): Point {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, cam);
}

export function hitTestCards(wx: number, wy: number, cards: Card[]): Card | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (wx >= c.x && wx <= c.x + c.width && wy >= c.y && wy <= c.y + c.height) {
      return c;
    }
  }
  return null;
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
    const corners: [number, number, HandleCorner][] = [
      [sx, sy, "nw"],
      [sx + sw, sy, "ne"],
      [sx, sy + sh, "sw"],
      [sx + sw, sy + sh, "se"],
    ];
    for (const [cx, cy, handle] of corners) {
      if (
        screenX >= cx - half && screenX <= cx + half &&
        screenY >= cy - half && screenY <= cy + half
      ) {
        return { card, handle };
      }
    }
  }
  return null;
}
