import type { BoxSelectState, Camera, Card } from "./types";
import { worldToScreen, getCardCorners } from "./geometry";
import {
  DOT_SPACING, DOT_RADIUS, DOT_COLOR,
  CARD_RADIUS, CARD_BG, CARD_BORDER,
  CARD_SHADOW, CARD_SELECTED_BORDER, HANDLE_SIZE,
  CARD_FONT_SIZE, CARD_TITLE_FONT, CARD_TEXT_PAD, CARD_TEXT_CLIP_PAD,
  CARD_ACCENT_HEIGHT,
  BG_COLOR, BOX_SELECT_FILL, BOX_SELECT_STROKE,
} from "./constants";

const TWO_PI = Math.PI * 2;
const HALF_HANDLE = HANDLE_SIZE / 2;

function roundRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  p.closePath();
  return p;
}

interface ScreenRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  width: number,
  height: number,
  camera: Camera,
  cards: Card[],
  selectedCardIds: Set<string>,
  boxSelect: BoxSelectState | null,
): void {
  const { x: camX, y: camY, zoom } = camera;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Dots become indistinguishable below ~4px spacing
  const spacing = DOT_SPACING * zoom;
  if (spacing > 4) {
    const offsetX = (camX * zoom) % spacing;
    const offsetY = (camY * zoom) % spacing;
    const startX = offsetX - spacing;
    const startY = offsetY - spacing;
    const dotR = DOT_RADIUS * Math.min(zoom, 1.5);

    ctx.fillStyle = DOT_COLOR;
    for (let x = startX; x < width + spacing; x += spacing) {
      ctx.beginPath();
      for (let y = startY; y < height + spacing; y += spacing) {
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, TWO_PI);
      }
      ctx.fill();
    }
  }

  const sr = CARD_RADIUS * zoom;
  const selectedRects: ScreenRect[] = [];
  const accentH = CARD_ACCENT_HEIGHT * zoom;

  for (const card of cards) {
    const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera);
    const sw = card.width * zoom;
    const sh = card.height * zoom;
    const path = roundRectPath(sx, sy, sw, sh, sr);
    const selected = selectedCardIds.has(card.id);

    if (selected) {
      selectedRects.push({ sx, sy, sw, sh });
    }

    // Fill with shadow
    ctx.save();
    ctx.shadowColor = CARD_SHADOW;
    ctx.shadowBlur = 8 * zoom;
    ctx.shadowOffsetY = 2 * zoom;
    ctx.fillStyle = CARD_BG;
    ctx.fill(path);
    ctx.restore();

    // Accent bar at top (clipped to card shape)
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = card.color;
    ctx.fillRect(sx, sy, sw, accentH);
    ctx.restore();

    // Border
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke(path);

    if (selected) {
      ctx.strokeStyle = CARD_SELECTED_BORDER;
      ctx.lineWidth = 2;
      ctx.stroke(path);
    }

    if (card.title) {
      ctx.save();
      const clipPath = roundRectPath(sx + CARD_TEXT_CLIP_PAD * zoom, sy, sw - CARD_TEXT_CLIP_PAD * 2 * zoom, sh, sr);
      ctx.clip(clipPath);
      ctx.fillStyle = card.color;
      ctx.font = `${CARD_FONT_SIZE * zoom}px ${CARD_TITLE_FONT}`;
      ctx.textBaseline = "middle";
      ctx.fillText(card.title.toUpperCase(), sx + CARD_TEXT_PAD * zoom, sy + sh / 2);
      ctx.restore();
    }
  }

  // Draw handles on top of all cards
  ctx.fillStyle = CARD_SELECTED_BORDER;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;

  for (const { sx, sy, sw, sh } of selectedRects) {
    for (const [cx, cy] of getCardCorners(sx, sy, sw, sh)) {
      const hx = cx - HALF_HANDLE;
      const hy = cy - HALF_HANDLE;
      ctx.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
    }
  }

  if (boxSelect) {
    const s = worldToScreen(boxSelect.start.x, boxSelect.start.y, camera);
    const c = worldToScreen(boxSelect.current.x, boxSelect.current.y, camera);
    const rx = Math.min(s.x, c.x);
    const ry = Math.min(s.y, c.y);
    const rw = Math.abs(c.x - s.x);
    const rh = Math.abs(c.y - s.y);
    ctx.fillStyle = BOX_SELECT_FILL;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = BOX_SELECT_STROKE;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
  }

  ctx.restore();
}
