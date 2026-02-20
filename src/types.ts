export interface Point {
  x: number;
  y: number;
}

export interface Card {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

export interface Camera extends Point {
  zoom: number;
}

export interface DragState {
  offsets: Array<{
    card: Card;
    offsetX: number;
    offsetY: number;
  }>;
}

export interface EditingState {
  cardId: string;
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
}

export interface BoxSelectState {
  start: Point;
  current: Point;
}

export interface Snapshot {
  cards: Card[];
  selectedCardIds: Set<string>;
}

export interface History {
  undoStack: Snapshot[];
  redoStack: Snapshot[];
}

export interface ContextMenuState {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  cardId: string | null;
}

export type HandleCorner = "nw" | "ne" | "sw" | "se";

export interface ResizeState {
  card: Card;
  handle: HandleCorner;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}
