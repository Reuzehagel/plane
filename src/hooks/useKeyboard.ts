import { useEffect, useRef } from "react";
import type { Card, ContextMenuState, EditingState, Frame, History, PresentationState, Snapshot } from "../types";
import { undo, redo } from "../lib/history";
import { NUDGE_AMOUNT } from "../constants";
import { snapToGrid } from "../lib/geometry";
import { runMutation } from "../lib/mutation";

const NUDGE_DIR: Record<string, { x: number; y: number }> = {
  ArrowLeft:  { x: -NUDGE_AMOUNT, y: 0 },
  ArrowRight: { x:  NUDGE_AMOUNT, y: 0 },
  ArrowUp:    { x: 0, y: -NUDGE_AMOUNT },
  ArrowDown:  { x: 0, y:  NUDGE_AMOUNT },
};

export interface KeyboardDeps {
  contextMenuRef: React.RefObject<ContextMenuState | null>;
  editingRef: React.RefObject<EditingState | null>;
  paletteOpenRef: React.RefObject<boolean>;
  selectedCardIds: React.RefObject<Set<string>>;
  cards: React.RefObject<Card[]>;
  history: React.RefObject<History>;
  frames: React.RefObject<Frame[]>;
  selectedFrameIds: React.RefObject<Set<string>>;
  presentingRef: React.RefObject<PresentationState | null>;
  editingFrameLabelRef: React.RefObject<string | null>;
  setContextMenu: (v: ContextMenuState | null) => void;
  saveSnapshot: () => void;
  deleteSelectedCards: () => void;
  deleteSelectedFrames: () => void;
  selectAllCards: () => void;
  applySnapshot: (s: Snapshot) => void;
  fitToContent: () => void;
  copySelectedCards: () => void;
  copySelectedFrames: () => void;
  pasteFromClipboard: () => void;
  togglePalette: () => void;
  startPresentation: () => void;
  presentNext: () => void;
  presentPrev: () => void;
  exitPresentation: () => void;
  scheduleRedraw: () => void;
  markDirty: () => void;
}

export function useKeyboard(deps: KeyboardDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const d = depsRef.current;
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "k" && mod) { e.preventDefault(); d.togglePalette(); return; }

      // Presentation mode shortcuts
      if (d.presentingRef.current) {
        if (e.key === "Escape") { d.exitPresentation(); e.preventDefault(); return; }
        if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { d.presentNext(); e.preventDefault(); return; }
        if (e.key === "ArrowLeft") { d.presentPrev(); e.preventDefault(); return; }
        return;
      }

      // Don't intercept keys when typing in an input/textarea (sidebar rename, frame label, etc.)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (d.contextMenuRef.current) {
        if (e.key === "Escape") d.setContextMenu(null);
        return;
      }
      if (d.editingRef.current) return;
      if (d.editingFrameLabelRef.current) return;
      if (d.paletteOpenRef.current) return;

      if (e.key === "F5") {
        d.startPresentation();
        e.preventDefault();
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace")) {
        if (d.selectedCardIds.current.size > 0 || d.selectedFrameIds.current.size > 0) {
          runMutation(d, () => {
            if (d.selectedCardIds.current.size > 0) d.deleteSelectedCards();
            if (d.selectedFrameIds.current.size > 0) d.deleteSelectedFrames();
          });
          return;
        }
      }

      if (e.key === "a" && mod) {
        d.selectAllCards();
        d.scheduleRedraw();
        e.preventDefault();
        return;
      }

      if (e.key === "z" && mod && !e.shiftKey) {
        const snapshot = undo(d.history.current, d.cards.current, d.selectedCardIds.current, d.frames.current, d.selectedFrameIds.current);
        if (snapshot) d.applySnapshot(snapshot);
        e.preventDefault();
        return;
      }

      if ((e.key === "z" && mod && e.shiftKey) || (e.key === "y" && mod)) {
        const snapshot = redo(d.history.current, d.cards.current, d.selectedCardIds.current, d.frames.current, d.selectedFrameIds.current);
        if (snapshot) d.applySnapshot(snapshot);
        e.preventDefault();
        return;
      }

      if (e.key === "1" && mod) {
        d.fitToContent();
        e.preventDefault();
        return;
      }

      if (e.key === "c" && mod) {
        if (d.selectedFrameIds.current.size > 0) {
          d.copySelectedFrames();
        } else {
          d.copySelectedCards();
        }
        e.preventDefault();
        return;
      }

      if (e.key === "v" && mod) {
        d.pasteFromClipboard();
        e.preventDefault();
        return;
      }

      const offset = NUDGE_DIR[e.key];
      if (offset && d.selectedCardIds.current.size > 0) {
        runMutation(d, () => {
          for (const card of d.cards.current) {
            if (d.selectedCardIds.current.has(card.id)) {
              card.x = snapToGrid(card.x + offset.x);
              card.y = snapToGrid(card.y + offset.y);
            }
          }
        });
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
