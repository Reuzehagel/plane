import { MAX_UNDO } from "../constants";
import type { Card, Frame, History, Snapshot } from "../types";

function cloneSnapshot(
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
): Snapshot {
  return {
    cards: cards.map((c) => ({ ...c })),
    selectedCardIds: new Set(selectedCardIds),
    frames: frames.map((f) => ({ ...f })),
    selectedFrameIds: new Set(selectedFrameIds),
  };
}

export function pushSnapshot(
  history: History,
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
): void {
  history.undoStack.push(cloneSnapshot(cards, selectedCardIds, frames, selectedFrameIds));
  if (history.undoStack.length > MAX_UNDO) history.undoStack.shift();
  history.redoStack.length = 0;
}

function restore(
  from: Snapshot[],
  to: Snapshot[],
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
): Snapshot | null {
  if (from.length === 0) return null;
  to.push(cloneSnapshot(cards, selectedCardIds, frames, selectedFrameIds));
  return from.pop()!;
}

export function undo(
  history: History,
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
): Snapshot | null {
  return restore(history.undoStack, history.redoStack, cards, selectedCardIds, frames, selectedFrameIds);
}

export function redo(
  history: History,
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
): Snapshot | null {
  return restore(history.redoStack, history.undoStack, cards, selectedCardIds, frames, selectedFrameIds);
}
