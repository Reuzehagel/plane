import type { BoxSelectState, Camera, Card } from "./types";
import { worldToScreen } from "./geometry";
import {
  DOT_SPACING, DOT_RADIUS, DOT_COLOR,
  CARD_RADIUS, CARD_BG, CARD_BORDER, CARD_TEXT,
  CARD_SHADOW, CARD_SELECTED_BORDER,
} from "./constants";

export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawScene(
  canvas: HTMLCanvasElement,
  camera: Camera,
  cards: Card[],
  selectedCardIds: Set<string>,
  boxSelect: BoxSelectState | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const { x: camX, y: camY, zoom } = camera;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, w, h);

  // Dots become indistinguishable below ~4px spacing
  const spacing = DOT_SPACING * zoom;
  if (spacing > 4) {
    const offsetX = (camX * zoom) % spacing;
    const offsetY = (camY * zoom) % spacing;
    const startX = offsetX - spacing;
    const startY = offsetY - spacing;

    ctx.fillStyle = DOT_COLOR;
    for (let x = startX; x < w + spacing; x += spacing) {
      for (let y = startY; y < h + spacing; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS * Math.min(zoom, 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  for (const card of cards) {
    const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera);
    const sw = card.width * zoom;
    const sh = card.height * zoom;
    const sr = CARD_RADIUS * zoom;

    ctx.shadowColor = CARD_SHADOW;
    ctx.shadowBlur = 12 * zoom;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * zoom;

    ctx.fillStyle = CARD_BG;
    drawRoundRect(ctx, sx, sy, sw, sh, sr);
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    drawRoundRect(ctx, sx, sy, sw, sh, sr);
    ctx.stroke();

    if (selectedCardIds.has(card.id)) {
      ctx.strokeStyle = CARD_SELECTED_BORDER;
      ctx.lineWidth = 2;
      drawRoundRect(ctx, sx, sy, sw, sh, sr);
      ctx.stroke();
    }

    if (card.title) {
      ctx.save();
      drawRoundRect(ctx, sx + 4 * zoom, sy, sw - 8 * zoom, sh, sr);
      ctx.clip();
      ctx.fillStyle = CARD_TEXT;
      ctx.font = `${14 * zoom}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(card.title, sx + 10 * zoom, sy + sh / 2);
      ctx.restore();
    }
  }

  if (boxSelect) {
    const s = worldToScreen(boxSelect.start.x, boxSelect.start.y, camera);
    const c = worldToScreen(boxSelect.current.x, boxSelect.current.y, camera);
    const rx = Math.min(s.x, c.x);
    const ry = Math.min(s.y, c.y);
    const rw = Math.abs(c.x - s.x);
    const rh = Math.abs(c.y - s.y);
    ctx.fillStyle = "rgba(122,122,255,0.1)";
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = "rgba(122,122,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
  }

  ctx.restore();
}
