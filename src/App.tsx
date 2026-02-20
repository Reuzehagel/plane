import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, HandleCorner, History, Point, ResizeState, Snapshot } from "./types";
import { mouseToScreen, mouseToWorld, hitTestCards, hitTestHandles, worldToScreen } from "./geometry";
import { drawScene } from "./rendering";
import { pushSnapshot, undo, redo } from "./history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS, NUDGE_AMOUNT,
  CARD_MIN_WIDTH, CARD_MIN_HEIGHT, CARD_MAX_WIDTH, CARD_MAX_HEIGHT,
  CARD_FONT_SIZE, CARD_TEXT_PAD,
} from "./constants";

// Pairs useState with a ref that stays in sync, so imperative event handlers
// can always read the latest value without stale closures.
function useRefState<T>(initial: T): [T, React.RefObject<T>, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const ref = useRef<T>(initial);
  useEffect(() => { ref.current = state; }, [state]);
  return [state, ref, setState];
}

// Resize-direction multipliers: [dx sign for width, dy sign for height, moves X origin, moves Y origin]
const RESIZE_DIR: Record<HandleCorner, { wSign: number; hSign: number; movesX: boolean; movesY: boolean }> = {
  se: { wSign:  1, hSign:  1, movesX: false, movesY: false },
  sw: { wSign: -1, hSign:  1, movesX: true,  movesY: false },
  ne: { wSign:  1, hSign: -1, movesX: false, movesY: true  },
  nw: { wSign: -1, hSign: -1, movesX: true,  movesY: true  },
};

function App(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const isPanning = useRef(false);
  const lastMouse = useRef<Point>({ x: 0, y: 0 });
  const rafId = useRef<number>(0);

  const cards = useRef<Card[]>([]);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const selectedCardIds = useRef<Set<string>>(new Set());
  const boxSelect = useRef<BoxSelectState | null>(null);

  const history = useRef<History>({ undoStack: [], redoStack: [] });

  const [editing, editingRef, setEditing] = useRefState<EditingState | null>(null);
  const [contextMenu, contextMenuRef, setContextMenu] = useRefState<ContextMenuState | null>(null);
  const clipboard = useRef<Card | null>(null);

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

  function createCard(x: number, y: number, width: number, height: number, title: string): Card {
    return { id: crypto.randomUUID(), x, y, width, height, title };
  }

  function insertCard(card: Card): void {
    cards.current.push(card);
    selectCard(card.id);
  }

  function findCard(cardId: string): Card | undefined {
    return cards.current.find((c) => c.id === cardId);
  }

  function selectCard(cardId: string): void {
    selectedCardIds.current.clear();
    selectedCardIds.current.add(cardId);
  }

  function selectAllCards(): void {
    selectedCardIds.current = new Set(cards.current.map((c) => c.id));
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

  // Returns the card targeted by the context menu, or null if missing
  function getMenuCard(): Card | undefined {
    if (!contextMenu?.cardId) return undefined;
    return findCard(contextMenu.cardId);
  }

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

    function handleCursor(handle: HandleCorner): string {
      return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
    }

    function updateCursor(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;
      if (resizeState.current) {
        canvas.style.cursor = handleCursor(resizeState.current.handle);
        return;
      }
      if (dragState.current || isPanning.current) {
        canvas.style.cursor = "grabbing";
        return;
      }
      const { x: sx, y: sy } = mouseToScreen(e, canvas);
      const handleHit = hitTestHandles(sx, sy, cards.current, selectedCardIds.current, camera.current);
      if (handleHit) {
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }
      const world = mouseToWorld(e, canvas, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);
      canvas.style.cursor = hit ? "default" : "grab";
    }

    function onContextMenu(e: MouseEvent): void {
      e.preventDefault();
      if (!canvas || editingRef.current) return;
      const world = mouseToWorld(e, canvas, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);

      if (hit && !selectedCardIds.current.has(hit.id)) {
        selectCard(hit.id);
        scheduleRedraw();
      }

      setContextMenu({
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: world.x,
        worldY: world.y,
        cardId: hit ? hit.id : null,
      });
    }

    function startPanning(e: MouseEvent): void {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      canvas!.style.cursor = "grabbing";
    }

    function onMouseDown(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;

      if (contextMenuRef.current) {
        setContextMenu(null);
        return;
      }

      // Middle-click always pans
      if (e.button === 1) {
        startPanning(e);
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      const { x: sx, y: sy } = mouseToScreen(e, canvas);
      const handleHit = hitTestHandles(sx, sy, cards.current, selectedCardIds.current, camera.current);
      if (handleHit) {
        saveSnapshot();
        resizeState.current = {
          card: handleHit.card,
          handle: handleHit.handle,
          startMouseX: sx,
          startMouseY: sy,
          startX: handleHit.card.x,
          startY: handleHit.card.y,
          startWidth: handleHit.card.width,
          startHeight: handleHit.card.height,
        };
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }

      const world = mouseToWorld(e, canvas, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);

      if (!hit) {
        if (e.shiftKey) {
          boxSelect.current = { start: world, current: world };
        } else {
          selectedCardIds.current.clear();
          startPanning(e);
          scheduleRedraw();
        }
        return;
      }

      if (e.shiftKey) {
        const sel = selectedCardIds.current;
        if (sel.has(hit.id)) sel.delete(hit.id);
        else sel.add(hit.id);
        scheduleRedraw();
        return;
      }

      if (!selectedCardIds.current.has(hit.id)) {
        selectCard(hit.id);
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

    function onMouseMove(e: MouseEvent): void {
      if (!canvas) return;

      if (resizeState.current) {
        const { x: sx, y: sy } = mouseToScreen(e, canvas);
        const rs = resizeState.current;
        const dx = (sx - rs.startMouseX) / camera.current.zoom;
        const dy = (sy - rs.startMouseY) / camera.current.zoom;

        const dir = RESIZE_DIR[rs.handle];
        const newW = rs.startWidth + dx * dir.wSign;
        const newH = rs.startHeight + dy * dir.hSign;
        const clampedW = Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, newW));
        const clampedH = Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, newH));

        if (dir.movesX) rs.card.x = rs.startX + dx + (newW - clampedW);
        if (dir.movesY) rs.card.y = rs.startY + dy + (newH - clampedH);
        rs.card.width = clampedW;
        rs.card.height = clampedH;
        scheduleRedraw();
        return;
      }

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
      resizeState.current = null;
      dragState.current = null;
      isPanning.current = false;
      updateCursor(e);
    }

    function onDblClick(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;
      const world = mouseToWorld(e, canvas, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);

      if (hit) {
        openEditor(hit);
        return;
      }

      const newCard = createCard(world.x - CARD_WIDTH / 2, world.y - CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, "");
      saveSnapshot();
      cards.current.push(newCard);
      scheduleRedraw();
      // Delay so the canvas redraws before positioning the editor overlay
      requestAnimationFrame(() => openEditor(newCard));
    }

    function onWheel(e: WheelEvent): void {
      if (!canvas || editingRef.current) return;
      e.preventDefault();
      if (contextMenuRef.current) setContextMenu(null);

      const { zoom } = camera.current;
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));

      const { x: mx, y: my } = mouseToScreen(e, canvas);

      camera.current.x += mx / newZoom - mx / zoom;
      camera.current.y += my / newZoom - my / zoom;
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
      if (contextMenuRef.current) {
        if (e.key === "Escape") setContextMenu(null);
        return;
      }
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
        selectAllCards();
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
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(rafId.current);
    };
  }, [scheduleRedraw]);

  function commitEdit(value: string): void {
    if (!editing) return;
    const card = findCard(editing.cardId);
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
    const card = findCard(editing.cardId);
    if (card && card.title === "") {
      removeCard(editing.cardId);
      scheduleRedraw();
    }
    setEditing(null);
  }

  function handleMenuEdit(): void {
    const card = getMenuCard();
    if (!card) return;
    setContextMenu(null);
    openEditor(card);
  }

  function handleMenuDuplicate(): void {
    const card = getMenuCard();
    if (!card) return;
    saveSnapshot();
    const clone = createCard(card.x + 20, card.y + 20, card.width, card.height, card.title);
    insertCard(clone);
    setContextMenu(null);
    scheduleRedraw();
  }

  function handleMenuCopy(): void {
    const card = getMenuCard();
    if (!card) return;
    clipboard.current = { ...card };
    setContextMenu(null);
  }

  function handleMenuResetSize(): void {
    const card = getMenuCard();
    if (!card) return;
    saveSnapshot();
    card.width = CARD_WIDTH;
    card.height = CARD_HEIGHT;
    setContextMenu(null);
    scheduleRedraw();
  }

  function handleMenuDelete(): void {
    if (!contextMenu?.cardId) return;
    saveSnapshot();
    if (selectedCardIds.current.has(contextMenu.cardId)) {
      for (const id of selectedCardIds.current) {
        removeCard(id);
      }
    } else {
      removeCard(contextMenu.cardId);
    }
    setContextMenu(null);
    scheduleRedraw();
  }

  function handleMenuPaste(): void {
    if (!contextMenu || !clipboard.current) return;
    saveSnapshot();
    const src = clipboard.current;
    const newCard = createCard(
      contextMenu.worldX - src.width / 2,
      contextMenu.worldY - src.height / 2,
      src.width, src.height, src.title,
    );
    insertCard(newCard);
    setContextMenu(null);
    scheduleRedraw();
  }

  function handleMenuNewCard(): void {
    if (!contextMenu) return;
    saveSnapshot();
    const cardX = contextMenu.worldX - CARD_WIDTH / 2;
    const cardY = contextMenu.worldY - CARD_HEIGHT / 2;
    const newCard = createCard(cardX, cardY, CARD_WIDTH, CARD_HEIGHT, "");
    insertCard(newCard);
    setContextMenu(null);
    scheduleRedraw();
    requestAnimationFrame(() => openEditor(newCard));
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
            fontSize: CARD_FONT_SIZE * camera.current.zoom,
            borderRadius: CARD_RADIUS * camera.current.zoom,
            padding: `0 ${CARD_TEXT_PAD * camera.current.zoom}px`,
          }}
          autoFocus
          defaultValue={findCard(editing.cardId)?.title ?? ""}
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
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
        >
          {contextMenu.cardId ? (
            <>
              <div className="context-menu-item" onClick={handleMenuEdit}>Edit</div>
              <div className="context-menu-item" onClick={handleMenuDuplicate}>Duplicate</div>
              <div className="context-menu-item" onClick={handleMenuCopy}>Copy</div>
              <div className="context-menu-item" onClick={handleMenuResetSize}>Reset Size</div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={handleMenuDelete}>Delete</div>
            </>
          ) : (
            <>
              <div
                className={`context-menu-item${clipboard.current ? "" : " disabled"}`}
                onClick={handleMenuPaste}
              >
                Paste
              </div>
              <div className="context-menu-item" onClick={handleMenuNewCard}>New Card</div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default App;
