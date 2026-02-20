import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { Camera, Card, DragState, EditingState, Point } from "./types";

const DOT_SPACING = 24;
const DOT_RADIUS = 1;
const DOT_COLOR = "rgba(255, 255, 255, 0.15)";
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.001;

const CARD_WIDTH = 180;
const CARD_HEIGHT = 48;
const CARD_RADIUS = 8;
const CARD_BG = "#23233a";
const CARD_BORDER = "#3a3a5c";
const CARD_TEXT = "#e0e0e0";
const CARD_SHADOW = "rgba(0, 0, 0, 0.4)";

function screenToWorld(sx: number, sy: number, cam: Camera): Point {
  return {
    x: sx / cam.zoom - cam.x,
    y: sy / cam.zoom - cam.y,
  };
}

function worldToScreen(wx: number, wy: number, cam: Camera): Point {
  return {
    x: (wx + cam.x) * cam.zoom,
    y: (wy + cam.y) * cam.zoom,
  };
}

function hitTestCards(wx: number, wy: number, cards: Card[]): Card | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (wx >= c.x && wx <= c.x + c.width && wy >= c.y && wy <= c.y + c.height) {
      return c;
    }
  }
  return null;
}

function drawRoundRect(
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

/** Convert a mouse event to world coordinates relative to the canvas. */
function mouseToWorld(e: MouseEvent, canvas: HTMLCanvasElement, cam: Camera): Point {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(e.clientX - rect.left, e.clientY - rect.top, cam);
}

function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const isPanning = useRef(false);
  const lastMouse = useRef<Point>({ x: 0, y: 0 });
  const rafId = useRef<number>(0);

  const cards = useRef<Card[]>([]);
  const draggingCard = useRef<DragState | null>(null);

  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef<EditingState | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { x: camX, y: camY, zoom } = camera.current;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // Draw dot grid (hidden when zoomed out too far)
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

    for (const card of cards.current) {
      const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera.current);
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

      // Reset shadow before drawing border and text
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      ctx.strokeStyle = CARD_BORDER;
      ctx.lineWidth = 1;
      drawRoundRect(ctx, sx, sy, sw, sh, sr);
      ctx.stroke();

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

    ctx.restore();
  }, []);

  const scheduleRedraw = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }, [draw]);

  // Keep editingRef in sync with state so imperative event handlers can read it
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize(): void {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      scheduleRedraw();
    }

    function updateCursor(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;
      if (draggingCard.current || isPanning.current) {
        canvas.style.cursor = "grabbing";
        return;
      }
      const world = mouseToWorld(e, canvas, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);
      canvas.style.cursor = hit ? "default" : "grab";
    }

    function onMouseDown(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;
      const world = mouseToWorld(e, canvas, camera.current);

      // Middle-click always pans
      if (e.button === 1) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        const hit = hitTestCards(world.x, world.y, cards.current);
        if (hit) {
          draggingCard.current = {
            card: hit,
            offsetX: world.x - hit.x,
            offsetY: world.y - hit.y,
          };
          // Bring dragged card to front
          const idx = cards.current.indexOf(hit);
          if (idx !== -1 && idx !== cards.current.length - 1) {
            cards.current.splice(idx, 1);
            cards.current.push(hit);
            scheduleRedraw();
          }
          canvas.style.cursor = "grabbing";
        } else {
          isPanning.current = true;
          lastMouse.current = { x: e.clientX, y: e.clientY };
          canvas.style.cursor = "grabbing";
        }
      }
    }

    function onMouseMove(e: MouseEvent): void {
      if (!canvas) return;

      if (draggingCard.current) {
        const world = mouseToWorld(e, canvas, camera.current);
        draggingCard.current.card.x = world.x - draggingCard.current.offsetX;
        draggingCard.current.card.y = world.y - draggingCard.current.offsetY;
        scheduleRedraw();
        return;
      }

      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        camera.current.x += dx / camera.current.zoom;
        camera.current.y += dy / camera.current.zoom;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        scheduleRedraw();
        return;
      }

      updateCursor(e);
    }

    function onMouseUp(e: MouseEvent): void {
      draggingCard.current = null;
      isPanning.current = false;
      updateCursor(e);
    }

    function openEditor(card: Card): void {
      const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera.current);
      const zoom = camera.current.zoom;
      setEditing({
        cardId: card.id,
        screenX: sx,
        screenY: sy,
        screenWidth: card.width * zoom,
        screenHeight: card.height * zoom,
      });
    }

    function onDblClick(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;
      const world = mouseToWorld(e, canvas, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);

      if (hit) {
        openEditor(hit);
        return;
      }

      // Create new card centered on cursor
      const newCard: Card = {
        id: crypto.randomUUID(),
        x: world.x - CARD_WIDTH / 2,
        y: world.y - CARD_HEIGHT / 2,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        title: "",
      };
      cards.current.push(newCard);
      scheduleRedraw();
      // Delay so the canvas redraws before positioning the editor overlay
      requestAnimationFrame(() => openEditor(newCard));
    }

    function onWheel(e: WheelEvent): void {
      if (!canvas || editingRef.current) return;
      e.preventDefault();

      const { zoom } = camera.current;
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      camera.current.x += mouseX / newZoom - mouseX / zoom;
      camera.current.y += mouseY / newZoom - mouseY / zoom;
      camera.current.zoom = newZoom;

      scheduleRedraw();
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(rafId.current);
    };
  }, [scheduleRedraw]);

  function removeCard(cardId: string): void {
    cards.current = cards.current.filter((c) => c.id !== cardId);
  }

  function commitEdit(value: string): void {
    if (!editing) return;
    const card = cards.current.find((c) => c.id === editing.cardId);
    if (card) {
      if (value.trim() === "" && card.title === "") {
        removeCard(editing.cardId);
      } else {
        card.title = value;
      }
    }
    setEditing(null);
    scheduleRedraw();
  }

  function cancelEdit(): void {
    if (!editing) return;
    const card = cards.current.find((c) => c.id === editing.cardId);
    if (card && card.title === "") {
      removeCard(editing.cardId);
      scheduleRedraw();
    }
    setEditing(null);
  }

  return (
    <>
      <canvas ref={canvasRef} />
      {editing && (
        <input
          className="card-editor"
          style={{
            left: editing.screenX,
            top: editing.screenY,
            width: editing.screenWidth,
            height: editing.screenHeight,
            fontSize: 14 * camera.current.zoom,
            borderRadius: CARD_RADIUS * camera.current.zoom,
            padding: `0 ${10 * camera.current.zoom}px`,
          }}
          autoFocus
          defaultValue={
            cards.current.find((c) => c.id === editing.cardId)?.title ?? ""
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitEdit(e.currentTarget.value);
            } else if (e.key === "Escape") {
              cancelEdit();
            }
          }}
          onBlur={(e) => commitEdit(e.currentTarget.value)}
        />
      )}
    </>
  );
}

export default App;
