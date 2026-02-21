import type { AnchorPosition, Camera, Card, Connection, Frame, HandleCorner, Point } from "../types";
import { DOT_SPACING, HANDLE_HIT_SIZE, SNAP_LERP, SNAP_EPSILON, FRAME_LABEL_FONT_SIZE, FRAME_LABEL_OFFSET_Y, CONNECTION_BEZIER_OFFSET, CONNECTION_LABEL_FONT_SIZE, CONNECTION_LABEL_PAD } from "../constants";

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

export function getRectBounds(
  items: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
): Bounds | null {
  if (items.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of items) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { minX, minY, maxX, maxY };
}

export function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
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

export function hitTestRectHandles<T extends { id: string; x: number; y: number; width: number; height: number }>(
  screenX: number,
  screenY: number,
  items: T[],
  selectedIds: Set<string>,
  cam: Camera,
): { item: T; handle: HandleCorner } | null {
  const half = HANDLE_HIT_SIZE / 2;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!selectedIds.has(item.id)) continue;
    const { x: sx, y: sy } = worldToScreen(item.x, item.y, cam);
    const sw = item.width * cam.zoom;
    const sh = item.height * cam.zoom;
    const corners = getCardCorners(sx, sy, sw, sh);
    for (let j = 0; j < corners.length; j++) {
      const [cx, cy] = corners[j];
      if (pointInRect(screenX, screenY, cx - half, cy - half, HANDLE_HIT_SIZE, HANDLE_HIT_SIZE)) {
        return { item, handle: HANDLE_CORNERS[j] };
      }
    }
  }
  return null;
}

// Frame border hit-test: returns true if point is on the border strip
export function hitTestFrameBorder(wx: number, wy: number, frame: Frame, thickness: number): boolean {
  const outer = pointInRect(wx, wy, frame.x, frame.y, frame.width, frame.height);
  if (!outer) return false;
  const inner = pointInRect(
    wx, wy,
    frame.x + thickness, frame.y + thickness,
    frame.width - thickness * 2, frame.height - thickness * 2,
  );
  return !inner;
}

// Frame label hit-test: label area above frame top-left
export function hitTestFrameLabel(wx: number, wy: number, frame: Frame): boolean {
  const labelH = FRAME_LABEL_FONT_SIZE + 4;
  const labelW = Math.max(80, frame.label.length * FRAME_LABEL_FONT_SIZE * 0.7);
  return pointInRect(
    wx, wy,
    frame.x, frame.y + FRAME_LABEL_OFFSET_Y - labelH,
    labelW, labelH,
  );
}

// Hit-test frames back-to-front, tests border + label
export function hitTestFrames(wx: number, wy: number, frames: Frame[], borderThickness: number): Frame | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (hitTestFrameBorder(wx, wy, f, borderThickness) || hitTestFrameLabel(wx, wy, f)) {
      return f;
    }
  }
  return null;
}


// Returns cards whose bounding box is fully contained within the frame
export function getCardsInFrame(frame: Frame, cards: Card[]): Card[] {
  const result: Card[] = [];
  for (const c of cards) {
    if (
      c.x >= frame.x &&
      c.y >= frame.y &&
      c.x + c.width <= frame.x + frame.width &&
      c.y + c.height <= frame.y + frame.height
    ) {
      result.push(c);
    }
  }
  return result;
}

// ─── Connection geometry ────────────────────────────────────────────────

export function getAnchorPoint(card: Card, anchor: AnchorPosition): Point {
  switch (anchor) {
    case "top":    return { x: card.x + card.width / 2, y: card.y };
    case "bottom": return { x: card.x + card.width / 2, y: card.y + card.height };
    case "left":   return { x: card.x, y: card.y + card.height / 2 };
    case "right":  return { x: card.x + card.width, y: card.y + card.height / 2 };
  }
}

function getAnchorNormal(anchor: AnchorPosition): Point {
  switch (anchor) {
    case "top":    return { x: 0, y: -1 };
    case "bottom": return { x: 0, y:  1 };
    case "left":   return { x: -1, y: 0 };
    case "right":  return { x:  1, y: 0 };
  }
}

export interface BezierPoints {
  p0: Point;
  cp1: Point;
  cp2: Point;
  p3: Point;
}

export function getConnectionBezier(fromCard: Card, fromAnchor: AnchorPosition, toCard: Card, toAnchor: AnchorPosition): BezierPoints {
  const p0 = getAnchorPoint(fromCard, fromAnchor);
  const p3 = getAnchorPoint(toCard, toAnchor);
  const n0 = getAnchorNormal(fromAnchor);
  const n3 = getAnchorNormal(toAnchor);
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const offset = Math.max(CONNECTION_BEZIER_OFFSET, dist * 0.3);
  return {
    p0,
    cp1: { x: p0.x + n0.x * offset, y: p0.y + n0.y * offset },
    cp2: { x: p3.x + n3.x * offset, y: p3.y + n3.y * offset },
    p3,
  };
}

export function getBezierPointFromAnchor(card: Card, anchor: AnchorPosition, worldTarget: Point): BezierPoints {
  const p0 = getAnchorPoint(card, anchor);
  const n0 = getAnchorNormal(anchor);
  const dist = Math.hypot(worldTarget.x - p0.x, worldTarget.y - p0.y);
  const offset = Math.max(CONNECTION_BEZIER_OFFSET, dist * 0.3);
  return {
    p0,
    cp1: { x: p0.x + n0.x * offset, y: p0.y + n0.y * offset },
    cp2: worldTarget,
    p3: worldTarget,
  };
}

export function hitTestAnchors(wx: number, wy: number, card: Card, hitRadius: number): AnchorPosition | null {
  const anchors: AnchorPosition[] = ["top", "bottom", "left", "right"];
  for (const anchor of anchors) {
    const pt = getAnchorPoint(card, anchor);
    if (Math.hypot(wx - pt.x, wy - pt.y) <= hitRadius) return anchor;
  }
  return null;
}

function cubicBezierAt(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function distanceToCubicBezier(px: number, py: number, b: BezierPoints): number {
  let minDist = Infinity;
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bx = cubicBezierAt(t, b.p0.x, b.cp1.x, b.cp2.x, b.p3.x);
    const by = cubicBezierAt(t, b.p0.y, b.cp1.y, b.cp2.y, b.p3.y);
    const d = Math.hypot(px - bx, py - by);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function getBezierMidpoint(b: BezierPoints): Point {
  return {
    x: cubicBezierAt(0.5, b.p0.x, b.cp1.x, b.cp2.x, b.p3.x),
    y: cubicBezierAt(0.5, b.p0.y, b.cp1.y, b.cp2.y, b.p3.y),
  };
}

export function hitTestConnections(
  wx: number, wy: number,
  connections: Connection[], cards: Card[],
  tolerance: number,
): Connection | null {
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  for (let i = connections.length - 1; i >= 0; i--) {
    const conn = connections[i];
    const fromCard = cardMap.get(conn.fromCardId);
    const toCard = cardMap.get(conn.toCardId);
    if (!fromCard || !toCard) continue;
    const bezier = getConnectionBezier(fromCard, conn.fromAnchor, toCard, conn.toAnchor);
    if (distanceToCubicBezier(wx, wy, bezier) <= tolerance) return conn;
  }
  return null;
}

export function bestAnchorForPoint(card: Card, point: Point): AnchorPosition {
  const anchors: AnchorPosition[] = ["top", "bottom", "left", "right"];
  let best: AnchorPosition = "top";
  let bestDist = Infinity;
  for (const anchor of anchors) {
    const pt = getAnchorPoint(card, anchor);
    const d = Math.hypot(point.x - pt.x, point.y - pt.y);
    if (d < bestDist) { bestDist = d; best = anchor; }
  }
  return best;
}

export function hitTestConnectionLabel(
  wx: number, wy: number,
  conn: Connection, cards: Card[],
): boolean {
  if (!conn.label) return false;
  const fromCard = cards.find((c) => c.id === conn.fromCardId);
  const toCard = cards.find((c) => c.id === conn.toCardId);
  if (!fromCard || !toCard) return false;
  const bezier = getConnectionBezier(fromCard, conn.fromAnchor, toCard, conn.toAnchor);
  const mid = getBezierMidpoint(bezier);
  const textW = conn.label.length * CONNECTION_LABEL_FONT_SIZE * 0.6 + CONNECTION_LABEL_PAD * 2;
  const textH = CONNECTION_LABEL_FONT_SIZE + CONNECTION_LABEL_PAD * 2;
  return pointInRect(wx, wy, mid.x - textW / 2, mid.y - textH / 2, textW, textH);
}

