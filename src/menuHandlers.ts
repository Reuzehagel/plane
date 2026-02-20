import type React from "react";
import type { Card, ContextMenuState } from "./types";
import { CARD_WIDTH, CARD_HEIGHT, DUPLICATE_OFFSET } from "./constants";
import { snapPoint } from "./geometry";

export interface MenuHandlerDeps {
  contextMenu: ContextMenuState | null;
  selectedCardIds: React.RefObject<Set<string>>;
  clipboard: React.RefObject<Card | null>;
  findCard: (id: string) => Card | undefined;
  removeCard: (id: string) => void;
  deleteSelectedCards: () => void;
  createCard: (x: number, y: number, w: number, h: number, title: string) => Card;
  insertCard: (card: Card) => void;
  openEditor: (card: Card) => void;
  createAndStartEditingCardAt: (worldX: number, worldY: number) => void;
  saveSnapshot: () => void;
  setContextMenu: (v: ContextMenuState | null) => void;
  scheduleRedraw: () => void;
}

export interface MenuHandlers {
  handleMenuEdit: () => void;
  handleMenuDuplicate: () => void;
  handleMenuCopy: () => void;
  handleMenuResetSize: () => void;
  handleMenuDelete: () => void;
  handleMenuPaste: () => void;
  handleMenuNewCard: () => void;
}

function getMenuCard(deps: MenuHandlerDeps): Card | undefined {
  if (!deps.contextMenu?.cardId) return undefined;
  return deps.findCard(deps.contextMenu.cardId);
}

function closeMenu(deps: MenuHandlerDeps): void {
  deps.setContextMenu(null);
}

function runMenuAction(deps: MenuHandlerDeps, action: () => void): void {
  deps.saveSnapshot();
  action();
  closeMenu(deps);
  deps.scheduleRedraw();
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
      const clone = deps.createCard(pos.x, pos.y, card.width, card.height, card.title);
      deps.insertCard(clone);
    });
  }

  function handleMenuCopy(): void {
    const card = getMenuCard(deps);
    if (!card) return;
    deps.clipboard.current = { ...card };
    closeMenu(deps);
  }

  function handleMenuResetSize(): void {
    const card = getMenuCard(deps);
    if (!card) return;
    runMenuAction(deps, () => {
      card.width = CARD_WIDTH;
      card.height = CARD_HEIGHT;
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
    if (!deps.contextMenu || !deps.clipboard.current) return;
    const { worldX, worldY } = deps.contextMenu;
    const src = deps.clipboard.current;
    runMenuAction(deps, () => {
      const pos = snapPoint(worldX - src.width / 2, worldY - src.height / 2);
      const newCard = deps.createCard(pos.x, pos.y, src.width, src.height, src.title);
      deps.insertCard(newCard);
    });
  }

  function handleMenuNewCard(): void {
    if (!deps.contextMenu) return;
    const { worldX, worldY } = deps.contextMenu;
    closeMenu(deps);
    deps.createAndStartEditingCardAt(worldX, worldY);
  }

  return {
    handleMenuEdit,
    handleMenuDuplicate,
    handleMenuCopy,
    handleMenuResetSize,
    handleMenuDelete,
    handleMenuPaste,
    handleMenuNewCard,
  };
}
