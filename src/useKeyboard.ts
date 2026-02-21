import { useEffect, useRef } from "react";
import type { Card, ContextMenuState, EditingState, History, Point, Snapshot } from "./types";
import { undo, redo } from "./history";
import { NUDGE_AMOUNT } from "./constants";
import { snapToGrid } from "./geometry";
import { runMutation } from "./mutation";

const NUDGE_DIR: Record<string, Point> = {
  ArrowLeft:  { x: -NUDGE_AMOUNT, y: 0 },
  ArrowRight: { x:  NUDGE_AMOUNT, y: 0 },
  ArrowUp:    { x: 0, y: -NUDGE_AMOUNT },
  ArrowDown:  { x: 0, y:  NUDGE_AMOUNT },
};

export interface KeyboardDeps {
  contextMenuRef: React.RefObject<ContextMenuState | null>;
  editingRef: React.RefObject<EditingState | null>;
  selectedCardIds: React.RefObject<Set<string>>;
  cards: React.RefObject<Card[]>;
  history: React.RefObject<History>;
  setContextMenu: (v: ContextMenuState | null) => void;
  saveSnapshot: () => void;
  deleteSelectedCards: () => void;
  selectAllCards: () => void;
  applySnapshot: (s: Snapshot) => void;
  fitToContent: () => void;
  copySelectedCards: () => void;
  pasteFromClipboard: () => void;
  scheduleRedraw: () => void;
  markDirty: () => void;
}

export function useKeyboard(deps: KeyboardDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const d = depsRef.current;
      if (d.contextMenuRef.current) {
        if (e.key === "Escape") d.setContextMenu(null);
        return;
      }
      if (d.editingRef.current) return;

      const mod = e.ctrlKey || e.metaKey;

      if ((e.key === "Delete" || e.key === "Backspace") && d.selectedCardIds.current.size > 0) {
        runMutation(d, d.deleteSelectedCards);
        return;
      }

      if (e.key === "a" && mod) {
        d.selectAllCards();
        d.scheduleRedraw();
        e.preventDefault();
        return;
      }

      if (e.key === "z" && mod && !e.shiftKey) {
        const snapshot = undo(d.history.current, d.cards.current, d.selectedCardIds.current);
        if (snapshot) d.applySnapshot(snapshot);
        e.preventDefault();
        return;
      }

      if ((e.key === "z" && mod && e.shiftKey) || (e.key === "y" && mod)) {
        const snapshot = redo(d.history.current, d.cards.current, d.selectedCardIds.current);
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
        d.copySelectedCards();
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
