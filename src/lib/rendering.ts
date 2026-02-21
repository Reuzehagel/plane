import type { BoxSelectState, Camera, Card, Frame } from "../types";
import { worldToScreen, getCardCorners } from "./geometry";
import {
  DOT_SPACING, DOT_RADIUS, DOT_COLOR,
  CARD_RADIUS, CARD_BG, CARD_BORDER,
  CARD_SHADOW, CARD_SELECTED_BORDER, HANDLE_SIZE,
  CARD_FONT_SIZE, CARD_TITLE_FONT, CARD_TEXT_PAD, CARD_TEXT_CLIP_PAD,
  CARD_ACCENT_HEIGHT, LINE_HEIGHT, CARD_BODY_COLOR,
  BG_COLOR, BOX_SELECT_FILL, BOX_SELECT_STROKE,
  FRAME_BORDER_COLOR, FRAME_SELECTED_BORDER, FRAME_FILL,
  FRAME_LABEL_COLOR, FRAME_LABEL_FONT_SIZE, FRAME_LABEL_OFFSET_Y,
} from "../constants";
import { wrapText } from "./textLayout";

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
  editingCardId: string | null = null,
  cardScrollOffsets: Map<string, number> = new Map(),
  frames: Frame[] = [],
  selectedFrameIds: Set<string> = new Set(),
  editingFrameId: string | null = null,
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

  // Draw frames behind cards
  for (const frame of frames) {
    const { x: fx, y: fy } = worldToScreen(frame.x, frame.y, camera);
    const fw = frame.width * zoom;
    const fh = frame.height * zoom;
    const selected = selectedFrameIds.has(frame.id);

    // Subtle fill
    ctx.fillStyle = FRAME_FILL;
    ctx.fillRect(fx, fy, fw, fh);

    // Dashed border
    ctx.save();
    ctx.setLineDash([6 * zoom, 4 * zoom]);
    ctx.strokeStyle = selected ? FRAME_SELECTED_BORDER : FRAME_BORDER_COLOR;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(fx, fy, fw, fh);
    ctx.restore();

    // Label above top-left (skip if being edited inline)
    if (frame.id !== editingFrameId) {
      const labelFontSize = FRAME_LABEL_FONT_SIZE * Math.min(zoom, 1.5);
      const labelY = fy + FRAME_LABEL_OFFSET_Y * zoom;
      ctx.font = `700 ${labelFontSize}px ${CARD_TITLE_FONT}`;
      ctx.fillStyle = selected ? FRAME_SELECTED_BORDER : FRAME_LABEL_COLOR;
      ctx.textBaseline = "bottom";
      ctx.fillText(frame.label.toUpperCase(), fx + 2 * zoom, labelY);
    }

    // Order badge in top-right corner
    const badgeSize = 18 * Math.min(zoom, 1.5);
    const badgeX = fx + fw - badgeSize - 4 * zoom;
    const badgeY = fy + 4 * zoom;
    const badgeR = 4 * Math.min(zoom, 1.5);
    const badgePath = roundRectPath(badgeX, badgeY, badgeSize, badgeSize, badgeR);
    ctx.fillStyle = selected ? "rgba(90, 138, 255, 0.2)" : "rgba(90, 138, 255, 0.08)";
    ctx.fill(badgePath);
    ctx.font = `700 ${10 * Math.min(zoom, 1.5)}px ${CARD_TITLE_FONT}`;
    ctx.fillStyle = selected ? FRAME_SELECTED_BORDER : FRAME_LABEL_COLOR;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(String(frame.order), badgeX + badgeSize / 2, badgeY + badgeSize / 2);
    ctx.textAlign = "left";
  }

  const sr = CARD_RADIUS * zoom;
  const selectedRects: ScreenRect[] = [];
  const accentH = CARD_ACCENT_HEIGHT * zoom;

  for (const card of cards) {
    const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera);
    const sw = card.width * zoom;
    const sh = card.height * zoom;
    const path = roundRectPath(sx, sy, sw, sh, sr);

    // Shadow + fill (drawn even for the editing card so it remains visible behind the editor overlay)
    ctx.save();
    ctx.shadowColor = CARD_SHADOW;
    ctx.shadowBlur = 8 * zoom;
    ctx.shadowOffsetY = 2 * zoom;
    ctx.fillStyle = CARD_BG;
    ctx.fill(path);
    ctx.restore();

    // The editing card's visuals (accent, border, text) are hidden behind the DOM editor overlay
    if (card.id === editingCardId) continue;

    const selected = selectedCardIds.has(card.id);
    if (selected) {
      selectedRects.push({ sx, sy, sw, sh });
    }

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

    if (card.text) {
      ctx.save();
      const clipPath = roundRectPath(sx + CARD_TEXT_CLIP_PAD * zoom, sy, sw - CARD_TEXT_CLIP_PAD * 2 * zoom, sh, sr);
      ctx.clip(clipPath);
      ctx.font = `${CARD_FONT_SIZE * zoom}px ${CARD_TITLE_FONT}`;
      ctx.textBaseline = "top";

      const textMaxWidth = (card.width - CARD_TEXT_PAD * 2) * zoom;
      const lines = wrapText(ctx, card.text, textMaxWidth);
      const textPad = CARD_TEXT_PAD * zoom;
      const lineH = LINE_HEIGHT * zoom;
      const textX = sx + textPad;
      let truncatedBottom = false;
      let truncatedTop = false;

      const totalTextH = lines.length * lineH;
      const visibleTextH = sh - accentH - textPad * 2;
      const overflows = lines.length > 1 && totalTextH > visibleTextH;
      const scrollPx = (cardScrollOffsets.get(card.id) ?? 0) * zoom;

      if (lines.length === 1) {
        // Single line: vertically centered, uppercase, accent color
        ctx.fillStyle = card.color;
        ctx.textBaseline = "middle";
        ctx.fillText(lines[0].text.toUpperCase(), textX, sy + sh / 2);
      } else {
        const textStartY = sy + accentH + textPad - scrollPx;
        const topLimit = sy + accentH;
        const bottomLimit = sy + sh - textPad;
        for (let i = 0; i < lines.length; i++) {
          const lineY = textStartY + i * lineH;
          if (lineY + lineH < topLimit) {
            truncatedTop = true;
            continue;
          }
          if (lineY + lineH > bottomLimit + lineH * 0.5) {
            truncatedBottom = true;
            break;
          }
          const line = lines[i];
          ctx.fillStyle = line.isHeader ? card.color : CARD_BODY_COLOR;
          ctx.fillText(line.isHeader ? line.text.toUpperCase() : line.text, textX, lineY);
        }
      }
      ctx.restore();

      if (overflows) {
        ctx.save();
        ctx.clip(path);

        // Fade gradient at bottom
        if (truncatedBottom) {
          const fadeH = lineH * 2;
          const fadeY = sy + sh - fadeH;
          const fadeGrad = ctx.createLinearGradient(0, fadeY, 0, sy + sh);
          fadeGrad.addColorStop(0, "rgba(20, 20, 20, 0)");
          fadeGrad.addColorStop(1, CARD_BG);
          ctx.fillStyle = fadeGrad;
          ctx.fillRect(sx, fadeY, sw, fadeH);
        }

        // Fade gradient at top (when scrolled down)
        if (truncatedTop) {
          const fadeH = lineH * 1.5;
          const fadeY = sy + accentH;
          const fadeGrad = ctx.createLinearGradient(0, fadeY, 0, fadeY + fadeH);
          fadeGrad.addColorStop(0, CARD_BG);
          fadeGrad.addColorStop(1, "rgba(20, 20, 20, 0)");
          ctx.fillStyle = fadeGrad;
          ctx.fillRect(sx, fadeY, sw, fadeH);
        }

        // Scrollbar indicator
        const barW = Math.max(2, 3 * zoom);
        const barPad = 4 * zoom;
        const barX = sx + sw - barW - barPad;
        const trackTop = sy + accentH + textPad;
        const trackH = sh - accentH - textPad * 2;
        const visibleRatio = Math.min(1, visibleTextH / totalTextH);
        const thumbH = Math.max(8 * zoom, trackH * visibleRatio);

        const maxScrollWorld = (totalTextH - visibleTextH) / zoom;
        const scrollOffset = cardScrollOffsets.get(card.id) ?? 0;
        const scrollRatio = maxScrollWorld > 0 ? Math.min(1, scrollOffset / maxScrollWorld) : 0;
        const thumbY = trackTop + scrollRatio * (trackH - thumbH);

        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fillRect(barX, trackTop, barW, trackH);

        ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        ctx.fillRect(barX, thumbY, barW, thumbH);

        ctx.restore();
      }
    }
  }

  // Draw card handles on top of all cards
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

  // Draw frame handles after card handles
  for (const frame of frames) {
    if (!selectedFrameIds.has(frame.id)) continue;
    const { x: fx, y: fy } = worldToScreen(frame.x, frame.y, camera);
    const fw = frame.width * zoom;
    const fh = frame.height * zoom;
    const corners = getCardCorners(fx, fy, fw, fh);

    ctx.fillStyle = FRAME_SELECTED_BORDER;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (const [cx, cy] of corners) {
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
