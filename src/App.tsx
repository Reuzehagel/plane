import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, HandleCorner, History, Point, ResizeState, ResizeTarget, Snapshot } from "./types";
import { mouseToScreen, mouseToWorld, hitTestCards, hitTestHandles, worldToScreen, snapToGrid, snapPoint, lerpSnap } from "./geometry";
import { drawScene } from "./rendering";
import { pushSnapshot } from "./history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS,
  CARD_MIN_WIDTH, CARD_MIN_HEIGHT, CARD_MAX_WIDTH, CARD_MAX_HEIGHT,
  CARD_FONT_SIZE, CARD_TEXT_PAD,
} from "./constants";
import { useKeyboard } from "./useKeyboard";
import { createMenuHandlers } from "./menuHandlers";

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
  const dragSnapTargets = useRef<Map<string, Point>>(new Map());
  const dragRafId = useRef<number>(0);
  const resizeTarget = useRef<ResizeTarget | null>(null);
  const resizeRafId = useRef<number>(0);

  const history = useRef<History>({ undoStack: [], redoStack: [] });

  const [editing, editingRef, setEditing] = useRefState<EditingState | null>(null);
  const [contextMenu, contextMenuRef, setContextMenu] = useRefState<ContextMenuState | null>(null);
  const clipboard = useRef<Card | null>(null);

  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!ctxRef.current) ctxRef.current = canvas.getContext("2d");
    if (!ctxRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    drawScene(ctxRef.current, dpr, canvas.width / dpr, canvas.height / dpr, camera.current, cards.current, selectedCardIds.current, boxSelect.current);
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

  function deleteSelectedCards(): void {
    cards.current = cards.current.filter((card) => !selectedCardIds.current.has(card.id));
    selectedCardIds.current.clear();
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

  function createAndStartEditingCardAt(worldX: number, worldY: number): void {
    const snap = snapPoint(worldX - CARD_WIDTH / 2, worldY - CARD_HEIGHT / 2);
    const newCard = createCard(snap.x, snap.y, CARD_WIDTH, CARD_HEIGHT, "");
    saveSnapshot();
    insertCard(newCard);
    scheduleRedraw();
    requestAnimationFrame(() => openEditor(newCard));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let canvasRect = canvas.getBoundingClientRect();

    function animateDrag(): void {
      if (!dragState.current) return;
      for (const entry of dragState.current.offsets) {
        const target = dragSnapTargets.current.get(entry.card.id);
        if (!target) continue;
        entry.card.x = lerpSnap(entry.card.x, target.x);
        entry.card.y = lerpSnap(entry.card.y, target.y);
      }
      draw();
      dragRafId.current = requestAnimationFrame(animateDrag);
    }

    function animateResize(): void {
      if (!resizeState.current) return;
      const t = resizeTarget.current;
      if (t) {
        const card = resizeState.current.card;
        card.x = lerpSnap(card.x, t.x);
        card.y = lerpSnap(card.y, t.y);
        card.width = lerpSnap(card.width, t.w);
        card.height = lerpSnap(card.height, t.h);
        draw();
      }
      resizeRafId.current = requestAnimationFrame(animateResize);
    }

    function resize(): void {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      canvasRect = canvas.getBoundingClientRect();
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
      const { x: sx, y: sy } = mouseToScreen(e, canvasRect);
      const handleHit = hitTestHandles(sx, sy, cards.current, selectedCardIds.current, camera.current);
      if (handleHit) {
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }
      const world = mouseToWorld(e, canvasRect, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);
      canvas.style.cursor = hit ? "default" : "grab";
    }

    function onContextMenu(e: MouseEvent): void {
      e.preventDefault();
      if (!canvas || editingRef.current) return;
      const world = mouseToWorld(e, canvasRect, camera.current);
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
      if (!canvas) return;
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
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

      const { x: sx, y: sy } = mouseToScreen(e, canvasRect);
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
        resizeRafId.current = requestAnimationFrame(animateResize);
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }

      const world = mouseToWorld(e, canvasRect, camera.current);
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
      const offsets: DragState["offsets"] = [];
      const rest: Card[] = [];
      const selected: Card[] = [];
      for (const c of cards.current) {
        if (selectedCardIds.current.has(c.id)) {
          selected.push(c);
          offsets.push({ card: c, offsetX: world.x - c.x, offsetY: world.y - c.y });
        } else {
          rest.push(c);
        }
      }
      dragState.current = { offsets };
      cards.current = [...rest, ...selected];
      dragRafId.current = requestAnimationFrame(animateDrag);
      scheduleRedraw();
      canvas.style.cursor = "grabbing";
    }

    function onMouseMove(e: MouseEvent): void {
      if (!canvas) return;

      if (resizeState.current) {
        const { x: sx, y: sy } = mouseToScreen(e, canvasRect);
        const rs = resizeState.current;
        const dx = (sx - rs.startMouseX) / camera.current.zoom;
        const dy = (sy - rs.startMouseY) / camera.current.zoom;

        const dir = RESIZE_DIR[rs.handle];
        const newW = rs.startWidth + dx * dir.wSign;
        const newH = rs.startHeight + dy * dir.hSign;
        const clampedW = Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, snapToGrid(newW)));
        const clampedH = Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, snapToGrid(newH)));

        const targetX = dir.movesX ? rs.startX + (rs.startWidth - clampedW) : rs.startX;
        const targetY = dir.movesY ? rs.startY + (rs.startHeight - clampedH) : rs.startY;
        resizeTarget.current = { x: targetX, y: targetY, w: clampedW, h: clampedH };
        return;
      }

      if (boxSelect.current) {
        const world = mouseToWorld(e, canvasRect, camera.current);
        boxSelect.current.current = world;
        scheduleRedraw();
        return;
      }

      if (dragState.current) {
        const world = mouseToWorld(e, canvasRect, camera.current);
        for (const entry of dragState.current.offsets) {
          dragSnapTargets.current.set(entry.card.id, snapPoint(world.x - entry.offsetX, world.y - entry.offsetY));
        }
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
      if (e.button !== 0 && e.button !== 1) return;
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
      if (dragState.current) {
        cancelAnimationFrame(dragRafId.current);
        for (const entry of dragState.current.offsets) {
          const target = dragSnapTargets.current.get(entry.card.id)
            ?? snapPoint(entry.card.x, entry.card.y);
          entry.card.x = target.x;
          entry.card.y = target.y;
        }
        dragSnapTargets.current.clear();
        scheduleRedraw();
      }
      if (resizeState.current) {
        cancelAnimationFrame(resizeRafId.current);
        const t = resizeTarget.current;
        if (t) {
          const card = resizeState.current.card;
          card.x = t.x;
          card.y = t.y;
          card.width = t.w;
          card.height = t.h;
          resizeTarget.current = null;
        }
        scheduleRedraw();
      }
      resizeState.current = null;
      dragState.current = null;
      isPanning.current = false;
      updateCursor(e);
    }

    function onDblClick(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;
      const world = mouseToWorld(e, canvasRect, camera.current);
      const hit = hitTestCards(world.x, world.y, cards.current);

      if (hit) {
        openEditor(hit);
        return;
      }

      createAndStartEditingCardAt(world.x, world.y);
    }

    function onWheel(e: WheelEvent): void {
      if (!canvas || editingRef.current) return;
      e.preventDefault();
      if (contextMenuRef.current) setContextMenu(null);

      const { zoom } = camera.current;
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));

      const { x: mx, y: my } = mouseToScreen(e, canvasRect);

      camera.current.x += mx / newZoom - mx / zoom;
      camera.current.y += my / newZoom - my / zoom;
      camera.current.zoom = newZoom;

      scheduleRedraw();
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseup", onMouseUp, { passive: true });
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(rafId.current);
      cancelAnimationFrame(dragRafId.current);
      cancelAnimationFrame(resizeRafId.current);
    };
  }, [scheduleRedraw]);

  function commitEdit(value: string): void {
    if (!editing) return;
    const card = findCard(editing.cardId);
    if (card) {
      if (value.trim() === "" && card.title === "") {
        saveSnapshot();
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
      saveSnapshot();
      removeCard(editing.cardId);
      scheduleRedraw();
    }
    setEditing(null);
  }

  useKeyboard({
    contextMenuRef, editingRef, selectedCardIds, cards, history,
    setContextMenu, saveSnapshot, deleteSelectedCards,
    selectAllCards, applySnapshot, scheduleRedraw,
  });

  const {
    handleMenuEdit, handleMenuDuplicate, handleMenuCopy,
    handleMenuResetSize, handleMenuDelete, handleMenuPaste, handleMenuNewCard,
  } = createMenuHandlers({
    contextMenu, selectedCardIds, clipboard,
    findCard, removeCard, deleteSelectedCards, createCard, insertCard, openEditor,
    createAndStartEditingCardAt,
    saveSnapshot, setContextMenu, scheduleRedraw,
  });

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
