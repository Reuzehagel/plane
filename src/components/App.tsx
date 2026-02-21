import { useRef, useEffect, useCallback, useState } from "react";
import "./App.css";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, Frame, FrameSummary, Grid, GridSummary, History, Point, PresentationState, ResizeState, ResizeTarget, Snapshot } from "../types";
import { screenToWorld, worldToScreen, snapPoint, getRectBounds, mergeBounds, getBoundsCenter, isContentVisible } from "../lib/geometry";
import { drawScene } from "../lib/rendering";
import { pushSnapshot, undo, redo } from "../lib/history";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS,
  CARD_FONT_SIZE, CARD_TITLE_FONT, CARD_TEXT_PAD, CARD_COLORS, DUPLICATE_OFFSET,
  CARD_ACCENT_HEIGHT, LINE_HEIGHT, CARD_BODY_COLOR,
  CAMERA_LERP, CAMERA_FOCAL_EPSILON, CAMERA_ZOOM_EPSILON, FIT_PADDING, SIDEBAR_WIDTH,
  FRAME_DEFAULT_WIDTH, FRAME_DEFAULT_HEIGHT, FRAME_LABEL_FONT_SIZE, FRAME_LABEL_OFFSET_Y,
  PRESENTATION_FIT_PADDING,
} from "../constants";
import { useKeyboard } from "../hooks/useKeyboard";
import { useCanvasInteractions } from "../hooks/useCanvasInteractions";
import { createMenuHandlers } from "../lib/menuHandlers";
import { runMutation } from "../lib/mutation";
import { loadWorkspace, saveWorkspace } from "../lib/persistence";
import { computeCardHeight, wrapText } from "../lib/textLayout";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { PresentationOverlay } from "./PresentationOverlay";
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
  const frameClipboard = useRef<Frame[]>([]);
  const cardScrollOffsets = useRef<Map<string, number>>(new Map());

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isLoaded = useRef(false);
  const saveTimerId = useRef<number>(0);
  const sidebarOpen = useRef(true);

  const grids = useRef<Grid[]>([]);
  const [activeGridId, activeGridIdRef, setActiveGridId] = useRefState<string>("");
  const [gridSummaries, setGridSummaries] = useState<GridSummary[]>([]);
  const colorIndex = useRef(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [contentOffscreen, setContentOffscreen] = useState(false);
  const [paletteOpen, paletteOpenRef, setPaletteOpen] = useRefState(false);
  const cameraAnimId = useRef<number>(0);

  // Frame state
  const frames = useRef<Frame[]>([]);
  const selectedFrameIds = useRef<Set<string>>(new Set());
  const [editingFrameLabel, editingFrameLabelRef, setEditingFrameLabel] = useRefState<string | null>(null);
  const [presenting, presentingRef, setPresenting] = useRefState<PresentationState | null>(null);
  const [frameSummaries, setFrameSummaries] = useState<FrameSummary[]>([]);
  const frameLabelInputRef = useRef<HTMLInputElement>(null);

  function refreshGridSummaries(): void {
    setGridSummaries(grids.current.map((g) => ({
      id: g.id,
      name: g.name,
      cardCount: g.cards.length,
    })));
  }

  function refreshFrameSummaries(): void {
    setFrameSummaries(frames.current.map((f) => ({
      id: f.id,
      label: f.label,
      order: f.order,
    })));
  }

  function syncCurrentGridBack(): void {
    const grid = grids.current.find((g) => g.id === activeGridIdRef.current);
    if (grid) {
      grid.cards = cards.current;
      grid.frames = frames.current;
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
    const presentingNow = presentingRef.current;
    drawScene(
      ctxRef.current, dpr, w, h, camera.current, cards.current, selectedCardIds.current,
      boxSelect.current, editingRef.current?.cardId ?? null, cardScrollOffsets.current,
      presentingNow ? [] : frames.current,
      presentingNow ? new Set() : selectedFrameIds.current,
      editingFrameLabelRef.current,
    );
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
      frames.current = activeGrid.frames ?? [];
      camera.current = { ...activeGrid.camera };
      isLoaded.current = true;
      refreshGridSummaries();
      refreshFrameSummaries();
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
    pushSnapshot(history.current, cards.current, selectedCardIds.current, frames.current, selectedFrameIds.current);
  }

  function applySnapshot(snapshot: Snapshot): void {
    cards.current = snapshot.cards;
    selectedCardIds.current = snapshot.selectedCardIds;
    frames.current = snapshot.frames;
    selectedFrameIds.current = snapshot.selectedFrameIds;
    refreshFrameSummaries();
    scheduleRedraw();
    markDirty();
  }

  function markDirty(): void {
    if (!isLoaded.current) return;
    window.clearTimeout(saveTimerId.current);
    saveTimerId.current = window.setTimeout(() => {
      syncCurrentGridBack();
      refreshGridSummaries();
      refreshFrameSummaries();
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

  // Frame CRUD
  function createFrame(x: number, y: number, width: number, height: number, label: string): Frame {
    const order = frames.current.length > 0
      ? Math.max(...frames.current.map((f) => f.order)) + 1
      : 1;
    return { id: crypto.randomUUID(), x, y, width, height, label, order };
  }

  function insertFrame(frame: Frame): void {
    frames.current.push(frame);
    selectedFrameIds.current.clear();
    selectedFrameIds.current.add(frame.id);
    selectedCardIds.current.clear();
    refreshFrameSummaries();
  }

  function removeFrame(id: string): void {
    frames.current = frames.current.filter((f) => f.id !== id);
    selectedFrameIds.current.delete(id);
    refreshFrameSummaries();
  }

  function findFrame(id: string): Frame | undefined {
    return frames.current.find((f) => f.id === id);
  }

  function deleteSelectedFrames(): void {
    frames.current = frames.current.filter((f) => !selectedFrameIds.current.has(f.id));
    selectedFrameIds.current.clear();
    refreshFrameSummaries();
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
    frameClipboard.current = [];
  }

  function copySelectedFrames(): void {
    if (selectedFrameIds.current.size === 0) return;
    frameClipboard.current = frames.current
      .filter((f) => selectedFrameIds.current.has(f.id))
      .map((f) => ({ ...f }));
    clipboard.current = [];
  }

  function pasteFramesAtPoint(sources: Frame[], worldX: number, worldY: number): void {
    const fBounds = getRectBounds(sources);
    if (!fBounds) return;
    const center = getBoundsCenter(fBounds);
    const dx = worldX - center.x;
    const dy = worldY - center.y;
    runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => {
      selectedFrameIds.current.clear();
      selectedCardIds.current.clear();
      for (const s of sources) {
        const pos = snapPoint(s.x + dx, s.y + dy);
        const newFrame = createFrame(pos.x, pos.y, s.width, s.height, s.label);
        frames.current.push(newFrame);
        selectedFrameIds.current.add(newFrame.id);
      }
      refreshFrameSummaries();
    });
  }

  function pasteCardsAtPoint(sources: Card[], worldX: number, worldY: number): void {
    const bounds = getRectBounds(sources);
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
    if (frameClipboard.current.length > 0) {
      const center = viewportCenter();
      pasteFramesAtPoint(frameClipboard.current, center.x + DUPLICATE_OFFSET, center.y + DUPLICATE_OFFSET);
    } else if (clipboard.current.length > 0) {
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

  function animateCamera(opts: {
    targetFocalX: number;
    targetFocalY: number;
    targetZoom: number | null;
    screenCenterX: number;
    screenCenterY: number;
    onDone?: () => void;
  }): void {
    cancelAnimationFrame(cameraAnimId.current);
    const { targetFocalX, targetFocalY, screenCenterX, screenCenterY, onDone } = opts;
    const cam = camera.current;
    let focalX = screenCenterX / cam.zoom - cam.x;
    let focalY = screenCenterY / cam.zoom - cam.y;
    let currentZoom = cam.zoom;
    const targetZoom = opts.targetZoom ?? currentZoom;

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

      camera.current.x = screenCenterX / currentZoom - focalX;
      camera.current.y = screenCenterY / currentZoom - focalY;
      camera.current.zoom = currentZoom;
      draw();

      if (focalX === targetFocalX && focalY === targetFocalY && currentZoom === targetZoom) {
        onDone?.();
        return;
      }
      cameraAnimId.current = requestAnimationFrame(animate);
    }

    cameraAnimId.current = requestAnimationFrame(animate);
  }

  function fitToContent(): void {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const sidebarInset = sidebarOpen.current ? SIDEBAR_WIDTH : 0;
    const usableW = viewW - sidebarInset;
    const bounds = mergeBounds(getRectBounds(cards.current), getRectBounds(frames.current));

    let targetFocalX = 0, targetFocalY = 0, targetZoom = 1;
    if (bounds) {
      const contentW = bounds.maxX - bounds.minX;
      const contentH = bounds.maxY - bounds.minY;
      targetZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.min(
          (usableW - FIT_PADDING * 2) / contentW,
          (viewH - FIT_PADDING * 2) / contentH,
        ))
      );
      const focal = getBoundsCenter(bounds);
      targetFocalX = focal.x;
      targetFocalY = focal.y;
    }

    animateCamera({
      targetFocalX, targetFocalY, targetZoom,
      screenCenterX: sidebarInset + usableW / 2,
      screenCenterY: viewH / 2,
      onDone: markDirty,
    });
  }

  function animateCameraToPoint(targetX: number, targetY: number): void {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    animateCamera({
      targetFocalX: targetX, targetFocalY: targetY, targetZoom: null,
      screenCenterX: viewW / 2, screenCenterY: viewH / 2,
      onDone: markDirty,
    });
  }

  function animateCameraToFrame(frame: Frame): void {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const targetZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(
        (viewW - PRESENTATION_FIT_PADDING * 2) / frame.width,
        (viewH - PRESENTATION_FIT_PADDING * 2) / frame.height,
      ))
    );
    animateCamera({
      targetFocalX: frame.x + frame.width / 2,
      targetFocalY: frame.y + frame.height / 2,
      targetZoom,
      screenCenterX: viewW / 2, screenCenterY: viewH / 2,
    });
  }

  // Presentation mode
  function startPresentation(): void {
    const sorted = [...frames.current].sort((a, b) => a.order - b.order);
    if (sorted.length === 0) return;
    const state: PresentationState = {
      frameIndex: 0,
      frames: sorted,
      savedCamera: { ...camera.current },
    };
    setPresenting(state);
    setContextMenu(null);
    setEditing(null);
    animateCameraToFrame(sorted[0]);
  }

  function presentNext(): void {
    const state = presentingRef.current;
    if (!state || state.frameIndex >= state.frames.length - 1) return;
    const next = state.frameIndex + 1;
    const updated: PresentationState = { ...state, frameIndex: next };
    setPresenting(updated);
    animateCameraToFrame(state.frames[next]);
  }

  function presentPrev(): void {
    const state = presentingRef.current;
    if (!state || state.frameIndex <= 0) return;
    const prev = state.frameIndex - 1;
    const updated: PresentationState = { ...state, frameIndex: prev };
    setPresenting(updated);
    animateCameraToFrame(state.frames[prev]);
  }

  function exitPresentation(): void {
    const state = presentingRef.current;
    if (!state) return;
    setPresenting(null);

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const saved = state.savedCamera;
    animateCamera({
      targetFocalX: viewW / (2 * saved.zoom) - saved.x,
      targetFocalY: viewH / (2 * saved.zoom) - saved.y,
      targetZoom: saved.zoom,
      screenCenterX: viewW / 2, screenCenterY: viewH / 2,
      onDone: markDirty,
    });
  }

  // Frame label editing
  function startEditingFrameLabel(frame: Frame): void {
    selectedFrameIds.current.clear();
    selectedFrameIds.current.add(frame.id);
    selectedCardIds.current.clear();
    setEditingFrameLabel(frame.id);
    scheduleRedraw();
    requestAnimationFrame(() => {
      frameLabelInputRef.current?.focus({ preventScroll: true });
      frameLabelInputRef.current?.select();
    });
  }

  function commitFrameLabelEdit(): void {
    const frameId = editingFrameLabelRef.current;
    if (!frameId) return;
    const frame = findFrame(frameId);
    const input = frameLabelInputRef.current;
    if (frame && input) {
      const newLabel = input.value.trim();
      if (newLabel && newLabel !== frame.label) {
        saveSnapshot();
        frame.label = newLabel;
        refreshFrameSummaries();
        markDirty();
      }
    }
    setEditingFrameLabel(null);
    scheduleRedraw();
  }

  function cancelFrameLabelEdit(): void {
    setEditingFrameLabel(null);
    scheduleRedraw();
  }

  function executePaletteAction(actionId: string): void {
    switch (actionId) {
      case "new-card": {
        const center = viewportCenter();
        createAndStartEditingCardAt(center.x, center.y);
        break;
      }
      case "new-grid":    createGrid(); break;
      case "new-frame": {
        const center = viewportCenter();
        const snap = snapPoint(center.x - FRAME_DEFAULT_WIDTH / 2, center.y - FRAME_DEFAULT_HEIGHT / 2);
        const nextOrder = frames.current.length > 0
          ? Math.max(...frames.current.map((f) => f.order)) + 1
          : 1;
        const frame = createFrame(snap.x, snap.y, FRAME_DEFAULT_WIDTH, FRAME_DEFAULT_HEIGHT, `Frame ${nextOrder}`);
        runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => insertFrame(frame));
        break;
      }
      case "present":     startPresentation(); break;
      case "fit":         fitToContent(); break;
      case "select-all":  selectAllCards(); scheduleRedraw(); break;
      case "undo": {
        const snapshot = undo(history.current, cards.current, selectedCardIds.current, frames.current, selectedFrameIds.current);
        if (snapshot) applySnapshot(snapshot);
        break;
      }
      case "redo": {
        const snapshot = redo(history.current, cards.current, selectedCardIds.current, frames.current, selectedFrameIds.current);
        if (snapshot) applySnapshot(snapshot);
        break;
      }
      case "delete":
        if (selectedCardIds.current.size > 0 || selectedFrameIds.current.size > 0) {
          runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => {
            deleteSelectedCards();
            deleteSelectedFrames();
          });
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
    selectedFrameIds.current.clear();
    const targetX = card.x + card.width / 2;
    const targetY = card.y + card.height / 2;
    animateCameraToPoint(targetX, targetY);
  }

  function jumpToFrame(gridId: string, frameId: string): void {
    if (gridId !== activeGridIdRef.current) {
      syncCurrentGridBack();
      const grid = grids.current.find((g) => g.id === gridId);
      if (grid) activateGrid(grid);
    }

    const frame = frames.current.find((f) => f.id === frameId);
    if (!frame) return;

    selectedFrameIds.current = new Set([frameId]);
    selectedCardIds.current.clear();
    const targetX = frame.x + frame.width / 2;
    const targetY = frame.y + frame.height / 2;
    animateCameraToPoint(targetX, targetY);
  }

  function jumpToFrameById(frameId: string): void {
    jumpToFrame(activeGridIdRef.current, frameId);
  }

  function activateGrid(grid: Grid): void {
    cards.current = grid.cards;
    frames.current = grid.frames ?? [];
    camera.current = { ...grid.camera };
    selectedCardIds.current.clear();
    selectedFrameIds.current.clear();
    history.current = { undoStack: [], redoStack: [] };
    setActiveGridId(grid.id);
    refreshGridSummaries();
    refreshFrameSummaries();
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
    const grid: Grid = { id: crypto.randomUUID(), name, cards: [], frames: [], camera: { x: 0, y: 0, zoom: 1 } };
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

  function reorderFrames(orderedIds: string[]): void {
    saveSnapshot();
    for (let i = 0; i < orderedIds.length; i++) {
      const frame = frames.current.find((f) => f.id === orderedIds[i]);
      if (frame) frame.order = i + 1;
    }
    refreshFrameSummaries();
    scheduleRedraw();
    markDirty();
  }

  function sidebarRenameFrame(id: string, name: string): void {
    const frame = findFrame(id);
    if (frame) {
      saveSnapshot();
      frame.label = name;
      refreshFrameSummaries();
      scheduleRedraw();
      markDirty();
    }
  }

  function sidebarDeleteFrame(id: string): void {
    runMutation({ saveSnapshot, scheduleRedraw, markDirty }, () => removeFrame(id));
    refreshFrameSummaries();
  }

  useCanvasInteractions({
    canvasRef, camera, isPanning, lastMouse, cards,
    dragState, resizeState, selectedCardIds, boxSelect,
    dragSnapTargets, dragRafId, resizeTarget, resizeRafId,
    spaceHeld, editingRef, contextMenuRef, cardScrollOffsets,
    frames, selectedFrameIds, presentingRef,
    draw, scheduleRedraw, saveSnapshot, markDirty,
    selectCard, openEditor, createAndStartEditingCardAt, setContextMenu,
    syncEditorPosition, getCardMaxScroll, startEditingFrameLabel,
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
    frames, selectedFrameIds, presentingRef, editingFrameLabelRef,
    setContextMenu, saveSnapshot, deleteSelectedCards, deleteSelectedFrames,
    selectAllCards, applySnapshot, fitToContent, copySelectedCards, copySelectedFrames,
    pasteFromClipboard,
    togglePalette, startPresentation, presentNext, presentPrev, exitPresentation,
    scheduleRedraw, markDirty,
  });

  const {
    handleMenuEdit, handleMenuDuplicate, handleMenuCopy,
    handleMenuResetSize, handleMenuDelete, handleMenuPaste, handleMenuNewCard,
    handleMenuChangeColor, handleMenuNewFrame, handleMenuRenameFrame, handleMenuDeleteFrame,
    handleMenuDuplicateFrame, handleMenuCopyFrame,
  } = createMenuHandlers({
    contextMenu, selectedCardIds, clipboard, frameClipboard,
    findCard, removeCard, deleteSelectedCards, createCard, insertCard, openEditor,
    createAndStartEditingCardAt, copySelectedCards, pasteCardsAtPoint,
    recalculateCardHeight, saveSnapshot, setContextMenu, scheduleRedraw, markDirty,
    frames, createFrame, insertFrame, removeFrame, findFrame, selectedFrameIds,
    startEditingFrameLabel, deleteSelectedFrames, copySelectedFrames, pasteFramesAtPoint,
  });

  const editingCard = editing ? findCard(editing.cardId) : null;

  // Focus the card editor header without scrolling the page
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        headerInputRef.current?.focus({ preventScroll: true });
      });
    }
  }, [editing?.cardId]);

  // Frame label editor positioning
  const editingFrameForLabel = editingFrameLabel ? findFrame(editingFrameLabel) : null;
  let frameLabelEditorStyle: React.CSSProperties | undefined;
  if (editingFrameForLabel) {
    const zoom = camera.current.zoom;
    const { x: sx, y: sy } = worldToScreen(editingFrameForLabel.x, editingFrameForLabel.y, camera.current);
    const labelFontSize = FRAME_LABEL_FONT_SIZE * Math.min(zoom, 1.5);
    frameLabelEditorStyle = {
      left: sx + 2 * zoom,
      top: sy + FRAME_LABEL_OFFSET_Y * zoom - labelFontSize - 4,
      fontSize: labelFontSize,
      width: editingFrameForLabel.width * zoom,
    };
  }

  return (
    <>
      {!presenting && (
        <Sidebar
          grids={gridSummaries}
          activeGridId={activeGridId}
          onSwitchGrid={switchGrid}
          onCreateGrid={createGrid}
          onDeleteGrid={deleteGrid}
          onRenameGrid={renameGrid}
          frameSummaries={frameSummaries}
          onReorderFrames={reorderFrames}
          onStartPresentation={startPresentation}
          onJumpToFrame={jumpToFrameById}
          onRenameFrame={sidebarRenameFrame}
          onDeleteFrame={sidebarDeleteFrame}
          onOpenChange={(v) => { sidebarOpen.current = v; }}
        />
      )}
      {!presenting && (
        <button
          className={`fit-to-content-btn${contentOffscreen ? "" : " hidden"}`}
          onClick={fitToContent}
          title="Fit to content (Ctrl+1)"
        >
          <LocateFixed size={16} strokeWidth={1.8} />
        </button>
      )}
      <canvas ref={canvasRef} />
      {editing && !presenting && (() => {
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
          if (e.ctrlKey || e.metaKey) {
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
            return;
          }
          // Regular scroll → pan canvas
          const { zoom } = camera.current;
          camera.current.x -= e.deltaX / zoom;
          if (e.shiftKey) {
            camera.current.x -= e.deltaY / zoom;
          } else {
            camera.current.y -= e.deltaY / zoom;
          }
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
              placeholder="Title"
              defaultValue={headerText}
              onKeyDown={(e) => {
                handleEditorKeyDown(e);
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  bodyTextareaRef.current?.focus({ preventScroll: true });
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
                  headerInputRef.current?.focus({ preventScroll: true });
                }
              }}
              onInput={autoSizeBody}
              onFocus={autoSizeBody}
              onBlur={handleEditorBlur}
            />
          </div>
        );
      })()}
      {editingFrameLabel && frameLabelEditorStyle && (
        <input
          ref={frameLabelInputRef}
          className="frame-label-editor"
          style={frameLabelEditorStyle}
          defaultValue={editingFrameForLabel?.label ?? ""}
          onBlur={commitFrameLabelEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitFrameLabelEdit();
            else if (e.key === "Escape") cancelFrameLabelEdit();
            e.stopPropagation();
          }}
        />
      )}
      {contextMenu && !presenting && (
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
          ) : contextMenu.frameId ? (
            <>
              <div className="context-menu-item" onClick={handleMenuRenameFrame}>Rename</div>
              <div className="context-menu-item" onClick={handleMenuDuplicateFrame}>Duplicate</div>
              <div className="context-menu-item" onClick={handleMenuCopyFrame}>Copy</div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={handleMenuDeleteFrame}>Delete</div>
            </>
          ) : (
            <>
              <div
                className={`context-menu-item${clipboard.current.length > 0 || frameClipboard.current.length > 0 ? "" : " disabled"}`}
                onClick={handleMenuPaste}
              >
                Paste
              </div>
              <div className="context-menu-item" onClick={handleMenuNewCard}>New Card</div>
              <div className="context-menu-item" onClick={handleMenuNewFrame}>New Frame</div>
            </>
          )}
        </div>
      )}
      {paletteOpen && !presenting && (
        <CommandPalette
          grids={grids}
          activeGridId={activeGridId}
          onClose={() => setPaletteOpen(false)}
          onExecuteAction={executePaletteAction}
          onSwitchGrid={switchGrid}
          onJumpToCard={jumpToCard}
          onJumpToFrame={jumpToFrame}
        />
      )}
      {presenting && (
        <PresentationOverlay
          state={presenting}
          onPrev={presentPrev}
          onNext={presentNext}
          onExit={exitPresentation}
        />
      )}
    </>
  );
}

export default App;
