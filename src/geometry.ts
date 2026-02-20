import type { Camera, Card, Point } from "./types";

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
