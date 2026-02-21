import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, Grid, GridSummary, History, Point, ResizeState, ResizeTarget, Snapshot } from "../types";
import { screenToWorld, worldToScreen, snapPoint, getContentBounds, getBoundsCenter, isContentVisible } from "../lib/geometry";
import { drawScene } from "../lib/rendering";
import { pushSnapshot, undo, redo } from "../lib/history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS,
  CARD_FONT_SIZE, CARD_TITLE_FONT, CARD_TEXT_PAD, CARD_COLORS, DUPLICATE_OFFSET,
  CARD_ACCENT_HEIGHT, LINE_HEIGHT, CARD_BODY_COLOR,
  CAMERA_LERP, CAMERA_FOCAL_EPSILON, CAMERA_ZOOM_EPSILON, FIT_PADDING,
} from "../constants";
import { useKeyboard } from "../hooks/useKeyboard";
import { useCanvasInteractions } from "../hooks/useCanvasInteractions";
import { createMenuHandlers } from "../lib/menuHandlers";
import { runMutation } from "../lib/mutation";
import { loadWorkspace, saveWorkspace } from "../lib/persistence";
import { computeCardHeight, wrapText } from "../lib/textLayout";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { LocateFixed } from "lucide-react";

// Pairs useState with a ref that stays in sync, so imperative event handlers
// can always read the latest value without stale closures.
function useRefState<T>(initial: T): [T, React.RefObject<T>, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const ref = useRef<T>(initial);
  useEffect(() => { ref.current = state; }, [state]);
  return [state, ref, setState];
}

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
  const clipboard = useRef<Card[]>([]);
  const cardScrollOffsets = useRef<Map<string, number>>(new Map());

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isLoaded = useRef(false);
  const saveTimerId = useRef<number>(0);

  const grids = useRef<Grid[]>([]);
  const [activeGridId, activeGridIdRef, setActiveGridId] = useRefState<string>("");
  const [gridSummaries, setGridSummaries] = useState<GridSummary[]>([]);
  const colorIndex = useRef(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [contentOffscreen, setContentOffscreen] = useState(false);
  const [paletteOpen, paletteOpenRef, setPaletteOpen] = useRefState(false);
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
    drawScene(ctxRef.current, dpr, w, h, camera.current, cards.current, selectedCardIds.current, boxSelect.current, editingRef.current?.cardId ?? null, cardScrollOffsets.current);
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

  function createCard(x: number, y: number, width: number, height: number, text: string, color?: string): Card {
    const c = color ?? CARD_COLORS[colorIndex.current % CARD_COLORS.length];
    if (!color) colorIndex.current++;
    return { id: crypto.randomUUID(), x, y, width, height, text, color: c };
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
    const state: EditingState = {
      cardId: card.id,
      screenX: sx,
      screenY: sy,
      screenWidth: card.width * zoom,
      screenHeight: card.height * zoom,
    };
    editingRef.current = state;
    setEditing(state);
    scheduleRedraw();
  }

  function syncEditorPosition(): void {
    if (!editingRef.current) return;
    const card = findCard(editingRef.current.cardId);
    if (!card) return;
    const { x: sx, y: sy } = worldToScreen(card.x, card.y, camera.current);
    const zoom = camera.current.zoom;
    const state: EditingState = {
      cardId: card.id,
      screenX: sx,
      screenY: sy,
      screenWidth: card.width * zoom,
      screenHeight: card.height * zoom,
    };
    editingRef.current = state;
    setEditing(state);
  }

  function createAndStartEditingCardAt(worldX: number, worldY: number): void {
    const snap = snapPoint(worldX - CARD_WIDTH / 2, worldY - CARD_HEIGHT / 2);
    const newCard = createCard(snap.x, snap.y, CARD_WIDTH, CARD_HEIGHT, "");
    runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => insertCard(newCard));
    requestAnimationFrame(() => openEditor(newCard));
  }

  function copySelectedCards(): void {
    if (selectedCardIds.current.size === 0) return;
    clipboard.current = cards.current
      .filter((c) => selectedCardIds.current.has(c.id))
      .map((c) => ({ ...c }));
  }

  function pasteCardsAtPoint(sources: Card[], worldX: number, worldY: number): void {
    const bounds = getContentBounds(sources);
    if (!bounds) return;
    const center = getBoundsCenter(bounds);
    const dx = worldX - center.x;
    const dy = worldY - center.y;
    runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => {
      selectedCardIds.current.clear();
      for (const s of sources) {
        const pos = snapPoint(s.x + dx, s.y + dy);
        const newCard = createCard(pos.x, pos.y, s.width, s.height, s.text, s.color);
        cards.current.push(newCard);
        selectedCardIds.current.add(newCard.id);
      }
    });
  }

  function viewportCenter(): Point {
    return screenToWorld(window.innerWidth / 2, window.innerHeight / 2, camera.current);
  }

  function pasteFromClipboard(): void {
    if (clipboard.current.length > 0) {
      const center = viewportCenter();
      pasteCardsAtPoint(clipboard.current, center.x + DUPLICATE_OFFSET, center.y + DUPLICATE_OFFSET);
    } else {
      navigator.clipboard.readText().then((text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const center = viewportCenter();
        const snap = snapPoint(center.x - CARD_WIDTH / 2, center.y - CARD_HEIGHT / 2);
        const newCard = createCard(snap.x, snap.y, CARD_WIDTH, CARD_HEIGHT, trimmed);
        recalculateCardHeight(newCard);
        runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => insertCard(newCard));
      });
    }
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
      const focal = getBoundsCenter(bounds);
      targetFocalX = focal.x;
      targetFocalY = focal.y;
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

  function animateCameraToPoint(targetX: number, targetY: number): void {
    cancelAnimationFrame(cameraAnimId.current);
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const cam = camera.current;
    let focalX = viewW / (2 * cam.zoom) - cam.x;
    let focalY = viewH / (2 * cam.zoom) - cam.y;
    const currentZoom = cam.zoom;

    function animate(): void {
      const dfx = targetX - focalX;
      const dfy = targetY - focalY;

      if (Math.abs(dfx) < CAMERA_FOCAL_EPSILON && Math.abs(dfy) < CAMERA_FOCAL_EPSILON) {
        focalX = targetX;
        focalY = targetY;
      } else {
        focalX += dfx * CAMERA_LERP;
        focalY += dfy * CAMERA_LERP;
      }

      camera.current.x = viewW / (2 * currentZoom) - focalX;
      camera.current.y = viewH / (2 * currentZoom) - focalY;
      draw();

      if (focalX === targetX && focalY === targetY) {
        markDirty();
        return;
      }
      cameraAnimId.current = requestAnimationFrame(animate);
    }

    cameraAnimId.current = requestAnimationFrame(animate);
  }

  function executePaletteAction(actionId: string): void {
    switch (actionId) {
      case "new-card": {
        const center = viewportCenter();
        createAndStartEditingCardAt(center.x, center.y);
        break;
      }
      case "new-grid":    createGrid(); break;
      case "fit":         fitToContent(); break;
      case "select-all":  selectAllCards(); scheduleRedraw(); break;
      case "undo": {
        const snapshot = undo(history.current, cards.current, selectedCardIds.current);
        if (snapshot) applySnapshot(snapshot);
        break;
      }
      case "redo": {
        const snapshot = redo(history.current, cards.current, selectedCardIds.current);
        if (snapshot) applySnapshot(snapshot);
        break;
      }
      case "delete":
        if (selectedCardIds.current.size > 0) {
          runMutation({ saveSnapshot, scheduleRedraw, markDirty }, deleteSelectedCards);
        }
        break;
    }
  }

  function jumpToCard(gridId: string, cardId: string): void {
    if (gridId !== activeGridIdRef.current) {
      syncCurrentGridBack();
      const grid = grids.current.find((g) => g.id === gridId);
      if (grid) activateGrid(grid);
    }

    const card = cards.current.find((c) => c.id === cardId);
    if (!card) return;

    selectedCardIds.current = new Set([cardId]);
    const targetX = card.x + card.width / 2;
    const targetY = card.y + card.height / 2;
    animateCameraToPoint(targetX, targetY);
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

  useCanvasInteractions({
    canvasRef, camera, isPanning, lastMouse, cards,
    dragState, resizeState, selectedCardIds, boxSelect,
    dragSnapTargets, dragRafId, resizeTarget, resizeRafId,
    spaceHeld, editingRef, contextMenuRef, cardScrollOffsets,
    draw, scheduleRedraw, saveSnapshot, markDirty,
    selectCard, openEditor, createAndStartEditingCardAt, setContextMenu,
    syncEditorPosition, getCardMaxScroll,
  });

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafId.current);
      cancelAnimationFrame(cameraAnimId.current);
    };
  }, []);

  function recalculateCardHeight(card: Card): void {
    const ctx = ctxRef.current;
    if (ctx) {
      ctx.font = `${CARD_FONT_SIZE}px ${CARD_TITLE_FONT}`;
      card.height = computeCardHeight(ctx, card.text, card.width);
    }
  }

  function getCardMaxScroll(cardId: string): number {
    const card = findCard(cardId);
    if (!card) return 0;
    const ctx = ctxRef.current;
    if (!ctx) return 0;
    ctx.font = `${CARD_FONT_SIZE}px ${CARD_TITLE_FONT}`;
    const maxWidth = card.width - CARD_TEXT_PAD * 2;
    const lines = wrapText(ctx, card.text, maxWidth);
    if (lines.length <= 1) return 0;
    const totalH = lines.length * LINE_HEIGHT;
    const visibleH = card.height - CARD_ACCENT_HEIGHT - CARD_TEXT_PAD * 2;
    return Math.max(0, totalH - visibleH);
  }

  function commitEdit(): void {
    if (!editing) return;
    const header = headerInputRef.current?.value ?? "";
    const body = bodyTextareaRef.current?.value ?? "";
    const value = body ? header + "\n" + body : header;
    const card = findCard(editing.cardId);
    if (card) {
      if (value.trim() === "" && card.text === "") {
        saveSnapshot();
        removeCard(editing.cardId);
      } else {
        if (card.text !== value) saveSnapshot();
        card.text = value;
        recalculateCardHeight(card);
      }
    }
    cardScrollOffsets.current.delete(editing.cardId);
    setEditing(null);
    scheduleRedraw();
    markDirty();
  }

  function cancelEdit(): void {
    if (!editing) return;
    const card = findCard(editing.cardId);
    if (card && card.text === "") {
      saveSnapshot();
      removeCard(editing.cardId);
      scheduleRedraw();
      markDirty();
    }
    setEditing(null);
  }

  function togglePalette(): void {
    setPaletteOpen((open) => {
      if (!open) syncCurrentGridBack();
      return !open;
    });
  }

  useKeyboard({
    contextMenuRef, editingRef, paletteOpenRef, selectedCardIds, cards, history,
    setContextMenu, saveSnapshot, deleteSelectedCards,
    selectAllCards, applySnapshot, fitToContent, copySelectedCards, pasteFromClipboard,
    togglePalette, scheduleRedraw, markDirty,
  });

  const {
    handleMenuEdit, handleMenuDuplicate, handleMenuCopy,
    handleMenuResetSize, handleMenuDelete, handleMenuPaste, handleMenuNewCard,
    handleMenuChangeColor,
  } = createMenuHandlers({
    contextMenu, selectedCardIds, clipboard,
    findCard, removeCard, deleteSelectedCards, createCard, insertCard, openEditor,
    createAndStartEditingCardAt, copySelectedCards, pasteCardsAtPoint,
    recalculateCardHeight, saveSnapshot, setContextMenu, scheduleRedraw, markDirty,
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
      {editing && (() => {
        const zoom = camera.current.zoom;
        const fullText = findCard(editing.cardId)?.text ?? "";
        const nlIndex = fullText.indexOf("\n");
        const headerText = nlIndex === -1 ? fullText : fullText.slice(0, nlIndex);
        const bodyText = nlIndex === -1 ? "" : fullText.slice(nlIndex + 1);
        const fontSize = CARD_FONT_SIZE * zoom;
        const lineH = LINE_HEIGHT * zoom;
        const pad = CARD_TEXT_PAD * zoom;
        const accentH = CARD_ACCENT_HEIGHT * zoom;

        function handleEditorBlur(e: React.FocusEvent): void {
          if (editorContainerRef.current?.contains(e.relatedTarget as Node)) return;
          commitEdit();
        }

        function handleEditorWheel(e: React.WheelEvent): void {
          if (!e.ctrlKey && !e.metaKey) return;
          const { zoom } = camera.current;
          const delta = -e.deltaY * ZOOM_SENSITIVITY;
          const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          camera.current.x += mx / newZoom - mx / zoom;
          camera.current.y += my / newZoom - my / zoom;
          camera.current.zoom = newZoom;
          syncEditorPosition();
          scheduleRedraw();
          markDirty();
        }

        function handleEditorMiddleClick(e: React.MouseEvent): void {
          if (e.button === 1) {
            e.preventDefault();
            isPanning.current = true;
            lastMouse.current = { x: e.clientX, y: e.clientY };
            if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
          }
        }

        function handleEditorKeyDown(e: React.KeyboardEvent): void {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            commitEdit();
          } else if (e.key === "Escape") {
            cancelEdit();
          }
        }

        function autoSizeBody(): void {
          const el = bodyTextareaRef.current;
          if (!el) return;
          el.style.height = "0";
          el.style.height = `${el.scrollHeight}px`;
        }

        function bodyRefCallback(el: HTMLTextAreaElement | null): void {
          (bodyTextareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
          if (el) {
            requestAnimationFrame(() => {
              el.style.height = "0";
              el.style.height = `${el.scrollHeight}px`;
            });
          }
        }

        return (
          <div
            ref={editorContainerRef}
            className="card-editor"
            onWheel={handleEditorWheel}
            onMouseDown={handleEditorMiddleClick}
            style={{
              left: editing.screenX,
              top: editing.screenY,
              width: editing.screenWidth,
              minHeight: editing.screenHeight,
              borderRadius: CARD_RADIUS * zoom,
            }}
          >
            <div className="card-editor-accent" style={{ height: accentH, background: editingCard?.color }} />
            <input
              ref={headerInputRef}
              className="card-editor-header"
              style={{
                fontSize,
                lineHeight: `${lineH}px`,
                padding: `${pad}px ${pad}px ${pad * 0.5}px`,
                color: editingCard?.color,
              }}
              autoFocus
              placeholder="Title"
              defaultValue={headerText}
              onKeyDown={(e) => {
                handleEditorKeyDown(e);
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  bodyTextareaRef.current?.focus();
                }
              }}
              onBlur={handleEditorBlur}
            />
            <div className="card-editor-separator" style={{ margin: `0 ${pad}px` }} />
            <textarea
              ref={bodyRefCallback}
              className="card-editor-body"
              style={{
                fontSize,
                lineHeight: `${lineH}px`,
                padding: `${pad * 0.5}px ${pad}px ${pad}px`,
                color: CARD_BODY_COLOR,
              }}
              placeholder="Notes..."
              defaultValue={bodyText}
              onKeyDown={(e) => {
                handleEditorKeyDown(e);
                if (e.key === "Backspace" && e.currentTarget.value === "") {
                  e.preventDefault();
                  headerInputRef.current?.focus();
                }
              }}
              onInput={autoSizeBody}
              onFocus={autoSizeBody}
              onBlur={handleEditorBlur}
            />
          </div>
        );
      })()}
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
                className={`context-menu-item${clipboard.current.length > 0 ? "" : " disabled"}`}
                onClick={handleMenuPaste}
              >
                Paste
              </div>
              <div className="context-menu-item" onClick={handleMenuNewCard}>New Card</div>
            </>
          )}
        </div>
      )}
      {paletteOpen && (
        <CommandPalette
          grids={grids}
          activeGridId={activeGridId}
          onClose={() => setPaletteOpen(false)}
          onExecuteAction={executePaletteAction}
          onSwitchGrid={switchGrid}
          onJumpToCard={jumpToCard}
        />
      )}
    </>
  );
}

export default App;
