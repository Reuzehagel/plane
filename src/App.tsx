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
const CARD_SELECTED_BORDER = "#7a7aff";

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
  const dragState = useRef<DragState | null>(null);
  const selectedCardIds = useRef<Set<string>>(new Set());
  const boxSelect = useRef<{ start: Point; current: Point } | null>(null);

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

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      ctx.strokeStyle = CARD_BORDER;
      ctx.lineWidth = 1;
      drawRoundRect(ctx, sx, sy, sw, sh, sr);
      ctx.stroke();

      if (selectedCardIds.current.has(card.id)) {
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

    if (boxSelect.current) {
      const s = worldToScreen(boxSelect.current.start.x, boxSelect.current.start.y, camera.current);
      const c = worldToScreen(boxSelect.current.current.x, boxSelect.current.current.y, camera.current);
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
  }, []);

  const scheduleRedraw = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }, [draw]);

  function removeCard(cardId: string): void {
    cards.current = cards.current.filter((c) => c.id !== cardId);
    selectedCardIds.current.delete(cardId);
  }

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
      if (dragState.current || isPanning.current) {
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
          if (e.shiftKey) {
            const sel = selectedCardIds.current;
            if (sel.has(hit.id)) sel.delete(hit.id);
            else sel.add(hit.id);
            scheduleRedraw();
          } else {
            if (!selectedCardIds.current.has(hit.id)) {
              selectedCardIds.current.clear();
              selectedCardIds.current.add(hit.id);
            }
            dragState.current = {
              offsets: cards.current
                .filter((c) => selectedCardIds.current.has(c.id))
                .map((c) => ({ card: c, offsetX: world.x - c.x, offsetY: world.y - c.y })),
            };
            // Bring selected cards to front, preserving relative order
            const rest: Card[] = [];
            const selected: Card[] = [];
            for (const c of cards.current) {
              if (selectedCardIds.current.has(c.id)) selected.push(c);
              else rest.push(c);
            }
            cards.current = [...rest, ...selected];
            scheduleRedraw();
            canvas.style.cursor = "grabbing";
          }
        } else {
          if (e.shiftKey) {
            boxSelect.current = { start: world, current: world };
          } else {
            selectedCardIds.current.clear();
            isPanning.current = true;
            lastMouse.current = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = "grabbing";
            scheduleRedraw();
          }
        }
      }
    }

    function onMouseMove(e: MouseEvent): void {
      if (!canvas) return;

      if (boxSelect.current) {
        const world = mouseToWorld(e, canvas, camera.current);
        boxSelect.current.current = world;
        scheduleRedraw();
        return;
      }

      if (dragState.current) {
        const world = mouseToWorld(e, canvas, camera.current);
        for (const entry of dragState.current.offsets) {
          entry.card.x = world.x - entry.offsetX;
          entry.card.y = world.y - entry.offsetY;
        }
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
      if (boxSelect.current) {
        const { start, current } = boxSelect.current;
        const minX = Math.min(start.x, current.x);
        const maxX = Math.max(start.x, current.x);
        const minY = Math.min(start.y, current.y);
        const maxY = Math.max(start.y, current.y);
        for (const card of cards.current) {
          if (
            card.x + card.width > minX &&
            card.x < maxX &&
            card.y + card.height > minY &&
            card.y < maxY
          ) {
            selectedCardIds.current.add(card.id);
          }
        }
        boxSelect.current = null;
        scheduleRedraw();
      }
      dragState.current = null;
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

    function onKeyDown(e: KeyboardEvent): void {
      if (editingRef.current) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedCardIds.current.size > 0) {
        for (const id of selectedCardIds.current) {
          removeCard(id);
        }
        scheduleRedraw();
      } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        selectedCardIds.current = new Set(cards.current.map((c) => c.id));
        scheduleRedraw();
        e.preventDefault();
      }
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(rafId.current);
    };
  }, [scheduleRedraw]);

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
