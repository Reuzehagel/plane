export interface Card {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface DragOffset {
  card: Card;
  offsetX: number;
  offsetY: number;
}

export interface DragState {
  offsets: DragOffset[];
}

export interface EditingState {
  cardId: string;
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
}

export interface Point {
  x: number;
  y: number;
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
