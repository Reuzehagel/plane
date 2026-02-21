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
  text: string;
  color: string;
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

export interface Frame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  order: number;
}

export interface FrameSummary {
  id: string;
  label: string;
  order: number;
}

export interface PresentationState {
  frameIndex: number;
  frames: Frame[];
  savedCamera: Camera;
}

export interface Snapshot {
  cards: Card[];
  selectedCardIds: Set<string>;
  frames: Frame[];
  selectedFrameIds: Set<string>;
  connections: Connection[];
  selectedConnectionIds: Set<string>;
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
  frameId: string | null;
  connectionId: string | null;
}

export type AnchorPosition = "top" | "bottom" | "left" | "right";

export interface Connection {
  id: string;
  fromCardId: string;
  toCardId: string;
  fromAnchor: AnchorPosition;
  toAnchor: AnchorPosition;
  color: string;
  label?: string;
}

export interface ConnectionDragState {
  fromCardId: string;
  fromAnchor: AnchorPosition;
  currentWorld: Point;
  snapTarget: { cardId: string; anchor: AnchorPosition } | null;
}

export type HandleCorner = "nw" | "ne" | "sw" | "se";

export interface ResizeState {
  item: { x: number; y: number; width: number; height: number };
  handle: HandleCorner;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
}

export interface ResizeTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Grid {
  id: string;
  name: string;
  cards: Card[];
  frames: Frame[];
  connections: Connection[];
  camera: Camera;
}

export interface GridSummary {
  id: string;
  name: string;
  cardCount: number;
}

export interface PaletteActionItem {
  kind: "action";
  id: string;
  label: string;
  shortcut?: string;
}

export interface PaletteGridItem {
  kind: "grid";
  id: string;
  label: string;
  isActive: boolean;
  cardCount: number;
}

export interface PaletteCardItem {
  kind: "card";
  id: string;
  gridId: string;
  gridName: string;
  label: string;
  body: string;
  color: string;
}

export interface PaletteFrameItem {
  kind: "frame";
  id: string;
  gridId: string;
  gridName: string;
  label: string;
  order: number;
}

export type PaletteItem = PaletteActionItem | PaletteGridItem | PaletteCardItem | PaletteFrameItem;

export type ActiveTool = "pointer" | "connection";
