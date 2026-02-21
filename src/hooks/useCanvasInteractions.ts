import { useEffect, useRef } from "react";
import type { BoxSelectState, Camera, Card, ContextMenuState, DragState, EditingState, Frame, HandleCorner, Point, PresentationState, ResizeState, ResizeTarget } from "../types";
import { mouseToScreen, mouseToWorld, hitTestCards, hitTestRectHandles, hitTestFrames, snapToGrid, snapPoint, lerpSnap, rectsIntersect, getCardsInFrame } from "../lib/geometry";
import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_SENSITIVITY,
  CARD_MIN_WIDTH, CARD_MIN_HEIGHT, CARD_MAX_WIDTH, CARD_MAX_HEIGHT,
  FRAME_MIN_WIDTH, FRAME_MIN_HEIGHT, FRAME_MAX_WIDTH, FRAME_MAX_HEIGHT,
} from "../constants";

const RESIZE_DIR: Record<HandleCorner, { wSign: number; hSign: number; movesX: boolean; movesY: boolean }> = {
  se: { wSign:  1, hSign:  1, movesX: false, movesY: false },
  sw: { wSign: -1, hSign:  1, movesX: true,  movesY: false },
  ne: { wSign:  1, hSign: -1, movesX: false, movesY: true  },
  nw: { wSign: -1, hSign: -1, movesX: true,  movesY: true  },
};

function computeResizeTarget(rs: ResizeState, screenX: number, screenY: number, zoom: number): ResizeTarget {
  const dx = (screenX - rs.startMouseX) / zoom;
  const dy = (screenY - rs.startMouseY) / zoom;
  const dir = RESIZE_DIR[rs.handle];
  const clampedW = Math.max(rs.minW, Math.min(rs.maxW, snapToGrid(rs.startWidth + dx * dir.wSign)));
  const clampedH = Math.max(rs.minH, Math.min(rs.maxH, snapToGrid(rs.startHeight + dy * dir.hSign)));
  return {
    x: dir.movesX ? rs.startX + (rs.startWidth - clampedW) : rs.startX,
    y: dir.movesY ? rs.startY + (rs.startHeight - clampedH) : rs.startY,
    w: clampedW, h: clampedH,
  };
}

const FRAME_BORDER_HIT_THICKNESS = 12;

interface FrameDragState {
  offsets: Array<{
    frame: Frame;
    offsetX: number;
    offsetY: number;
  }>;
  cardOffsets: Array<{
    card: Card;
    offsetX: number;
    offsetY: number;
  }>;
}

export interface InteractionDeps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  camera: React.RefObject<Camera>;
  isPanning: React.RefObject<boolean>;
  lastMouse: React.RefObject<Point>;
  cards: React.RefObject<Card[]>;
  dragState: React.RefObject<DragState | null>;
  resizeState: React.RefObject<ResizeState | null>;
  selectedCardIds: React.RefObject<Set<string>>;
  boxSelect: React.RefObject<BoxSelectState | null>;
  dragSnapTargets: React.RefObject<Map<string, Point>>;
  dragRafId: React.RefObject<number>;
  resizeTarget: React.RefObject<ResizeTarget | null>;
  resizeRafId: React.RefObject<number>;
  spaceHeld: React.RefObject<boolean>;
  editingRef: React.RefObject<EditingState | null>;
  contextMenuRef: React.RefObject<ContextMenuState | null>;
  cardScrollOffsets: React.RefObject<Map<string, number>>;
  frames: React.RefObject<Frame[]>;
  selectedFrameIds: React.RefObject<Set<string>>;
  presentingRef: React.RefObject<PresentationState | null>;
  draw: () => void;
  scheduleRedraw: () => void;
  saveSnapshot: () => void;
  markDirty: () => void;
  selectCard: (cardId: string) => void;
  openEditor: (card: Card) => void;
  createAndStartEditingCardAt: (wx: number, wy: number) => void;
  setContextMenu: (v: ContextMenuState | null) => void;
  syncEditorPosition: () => void;
  getCardMaxScroll: (cardId: string) => number;
  startEditingFrameLabel: (frame: Frame) => void;
}

export function useCanvasInteractions(deps: InteractionDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const canvasEl = depsRef.current.canvasRef.current;
    if (!canvasEl) return;
    // Re-bind so nested closures see the narrowed non-null type
    const canvas: HTMLCanvasElement = canvasEl;

    // Stable ref aliases — these never change identity
    const cameraRef = depsRef.current.camera;
    const isPanningRef = depsRef.current.isPanning;
    const lastMouseRef = depsRef.current.lastMouse;
    const cardsRef = depsRef.current.cards;
    const dragStateRef = depsRef.current.dragState;
    const resizeStateRef = depsRef.current.resizeState;
    const selectedCardIdsRef = depsRef.current.selectedCardIds;
    const boxSelectRef = depsRef.current.boxSelect;
    const dragSnapTargetsRef = depsRef.current.dragSnapTargets;
    const dragRafIdRef = depsRef.current.dragRafId;
    const resizeTargetRef = depsRef.current.resizeTarget;
    const resizeRafIdRef = depsRef.current.resizeRafId;
    const spaceHeldRef = depsRef.current.spaceHeld;
    const editingRef = depsRef.current.editingRef;
    const contextMenuRef = depsRef.current.contextMenuRef;
    const cardScrollOffsetsRef = depsRef.current.cardScrollOffsets;
    const framesRef = depsRef.current.frames;
    const selectedFrameIdsRef = depsRef.current.selectedFrameIds;
    const presentingRef = depsRef.current.presentingRef;

    // Frame interaction state
    const frameDragState = { current: null as FrameDragState | null };
    const frameDragSnapTargets = { current: new Map<string, Point>() };
    const frameDragCardSnapTargets = { current: new Map<string, Point>() };
    const frameDragRafId = { current: 0 };

    let canvasRect = canvas.getBoundingClientRect();

    function animateDrag(): void {
      if (!dragStateRef.current) return;
      for (const entry of dragStateRef.current.offsets) {
        const target = dragSnapTargetsRef.current.get(entry.card.id);
        if (!target) continue;
        entry.card.x = lerpSnap(entry.card.x, target.x);
        entry.card.y = lerpSnap(entry.card.y, target.y);
      }
      depsRef.current.draw();
      dragRafIdRef.current = requestAnimationFrame(animateDrag);
    }

    function animateResize(): void {
      if (!resizeStateRef.current) return;
      const t = resizeTargetRef.current;
      if (t) {
        const item = resizeStateRef.current.item;
        item.x = lerpSnap(item.x, t.x);
        item.y = lerpSnap(item.y, t.y);
        item.width = lerpSnap(item.width, t.w);
        item.height = lerpSnap(item.height, t.h);
        depsRef.current.draw();
      }
      resizeRafIdRef.current = requestAnimationFrame(animateResize);
    }

    function animateFrameDrag(): void {
      if (!frameDragState.current) return;
      for (const entry of frameDragState.current.offsets) {
        const target = frameDragSnapTargets.current.get(entry.frame.id);
        if (!target) continue;
        entry.frame.x = lerpSnap(entry.frame.x, target.x);
        entry.frame.y = lerpSnap(entry.frame.y, target.y);
      }
      for (const entry of frameDragState.current.cardOffsets) {
        const target = frameDragCardSnapTargets.current.get(entry.card.id);
        if (!target) continue;
        entry.card.x = lerpSnap(entry.card.x, target.x);
        entry.card.y = lerpSnap(entry.card.y, target.y);
      }
      depsRef.current.draw();
      frameDragRafId.current = requestAnimationFrame(animateFrameDrag);
    }

    function resize(): void {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      canvasRect = canvas.getBoundingClientRect();
      depsRef.current.scheduleRedraw();
    }

    function handleCursor(handle: HandleCorner): string {
      return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
    }

    function updateCursor(e: MouseEvent): void {
      if (editingRef.current) return;
      if (resizeStateRef.current) {
        canvas.style.cursor = handleCursor(resizeStateRef.current.handle);
        return;
      }
      if (dragStateRef.current || frameDragState.current || isPanningRef.current) {
        canvas.style.cursor = "grabbing";
        return;
      }
      if (spaceHeldRef.current) {
        canvas.style.cursor = "grab";
        return;
      }
      const { x: sx, y: sy } = mouseToScreen(e, canvasRect);
      const handleHit = hitTestRectHandles(sx, sy, cardsRef.current, selectedCardIdsRef.current, cameraRef.current)
        ?? hitTestRectHandles(sx, sy, framesRef.current, selectedFrameIdsRef.current, cameraRef.current);
      if (handleHit) {
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }
      canvas.style.cursor = "default";
    }

    function onContextMenu(e: MouseEvent): void {
      e.preventDefault();
      if (editingRef.current) return;
      if (presentingRef.current) return;
      const world = mouseToWorld(e, canvasRect, cameraRef.current);
      const hit = hitTestCards(world.x, world.y, cardsRef.current);

      if (hit) {
        if (!selectedCardIdsRef.current.has(hit.id)) {
          depsRef.current.selectCard(hit.id);
          selectedFrameIdsRef.current.clear();
          depsRef.current.scheduleRedraw();
        }
        depsRef.current.setContextMenu({
          screenX: e.clientX, screenY: e.clientY,
          worldX: world.x, worldY: world.y,
          cardId: hit.id, frameId: null,
        });
        return;
      }

      const frameHit = hitTestFrames(world.x, world.y, framesRef.current, FRAME_BORDER_HIT_THICKNESS / cameraRef.current.zoom);
      if (frameHit) {
        if (!selectedFrameIdsRef.current.has(frameHit.id)) {
          selectedFrameIdsRef.current.clear();
          selectedFrameIdsRef.current.add(frameHit.id);
          selectedCardIdsRef.current.clear();
          depsRef.current.scheduleRedraw();
        }
        depsRef.current.setContextMenu({
          screenX: e.clientX, screenY: e.clientY,
          worldX: world.x, worldY: world.y,
          cardId: null, frameId: frameHit.id,
        });
        return;
      }

      depsRef.current.setContextMenu({
        screenX: e.clientX, screenY: e.clientY,
        worldX: world.x, worldY: world.y,
        cardId: null, frameId: null,
      });
    }

    function startPanning(e: MouseEvent): void {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
    }

    function onMouseDown(e: MouseEvent): void {
      // Block interactions during presentation
      if (presentingRef.current) return;

      // Allow middle-click panning even while editing
      if (e.button === 1) {
        startPanning(e);
        e.preventDefault();
        return;
      }

      if (editingRef.current) return;

      if (contextMenuRef.current) {
        depsRef.current.setContextMenu(null);
        return;
      }

      if (e.button !== 0) return;

      if (spaceHeldRef.current) {
        startPanning(e);
        return;
      }

      const { x: sx, y: sy } = mouseToScreen(e, canvasRect);

      // Card handles first
      const handleHit = hitTestRectHandles(sx, sy, cardsRef.current, selectedCardIdsRef.current, cameraRef.current);
      if (handleHit) {
        depsRef.current.saveSnapshot();
        resizeStateRef.current = {
          item: handleHit.item,
          handle: handleHit.handle,
          startMouseX: sx,
          startMouseY: sy,
          startX: handleHit.item.x,
          startY: handleHit.item.y,
          startWidth: handleHit.item.width,
          startHeight: handleHit.item.height,
          minW: CARD_MIN_WIDTH, minH: CARD_MIN_HEIGHT,
          maxW: CARD_MAX_WIDTH, maxH: CARD_MAX_HEIGHT,
        };
        resizeRafIdRef.current = requestAnimationFrame(animateResize);
        canvas.style.cursor = handleCursor(handleHit.handle);
        return;
      }

      // Frame handles
      const frameHandleHit = hitTestRectHandles(sx, sy, framesRef.current, selectedFrameIdsRef.current, cameraRef.current);
      if (frameHandleHit) {
        depsRef.current.saveSnapshot();
        resizeStateRef.current = {
          item: frameHandleHit.item,
          handle: frameHandleHit.handle,
          startMouseX: sx,
          startMouseY: sy,
          startX: frameHandleHit.item.x,
          startY: frameHandleHit.item.y,
          startWidth: frameHandleHit.item.width,
          startHeight: frameHandleHit.item.height,
          minW: FRAME_MIN_WIDTH, minH: FRAME_MIN_HEIGHT,
          maxW: FRAME_MAX_WIDTH, maxH: FRAME_MAX_HEIGHT,
        };
        resizeRafIdRef.current = requestAnimationFrame(animateResize);
        canvas.style.cursor = handleCursor(frameHandleHit.handle);
        return;
      }

      const world = mouseToWorld(e, canvasRect, cameraRef.current);

      // Cards
      const hit = hitTestCards(world.x, world.y, cardsRef.current);
      if (hit) {
        if (e.shiftKey) {
          const sel = selectedCardIdsRef.current;
          if (sel.has(hit.id)) sel.delete(hit.id);
          else sel.add(hit.id);
          depsRef.current.scheduleRedraw();
          return;
        }

        if (!selectedCardIdsRef.current.has(hit.id)) {
          depsRef.current.selectCard(hit.id);
          selectedFrameIdsRef.current.clear();
        }
        depsRef.current.saveSnapshot();
        const offsets: DragState["offsets"] = [];
        const rest: Card[] = [];
        const selected: Card[] = [];
        for (const c of cardsRef.current) {
          if (selectedCardIdsRef.current.has(c.id)) {
            selected.push(c);
            offsets.push({ card: c, offsetX: world.x - c.x, offsetY: world.y - c.y });
          } else {
            rest.push(c);
          }
        }
        dragStateRef.current = { offsets };
        cardsRef.current = [...rest, ...selected];
        dragRafIdRef.current = requestAnimationFrame(animateDrag);
        depsRef.current.scheduleRedraw();
        canvas.style.cursor = "grabbing";
        return;
      }

      // Frame border/label
      const frameHit = hitTestFrames(world.x, world.y, framesRef.current, FRAME_BORDER_HIT_THICKNESS / cameraRef.current.zoom);
      if (frameHit) {
        if (e.shiftKey) {
          const sel = selectedFrameIdsRef.current;
          if (sel.has(frameHit.id)) sel.delete(frameHit.id);
          else sel.add(frameHit.id);
          depsRef.current.scheduleRedraw();
          return;
        }

        if (!selectedFrameIdsRef.current.has(frameHit.id)) {
          selectedFrameIdsRef.current.clear();
          selectedFrameIdsRef.current.add(frameHit.id);
          selectedCardIdsRef.current.clear();
        }
        depsRef.current.saveSnapshot();
        const offsets: FrameDragState["offsets"] = [];
        for (const f of framesRef.current) {
          if (selectedFrameIdsRef.current.has(f.id)) {
            offsets.push({ frame: f, offsetX: world.x - f.x, offsetY: world.y - f.y });
          }
        }
        // Collect cards contained in selected frames
        const containedCardIds = new Set<string>();
        const cardOffsets: FrameDragState["cardOffsets"] = [];
        for (const entry of offsets) {
          for (const card of getCardsInFrame(entry.frame, cardsRef.current)) {
            if (!containedCardIds.has(card.id)) {
              containedCardIds.add(card.id);
              cardOffsets.push({ card, offsetX: world.x - card.x, offsetY: world.y - card.y });
            }
          }
        }
        frameDragState.current = { offsets, cardOffsets };
        frameDragRafId.current = requestAnimationFrame(animateFrameDrag);
        depsRef.current.scheduleRedraw();
        canvas.style.cursor = "grabbing";
        return;
      }

      // Empty space: box select
      if (!e.shiftKey) {
        selectedCardIdsRef.current.clear();
        selectedFrameIdsRef.current.clear();
      }
      boxSelectRef.current = { start: world, current: world };
      depsRef.current.scheduleRedraw();
    }

    function onMouseMove(e: MouseEvent): void {
      if (resizeStateRef.current) {
        const { x: sx, y: sy } = mouseToScreen(e, canvasRect);
        resizeTargetRef.current = computeResizeTarget(resizeStateRef.current, sx, sy, cameraRef.current.zoom);
        return;
      }

      if (boxSelectRef.current) {
        const world = mouseToWorld(e, canvasRect, cameraRef.current);
        boxSelectRef.current.current = world;
        depsRef.current.scheduleRedraw();
        return;
      }

      if (dragStateRef.current) {
        const world = mouseToWorld(e, canvasRect, cameraRef.current);
        for (const entry of dragStateRef.current.offsets) {
          dragSnapTargetsRef.current.set(entry.card.id, snapPoint(world.x - entry.offsetX, world.y - entry.offsetY));
        }
        return;
      }

      if (frameDragState.current) {
        const world = mouseToWorld(e, canvasRect, cameraRef.current);
        for (const entry of frameDragState.current.offsets) {
          frameDragSnapTargets.current.set(entry.frame.id, snapPoint(world.x - entry.offsetX, world.y - entry.offsetY));
        }
        for (const entry of frameDragState.current.cardOffsets) {
          frameDragCardSnapTargets.current.set(entry.card.id, snapPoint(world.x - entry.offsetX, world.y - entry.offsetY));
        }
        return;
      }

      if (isPanningRef.current) {
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        cameraRef.current.x += dx / cameraRef.current.zoom;
        cameraRef.current.y += dy / cameraRef.current.zoom;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        depsRef.current.scheduleRedraw();
        if (editingRef.current) depsRef.current.syncEditorPosition();
        return;
      }

      updateCursor(e);
    }

    function onMouseUp(e: MouseEvent): void {
      if (e.button !== 0 && e.button !== 1) return;
      if (boxSelectRef.current) {
        const { start, current } = boxSelectRef.current;
        const bx = Math.min(start.x, current.x);
        const by = Math.min(start.y, current.y);
        const bw = Math.max(start.x, current.x) - bx;
        const bh = Math.max(start.y, current.y) - by;
        for (const card of cardsRef.current) {
          if (rectsIntersect(card.x, card.y, card.width, card.height, bx, by, bw, bh)) {
            selectedCardIdsRef.current.add(card.id);
          }
        }
        for (const frame of framesRef.current) {
          if (rectsIntersect(frame.x, frame.y, frame.width, frame.height, bx, by, bw, bh)) {
            selectedFrameIdsRef.current.add(frame.id);
          }
        }
        boxSelectRef.current = null;
        depsRef.current.scheduleRedraw();
      }
      if (dragStateRef.current) {
        cancelAnimationFrame(dragRafIdRef.current);
        for (const entry of dragStateRef.current.offsets) {
          const target = dragSnapTargetsRef.current.get(entry.card.id)
            ?? snapPoint(entry.card.x, entry.card.y);
          entry.card.x = target.x;
          entry.card.y = target.y;
        }
        dragSnapTargetsRef.current.clear();
        depsRef.current.scheduleRedraw();
      }
      if (frameDragState.current) {
        cancelAnimationFrame(frameDragRafId.current);
        for (const entry of frameDragState.current.offsets) {
          const target = frameDragSnapTargets.current.get(entry.frame.id)
            ?? snapPoint(entry.frame.x, entry.frame.y);
          entry.frame.x = target.x;
          entry.frame.y = target.y;
        }
        for (const entry of frameDragState.current.cardOffsets) {
          const target = frameDragCardSnapTargets.current.get(entry.card.id)
            ?? snapPoint(entry.card.x, entry.card.y);
          entry.card.x = target.x;
          entry.card.y = target.y;
        }
        frameDragSnapTargets.current.clear();
        frameDragCardSnapTargets.current.clear();
        depsRef.current.scheduleRedraw();
      }
      if (resizeStateRef.current) {
        cancelAnimationFrame(resizeRafIdRef.current);
        const t = resizeTargetRef.current;
        if (t) {
          const item = resizeStateRef.current.item;
          item.x = t.x;
          item.y = t.y;
          item.width = t.w;
          item.height = t.h;
          resizeTargetRef.current = null;
        }
        depsRef.current.scheduleRedraw();
      }
      const wasInteracting = !!(resizeStateRef.current || dragStateRef.current || isPanningRef.current || frameDragState.current);
      resizeStateRef.current = null;
      dragStateRef.current = null;
      frameDragState.current = null;
      isPanningRef.current = false;
      canvas.style.cursor = spaceHeldRef.current ? "grab" : "default";
      updateCursor(e);
      if (wasInteracting) depsRef.current.markDirty();
    }

    function onDblClick(e: MouseEvent): void {
      if (editingRef.current) return;
      if (presentingRef.current) return;
      const world = mouseToWorld(e, canvasRect, cameraRef.current);
      const hit = hitTestCards(world.x, world.y, cardsRef.current);

      if (hit) {
        depsRef.current.openEditor(hit);
        return;
      }

      // Double-click on frame label → edit label
      const frameHit = hitTestFrames(world.x, world.y, framesRef.current, FRAME_BORDER_HIT_THICKNESS / cameraRef.current.zoom);
      if (frameHit) {
        depsRef.current.startEditingFrameLabel(frameHit);
        return;
      }

      depsRef.current.createAndStartEditingCardAt(world.x, world.y);
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      if (contextMenuRef.current) depsRef.current.setContextMenu(null);

      // In presentation mode, only allow card content scrolling
      if (presentingRef.current) {
        const world = mouseToWorld(e, canvasRect, cameraRef.current);
        const hit = hitTestCards(world.x, world.y, cardsRef.current);
        if (hit) {
          const maxScroll = depsRef.current.getCardMaxScroll(hit.id);
          if (maxScroll > 0) {
            const current = cardScrollOffsetsRef.current.get(hit.id) ?? 0;
            const newOffset = Math.max(0, Math.min(maxScroll, current + e.deltaY * 0.5));
            cardScrollOffsetsRef.current.set(hit.id, newOffset);
            depsRef.current.scheduleRedraw();
          }
        }
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+scroll → zoom
        const { zoom } = cameraRef.current;
        const delta = -e.deltaY * ZOOM_SENSITIVITY;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));

        const { x: mx, y: my } = mouseToScreen(e, canvasRect);

        cameraRef.current.x += mx / newZoom - mx / zoom;
        cameraRef.current.y += my / newZoom - my / zoom;
        cameraRef.current.zoom = newZoom;

        depsRef.current.scheduleRedraw();
        depsRef.current.markDirty();
        if (editingRef.current) depsRef.current.syncEditorPosition();
        return;
      }

      // Regular scroll → scroll selected card text if hovering one with overflow
      if (!editingRef.current) {
        const world = mouseToWorld(e, canvasRect, cameraRef.current);
        const hit = hitTestCards(world.x, world.y, cardsRef.current);
        if (hit && selectedCardIdsRef.current.has(hit.id)) {
          const maxScroll = depsRef.current.getCardMaxScroll(hit.id);
          if (maxScroll > 0) {
            const current = cardScrollOffsetsRef.current.get(hit.id) ?? 0;
            const newOffset = Math.max(0, Math.min(maxScroll, current + e.deltaY * 0.5));
            cardScrollOffsetsRef.current.set(hit.id, newOffset);
            depsRef.current.scheduleRedraw();
            return;
          }
        }
      }

      // Default: pan canvas
      const { zoom } = cameraRef.current;
      cameraRef.current.x -= e.deltaX / zoom;
      if (e.shiftKey) {
        cameraRef.current.x -= e.deltaY / zoom;
      } else {
        cameraRef.current.y -= e.deltaY / zoom;
      }
      depsRef.current.scheduleRedraw();
      depsRef.current.markDirty();
      if (editingRef.current) depsRef.current.syncEditorPosition();
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.code === "Space" && !editingRef.current) {
        spaceHeldRef.current = true;
        if (!isPanningRef.current) canvas.style.cursor = "grab";
        e.preventDefault();
      }
    }

    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        if (!isPanningRef.current) canvas.style.cursor = "default";
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
      cancelAnimationFrame(dragRafIdRef.current);
      cancelAnimationFrame(resizeRafIdRef.current);
      cancelAnimationFrame(frameDragRafId.current);
    };
  }, []);
}
