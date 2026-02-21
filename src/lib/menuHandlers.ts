import type React from "react";
import type { Card, ContextMenuState, Frame } from "../types";
import { CARD_WIDTH, DUPLICATE_OFFSET, FRAME_DEFAULT_WIDTH, FRAME_DEFAULT_HEIGHT } from "../constants";
import { snapPoint } from "./geometry";
import { runMutation } from "./mutation";

export interface MenuHandlerDeps {
  contextMenu: ContextMenuState | null;
  selectedCardIds: React.RefObject<Set<string>>;
  clipboard: React.RefObject<Card[]>;
  frameClipboard: React.RefObject<Frame[]>;
  findCard: (id: string) => Card | undefined;
  removeCard: (id: string) => void;
  deleteSelectedCards: () => void;
  createCard: (x: number, y: number, w: number, h: number, text: string, color?: string) => Card;
  recalculateCardHeight: (card: Card) => void;
  insertCard: (card: Card) => void;
  openEditor: (card: Card) => void;
  createAndStartEditingCardAt: (worldX: number, worldY: number) => void;
  copySelectedCards: () => void;
  pasteCardsAtPoint: (sources: Card[], worldX: number, worldY: number) => void;
  saveSnapshot: () => void;
  setContextMenu: (v: ContextMenuState | null) => void;
  scheduleRedraw: () => void;
  markDirty: () => void;
  frames: React.RefObject<Frame[]>;
  createFrame: (x: number, y: number, w: number, h: number, label: string) => Frame;
  insertFrame: (frame: Frame) => void;
  removeFrame: (id: string) => void;
  findFrame: (id: string) => Frame | undefined;
  selectedFrameIds: React.RefObject<Set<string>>;
  startEditingFrameLabel: (frame: Frame) => void;
  deleteSelectedFrames: () => void;
  copySelectedFrames: () => void;
  pasteFramesAtPoint: (sources: Frame[], worldX: number, worldY: number) => void;
}

export interface MenuHandlers {
  handleMenuEdit: () => void;
  handleMenuDuplicate: () => void;
  handleMenuCopy: () => void;
  handleMenuResetSize: () => void;
  handleMenuDelete: () => void;
  handleMenuPaste: () => void;
  handleMenuNewCard: () => void;
  handleMenuChangeColor: (color: string) => void;
  handleMenuNewFrame: () => void;
  handleMenuRenameFrame: () => void;
  handleMenuDeleteFrame: () => void;
  handleMenuDuplicateFrame: () => void;
  handleMenuCopyFrame: () => void;
}

function getMenuCard(deps: MenuHandlerDeps): Card | undefined {
  if (!deps.contextMenu?.cardId) return undefined;
  return deps.findCard(deps.contextMenu.cardId);
}

function closeMenu(deps: MenuHandlerDeps): void {
  deps.setContextMenu(null);
}

function runMenuAction(deps: MenuHandlerDeps, action: () => void): void {
  runMutation(deps, action);
  closeMenu(deps);
}

export function createMenuHandlers(deps: MenuHandlerDeps): MenuHandlers {
  function handleMenuEdit(): void {
    const card = getMenuCard(deps);
    if (!card) return;
    closeMenu(deps);
    deps.openEditor(card);
  }

  function handleMenuDuplicate(): void {
    const card = getMenuCard(deps);
    if (!card) return;
    runMenuAction(deps, () => {
      const pos = snapPoint(card.x + DUPLICATE_OFFSET, card.y + DUPLICATE_OFFSET);
      const clone = deps.createCard(pos.x, pos.y, card.width, card.height, card.text, card.color);
      deps.insertCard(clone);
    });
  }

  function handleMenuCopy(): void {
    const cardId = deps.contextMenu?.cardId;
    if (!cardId) return;
    if (deps.selectedCardIds.current.has(cardId)) {
      deps.copySelectedCards();
    } else {
      const card = deps.findCard(cardId);
      if (card) deps.clipboard.current = [{ ...card }];
    }
    closeMenu(deps);
  }

  function handleMenuResetSize(): void {
    const card = getMenuCard(deps);
    if (!card) return;
    runMenuAction(deps, () => {
      card.width = CARD_WIDTH;
      deps.recalculateCardHeight(card);
    });
  }

  function handleMenuDelete(): void {
    const cardId = deps.contextMenu?.cardId;
    if (!cardId) return;
    runMenuAction(deps, () => {
      if (deps.selectedCardIds.current.has(cardId)) {
        deps.deleteSelectedCards();
      } else {
        deps.removeCard(cardId);
      }
    });
  }

  function handleMenuPaste(): void {
    if (!deps.contextMenu) return;
    const { worldX, worldY } = deps.contextMenu;
    if (deps.frameClipboard.current.length > 0) {
      closeMenu(deps);
      deps.pasteFramesAtPoint(deps.frameClipboard.current, worldX, worldY);
    } else if (deps.clipboard.current.length > 0) {
      closeMenu(deps);
      deps.pasteCardsAtPoint(deps.clipboard.current, worldX, worldY);
    }
  }

  function handleMenuNewCard(): void {
    if (!deps.contextMenu) return;
    const { worldX, worldY } = deps.contextMenu;
    closeMenu(deps);
    deps.createAndStartEditingCardAt(worldX, worldY);
  }

  function handleMenuChangeColor(color: string): void {
    const card = getMenuCard(deps);
    if (!card) return;
    runMenuAction(deps, () => {
      card.color = color;
    });
  }

  function handleMenuNewFrame(): void {
    if (!deps.contextMenu) return;
    const { worldX, worldY } = deps.contextMenu;
    runMenuAction(deps, () => {
      const snap = snapPoint(worldX - FRAME_DEFAULT_WIDTH / 2, worldY - FRAME_DEFAULT_HEIGHT / 2);
      const nextOrder = deps.frames.current.length > 0
        ? Math.max(...deps.frames.current.map((f) => f.order)) + 1
        : 1;
      const label = `Frame ${nextOrder}`;
      const frame = deps.createFrame(snap.x, snap.y, FRAME_DEFAULT_WIDTH, FRAME_DEFAULT_HEIGHT, label);
      frame.order = nextOrder;
      deps.insertFrame(frame);
    });
  }

  function handleMenuRenameFrame(): void {
    const frameId = deps.contextMenu?.frameId;
    if (!frameId) return;
    const frame = deps.findFrame(frameId);
    if (!frame) return;
    closeMenu(deps);
    deps.startEditingFrameLabel(frame);
  }

  function handleMenuDeleteFrame(): void {
    const frameId = deps.contextMenu?.frameId;
    if (!frameId) return;
    runMenuAction(deps, () => {
      if (deps.selectedFrameIds.current.has(frameId)) {
        deps.deleteSelectedFrames();
      } else {
        deps.removeFrame(frameId);
      }
    });
  }

  function handleMenuDuplicateFrame(): void {
    const frameId = deps.contextMenu?.frameId;
    if (!frameId) return;
    const frame = deps.findFrame(frameId);
    if (!frame) return;
    runMenuAction(deps, () => {
      const pos = snapPoint(frame.x + DUPLICATE_OFFSET, frame.y + DUPLICATE_OFFSET);
      const clone = deps.createFrame(pos.x, pos.y, frame.width, frame.height, frame.label);
      deps.insertFrame(clone);
    });
  }

  function handleMenuCopyFrame(): void {
    const frameId = deps.contextMenu?.frameId;
    if (!frameId) return;
    if (deps.selectedFrameIds.current.has(frameId)) {
      deps.copySelectedFrames();
    } else {
      const frame = deps.findFrame(frameId);
      if (frame) {
        deps.frameClipboard.current = [{ ...frame }];
        deps.clipboard.current = [];
      }
    }
    closeMenu(deps);
  }

  return {
    handleMenuEdit,
    handleMenuDuplicate,
    handleMenuCopy,
    handleMenuResetSize,
    handleMenuDelete,
    handleMenuPaste,
    handleMenuNewCard,
    handleMenuChangeColor,
    handleMenuNewFrame,
    handleMenuRenameFrame,
    handleMenuDeleteFrame,
    handleMenuDuplicateFrame,
    handleMenuCopyFrame,
  };
}
