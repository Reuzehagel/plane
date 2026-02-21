import { MAX_UNDO } from "../constants";
import type { Card, Connection, Frame, History, Snapshot } from "../types";

function cloneSnapshot(
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
  connections: Connection[],
  selectedConnectionIds: Set<string>,
): Snapshot {
  return {
    cards: cards.map((c) => ({ ...c })),
    selectedCardIds: new Set(selectedCardIds),
    frames: frames.map((f) => ({ ...f })),
    selectedFrameIds: new Set(selectedFrameIds),
    connections: connections.map((c) => ({ ...c })),
    selectedConnectionIds: new Set(selectedConnectionIds),
  };
}

export function pushSnapshot(
  history: History,
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
  connections: Connection[],
  selectedConnectionIds: Set<string>,
): void {
  history.undoStack.push(cloneSnapshot(cards, selectedCardIds, frames, selectedFrameIds, connections, selectedConnectionIds));
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
  connections: Connection[],
  selectedConnectionIds: Set<string>,
): Snapshot | null {
  if (from.length === 0) return null;
  to.push(cloneSnapshot(cards, selectedCardIds, frames, selectedFrameIds, connections, selectedConnectionIds));
  return from.pop()!;
}

export function undo(
  history: History,
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
  connections: Connection[],
  selectedConnectionIds: Set<string>,
): Snapshot | null {
  return restore(history.undoStack, history.redoStack, cards, selectedCardIds, frames, selectedFrameIds, connections, selectedConnectionIds);
}

export function redo(
  history: History,
  cards: Card[],
  selectedCardIds: Set<string>,
  frames: Frame[],
  selectedFrameIds: Set<string>,
  connections: Connection[],
  selectedConnectionIds: Set<string>,
): Snapshot | null {
  return restore(history.redoStack, history.undoStack, cards, selectedCardIds, frames, selectedFrameIds, connections, selectedConnectionIds);
}
