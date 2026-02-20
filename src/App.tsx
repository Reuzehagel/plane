import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, DragState, EditingState, History, Point, Snapshot } from "./types";
import { mouseToWorld, hitTestCards, worldToScreen } from "./geometry";
import { drawScene } from "./rendering";
import { pushSnapshot, undo, redo } from "./history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS, NUDGE_AMOUNT,
} from "./constants";

function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const isPanning = useRef(false);
  const lastMouse = useRef<Point>({ x: 0, y: 0 });
  const rafId = useRef<number>(0);

  const cards = useRef<Card[]>([]);
  const dragState = useRef<DragState | null>(null);
  const selectedCardIds = useRef<Set<string>>(new Set());
  const boxSelect = useRef<BoxSelectState | null>(null);

  const history = useRef<History>({ undoStack: [], redoStack: [] });

  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef<EditingState | null>(null);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawScene(canvas, camera.current, cards.current, selectedCardIds.current, boxSelect.current);
  }, []);

  const scheduleRedraw = useCallback((): void => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }, [draw]);

  function saveSnapshot(): void {
    pushSnapshot(history.current, cards.current, selectedCardIds.current);
  }

  function applySnapshot(snapshot: Snapshot): void {
    cards.current = snapshot.cards;
    selectedCardIds.current = snapshot.selectedCardIds;
    scheduleRedraw();
  }

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
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
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

      // Middle-click always pans
      if (e.button === 1) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        const world = mouseToWorld(e, canvas, camera.current);
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
            saveSnapshot();
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

      const newCard: Card = {
        id: crypto.randomUUID(),
        x: world.x - CARD_WIDTH / 2,
        y: world.y - CARD_HEIGHT / 2,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        title: "",
      };
      saveSnapshot();
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

    function nudgeOffset(key: string): Point | null {
      switch (key) {
        case "ArrowLeft":  return { x: -NUDGE_AMOUNT, y: 0 };
        case "ArrowRight": return { x:  NUDGE_AMOUNT, y: 0 };
        case "ArrowUp":    return { x: 0, y: -NUDGE_AMOUNT };
        case "ArrowDown":  return { x: 0, y:  NUDGE_AMOUNT };
        default:           return null;
      }
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (editingRef.current) return;

      const mod = e.ctrlKey || e.metaKey;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedCardIds.current.size > 0) {
        saveSnapshot();
        for (const id of selectedCardIds.current) {
          removeCard(id);
        }
        scheduleRedraw();
        return;
      }

      if (e.key === "a" && mod) {
        selectedCardIds.current = new Set(cards.current.map((c) => c.id));
        scheduleRedraw();
        e.preventDefault();
        return;
      }

      if (e.key === "z" && mod && !e.shiftKey) {
        const snapshot = undo(history.current, cards.current, selectedCardIds.current);
        if (snapshot) applySnapshot(snapshot);
        e.preventDefault();
        return;
      }

      if ((e.key === "z" && mod && e.shiftKey) || (e.key === "y" && mod)) {
        const snapshot = redo(history.current, cards.current, selectedCardIds.current);
        if (snapshot) applySnapshot(snapshot);
        e.preventDefault();
        return;
      }

      const offset = nudgeOffset(e.key);
      if (offset && selectedCardIds.current.size > 0) {
        saveSnapshot();
        for (const card of cards.current) {
          if (selectedCardIds.current.has(card.id)) {
            card.x += offset.x;
            card.y += offset.y;
          }
        }
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
        if (card.title !== value) saveSnapshot();
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
