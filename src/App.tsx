import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, HandleCorner, History, Point, ResizeState, Snapshot } from "./types";
import { mouseToWorld, hitTestCards, hitTestHandles, worldToScreen } from "./geometry";
import { drawScene } from "./rendering";
import { pushSnapshot, undo, redo } from "./history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS, NUDGE_AMOUNT,
  CARD_MIN_WIDTH, CARD_MIN_HEIGHT, CARD_MAX_WIDTH, CARD_MAX_HEIGHT,
} from "./constants";

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

  const [editing, setEditing] = useState<EditingState | null>(null);
  const editingRef = useRef<EditingState | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<ContextMenuState | null>(null);
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

  // Keep refs in sync with state so imperative event handlers can read them
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    contextMenuRef.current = contextMenu;
  }, [contextMenu]);

  function closeContextMenu(): void {
    setContextMenu(null);
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
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
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
        selectedCardIds.current.clear();
        selectedCardIds.current.add(hit.id);
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

    function onMouseDown(e: MouseEvent): void {
      if (!canvas || editingRef.current) return;

      if (contextMenuRef.current) {
        setContextMenu(null);
        return;
      }

      // Middle-click always pans
      if (e.button === 1) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        // Check handle hit before card hit
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
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

      if (resizeState.current) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const rs = resizeState.current;
        const dx = (sx - rs.startMouseX) / camera.current.zoom;
        const dy = (sy - rs.startMouseY) / camera.current.zoom;

        let newX = rs.startX;
        let newY = rs.startY;
        let newW = rs.startWidth;
        let newH = rs.startHeight;

        if (rs.handle === "se") {
          newW = rs.startWidth + dx;
          newH = rs.startHeight + dy;
        } else if (rs.handle === "sw") {
          newW = rs.startWidth - dx;
          newH = rs.startHeight + dy;
          newX = rs.startX + dx;
        } else if (rs.handle === "ne") {
          newW = rs.startWidth + dx;
          newH = rs.startHeight - dy;
          newY = rs.startY + dy;
        } else if (rs.handle === "nw") {
          newW = rs.startWidth - dx;
          newH = rs.startHeight - dy;
          newX = rs.startX + dx;
          newY = rs.startY + dy;
        }

        // Clamp and fix position for corners that move origin
        const clampedW = Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, newW));
        const clampedH = Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, newH));

        if (rs.handle === "sw" || rs.handle === "nw") {
          rs.card.x = newX + (newW - clampedW);
        }
        if (rs.handle === "ne" || rs.handle === "nw") {
          rs.card.y = newY + (newH - clampedH);
        }

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
      if (contextMenuRef.current) setContextMenu(null);

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

  function handleMenuEdit(): void {
    if (!contextMenu?.cardId) return;
    const card = cards.current.find((c) => c.id === contextMenu.cardId);
    if (!card) return;
    const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera.current);
    const zoom = camera.current.zoom;
    closeContextMenu();
    setEditing({
      cardId: card.id,
      screenX: sx,
      screenY: sy,
      screenWidth: card.width * zoom,
      screenHeight: card.height * zoom,
    });
  }

  function handleMenuDuplicate(): void {
    if (!contextMenu?.cardId) return;
    const card = cards.current.find((c) => c.id === contextMenu.cardId);
    if (!card) return;
    saveSnapshot();
    const clone: Card = {
      id: crypto.randomUUID(),
      x: card.x + 20,
      y: card.y + 20,
      width: card.width,
      height: card.height,
      title: card.title,
    };
    cards.current.push(clone);
    selectedCardIds.current.clear();
    selectedCardIds.current.add(clone.id);
    closeContextMenu();
    scheduleRedraw();
  }

  function handleMenuCopy(): void {
    if (!contextMenu?.cardId) return;
    const card = cards.current.find((c) => c.id === contextMenu.cardId);
    if (!card) return;
    clipboard.current = { ...card };
    closeContextMenu();
  }

  function handleMenuResetSize(): void {
    if (!contextMenu?.cardId) return;
    const card = cards.current.find((c) => c.id === contextMenu.cardId);
    if (!card) return;
    saveSnapshot();
    card.width = CARD_WIDTH;
    card.height = CARD_HEIGHT;
    closeContextMenu();
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
    closeContextMenu();
    scheduleRedraw();
  }

  function handleMenuPaste(): void {
    if (!contextMenu || !clipboard.current) return;
    saveSnapshot();
    const src = clipboard.current;
    const newCard: Card = {
      id: crypto.randomUUID(),
      x: contextMenu.worldX - src.width / 2,
      y: contextMenu.worldY - src.height / 2,
      width: src.width,
      height: src.height,
      title: src.title,
    };
    cards.current.push(newCard);
    selectedCardIds.current.clear();
    selectedCardIds.current.add(newCard.id);
    closeContextMenu();
    scheduleRedraw();
  }

  function handleMenuNewCard(): void {
    if (!contextMenu) return;
    saveSnapshot();
    const newCard: Card = {
      id: crypto.randomUUID(),
      x: contextMenu.worldX - CARD_WIDTH / 2,
      y: contextMenu.worldY - CARD_HEIGHT / 2,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      title: "",
    };
    cards.current.push(newCard);
    selectedCardIds.current.clear();
    selectedCardIds.current.add(newCard.id);
    const { worldX, worldY } = contextMenu;
    closeContextMenu();
    scheduleRedraw();
    requestAnimationFrame(() => {
      const { x: sx, y: sy } = worldToScreen(
        worldX - CARD_WIDTH / 2,
        worldY - CARD_HEIGHT / 2,
        camera.current,
      );
      const zoom = camera.current.zoom;
      setEditing({
        cardId: newCard.id,
        screenX: sx,
        screenY: sy,
        screenWidth: CARD_WIDTH * zoom,
        screenHeight: CARD_HEIGHT * zoom,
      });
    });
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
