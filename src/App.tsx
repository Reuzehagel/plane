import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, Grid, GridSummary, HandleCorner, History, Point, ResizeState, ResizeTarget, Snapshot } from "./types";
import { mouseToScreen, mouseToWorld, hitTestCards, hitTestHandles, worldToScreen, snapToGrid, snapPoint, lerpSnap, getContentBounds, isContentVisible } from "./geometry";
import { drawScene } from "./rendering";
import { pushSnapshot } from "./history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS,
  CARD_MIN_WIDTH, CARD_MIN_HEIGHT, CARD_MAX_WIDTH, CARD_MAX_HEIGHT,
  CARD_FONT_SIZE, CARD_TEXT_PAD, CARD_COLORS,
  CAMERA_LERP, CAMERA_FOCAL_EPSILON, CAMERA_ZOOM_EPSILON, FIT_PADDING,
} from "./constants";
import { useKeyboard } from "./useKeyboard";
import { createMenuHandlers } from "./menuHandlers";
import { loadWorkspace, saveWorkspace } from "./persistence";
import { Sidebar } from "./Sidebar";
import { LocateFixed } from "lucide-react";

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
  const spaceHeld = useRef(false);

  const history = useRef<History>({ undoStack: [], redoStack: [] });

  const [editing, editingRef, setEditing] = useRefState<EditingState | null>(null);
  const [contextMenu, contextMenuRef, setContextMenu] = useRefState<ContextMenuState | null>(null);
  const clipboard = useRef<Card | null>(null);

  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isLoaded = useRef(false);
  const saveTimerId = useRef<number>(0);

  const grids = useRef<Grid[]>([]);
  const [activeGridId, activeGridIdRef, setActiveGridId] = useRefState<string>("");
  const [gridSummaries, setGridSummaries] = useState<GridSummary[]>([]);
  const colorIndex = useRef(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [contentOffscreen, setContentOffscreen] = useState(false);
  const cameraAnimId = useRef<number>(0);

  function refreshGridSummaries(): void {
    setGridSummaries(grids.current.map((g) => ({
      id: g.id,
      name: g.name,
      cardCount: g.cards.length,
    })));
  }

  function syncCurrentGridBack(): void {
    const grid = grids.current.find((g) => g.id === activeGridIdRef.current);
    if (grid) {
      grid.cards = cards.current;
      grid.camera = { ...camera.current };
    }
  }

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!ctxRef.current) ctxRef.current = canvas.getContext("2d");
    if (!ctxRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    drawScene(ctxRef.current, dpr, w, h, camera.current, cards.current, selectedCardIds.current, boxSelect.current);
    setContentOffscreen(!isContentVisible(cards.current, camera.current, w, h));
  }, []);

  const scheduleRedraw = useCallback((): void => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    if (!fontsReady) return;

    loadWorkspace().then((data) => {
      grids.current = data.grids;
      setActiveGridId(data.activeGridId);

      const activeGrid = data.grids.find((g) => g.id === data.activeGridId) ?? data.grids[0];
      cards.current = activeGrid.cards;
      camera.current = { ...activeGrid.camera };
      isLoaded.current = true;
      refreshGridSummaries();
      scheduleRedraw();
    });

    function onBeforeUnload(): void {
      syncCurrentGridBack();
      saveWorkspace(grids.current, activeGridIdRef.current);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.clearTimeout(saveTimerId.current);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [fontsReady, scheduleRedraw]);

  function saveSnapshot(): void {
    pushSnapshot(history.current, cards.current, selectedCardIds.current);
  }

  function applySnapshot(snapshot: Snapshot): void {
    cards.current = snapshot.cards;
    selectedCardIds.current = snapshot.selectedCardIds;
    scheduleRedraw();
    markDirty();
  }

  function markDirty(): void {
    if (!isLoaded.current) return;
    window.clearTimeout(saveTimerId.current);
    saveTimerId.current = window.setTimeout(() => {
      syncCurrentGridBack();
      refreshGridSummaries();
      saveWorkspace(grids.current, activeGridIdRef.current);
    }, 2000);
  }

  function removeCard(cardId: string): void {
    cards.current = cards.current.filter((c) => c.id !== cardId);
    selectedCardIds.current.delete(cardId);
  }

  function createCard(x: number, y: number, width: number, height: number, title: string, color?: string): Card {
    const c = color ?? CARD_COLORS[colorIndex.current % CARD_COLORS.length];
    if (!color) colorIndex.current++;
    return { id: crypto.randomUUID(), x, y, width, height, title, color: c };
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
    markDirty();
    requestAnimationFrame(() => openEditor(newCard));
  }

  function fitToContent(): void {
    cancelAnimationFrame(cameraAnimId.current);

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const bounds = getContentBounds(cards.current);

    let targetFocalX = 0, targetFocalY = 0, targetZoom = 1;
    if (bounds) {
      const contentW = bounds.maxX - bounds.minX;
      const contentH = bounds.maxY - bounds.minY;
      targetZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min(
          (viewW - FIT_PADDING * 2) / contentW,
          (viewH - FIT_PADDING * 2) / contentH,
        ))
      );
      targetFocalX = bounds.minX + contentW / 2;
      targetFocalY = bounds.minY + contentH / 2;
    }

    // focal = world-space point at screen center: screen/zoom - cam
    const cam = camera.current;
    let focalX = viewW / (2 * cam.zoom) - cam.x;
    let focalY = viewH / (2 * cam.zoom) - cam.y;
    let currentZoom = cam.zoom;

    function animate(): void {
      const dfx = targetFocalX - focalX;
      const dfy = targetFocalY - focalY;
      const dz = targetZoom - currentZoom;

      if (Math.abs(dfx) < CAMERA_FOCAL_EPSILON && Math.abs(dfy) < CAMERA_FOCAL_EPSILON && Math.abs(dz) < CAMERA_ZOOM_EPSILON) {
        focalX = targetFocalX;
        focalY = targetFocalY;
        currentZoom = targetZoom;
      } else {
        focalX += dfx * CAMERA_LERP;
        focalY += dfy * CAMERA_LERP;
        currentZoom += dz * CAMERA_LERP;
      }

      camera.current.x = viewW / (2 * currentZoom) - focalX;
      camera.current.y = viewH / (2 * currentZoom) - focalY;
      camera.current.zoom = currentZoom;
      draw();

      if (focalX === targetFocalX && focalY === targetFocalY && currentZoom === targetZoom) {
        markDirty();
        return;
      }
      cameraAnimId.current = requestAnimationFrame(animate);
    }

    cameraAnimId.current = requestAnimationFrame(animate);
  }

  function activateGrid(grid: Grid): void {
    cards.current = grid.cards;
    camera.current = { ...grid.camera };
    selectedCardIds.current.clear();
    history.current = { undoStack: [], redoStack: [] };
    setActiveGridId(grid.id);
    refreshGridSummaries();
    scheduleRedraw();
    markDirty();
  }

  function switchGrid(id: string): void {
    if (id === activeGridIdRef.current) return;
    syncCurrentGridBack();
    const grid = grids.current.find((g) => g.id === id);
    if (grid) activateGrid(grid);
  }

  function createGrid(): void {
    syncCurrentGridBack();
    const name = `Grid ${grids.current.length + 1}`;
    const grid: Grid = { id: crypto.randomUUID(), name, cards: [], camera: { x: 0, y: 0, zoom: 1 } };
    grids.current.push(grid);
    activateGrid(grid);
  }

  function deleteGrid(id: string): void {
    if (grids.current.length <= 1) return;
    grids.current = grids.current.filter((g) => g.id !== id);
    if (activeGridIdRef.current === id) {
      activateGrid(grids.current[0]);
    } else {
      refreshGridSummaries();
      markDirty();
    }
  }

  function renameGrid(id: string, name: string): void {
    const grid = grids.current.find((g) => g.id === id);
    if (grid) {
      grid.name = name;
      refreshGridSummaries();
      markDirty();
    }
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
      if (spaceHeld.current) {
        canvas.style.cursor = "grab";
        return;
      }
      const { x: sx, y: sy } = mouseToScreen(e, canvasRect);
      const handleHit = hitTestHandles(sx, sy, cards.current, selectedCardIds.current, camera.current);
      if (handleHit) {
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }
      canvas.style.cursor = "default";
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

      // Space+left-click pans (hand tool), regardless of what's under cursor
      if (spaceHeld.current) {
        startPanning(e);
        return;
      }

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
        if (!e.shiftKey) selectedCardIds.current.clear();
        boxSelect.current = { start: world, current: world };
        scheduleRedraw();
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
      const wasMutating = !!(resizeState.current || dragState.current || isPanning.current);
      resizeState.current = null;
      dragState.current = null;
      isPanning.current = false;
      if (canvas) {
        canvas.style.cursor = spaceHeld.current ? "grab" : "default";
      }
      updateCursor(e);
      if (wasMutating) markDirty();
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
      markDirty();
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.code === "Space" && !editingRef.current) {
        spaceHeld.current = true;
        if (canvas && !isPanning.current) canvas.style.cursor = "grab";
        e.preventDefault();
      }
    }

    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === "Space") {
        spaceHeld.current = false;
        if (canvas && !isPanning.current) canvas.style.cursor = "default";
      }
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseup", onMouseUp, { passive: true });
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cancelAnimationFrame(rafId.current);
      cancelAnimationFrame(dragRafId.current);
      cancelAnimationFrame(resizeRafId.current);
      cancelAnimationFrame(cameraAnimId.current);
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
    markDirty();
  }

  function cancelEdit(): void {
    if (!editing) return;
    const card = findCard(editing.cardId);
    if (card && card.title === "") {
      saveSnapshot();
      removeCard(editing.cardId);
      scheduleRedraw();
      markDirty();
    }
    setEditing(null);
  }

  useKeyboard({
    contextMenuRef, editingRef, selectedCardIds, cards, history,
    setContextMenu, saveSnapshot, deleteSelectedCards,
    selectAllCards, applySnapshot, fitToContent, scheduleRedraw, markDirty,
  });

  const {
    handleMenuEdit, handleMenuDuplicate, handleMenuCopy,
    handleMenuResetSize, handleMenuDelete, handleMenuPaste, handleMenuNewCard,
    handleMenuChangeColor,
  } = createMenuHandlers({
    contextMenu, selectedCardIds, clipboard,
    findCard, removeCard, deleteSelectedCards, createCard, insertCard, openEditor,
    createAndStartEditingCardAt,
    saveSnapshot, setContextMenu, scheduleRedraw, markDirty,
  });

  const editingCard = editing ? findCard(editing.cardId) : null;

  return (
    <>
      <Sidebar
        grids={gridSummaries}
        activeGridId={activeGridId}
        onSwitchGrid={switchGrid}
        onCreateGrid={createGrid}
        onDeleteGrid={deleteGrid}
        onRenameGrid={renameGrid}
      />
      <button
        className={`fit-to-content-btn${contentOffscreen ? "" : " hidden"}`}
        onClick={fitToContent}
        title="Fit to content (Ctrl+1)"
      >
        <LocateFixed size={16} strokeWidth={1.8} />
      </button>
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
            color: editingCard?.color,
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
              <div className="context-menu-colors">
                {CARD_COLORS.map((color) => (
                  <div
                    key={color}
                    className={`context-menu-color-dot${findCard(contextMenu.cardId!)?.color === color ? " active" : ""}`}
                    style={{ background: color }}
                    onClick={() => handleMenuChangeColor(color)}
                  />
                ))}
              </div>
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
