import { useState, useRef, useEffect, useMemo } from "react";
import type { Grid, PaletteActionItem, PaletteCardItem, PaletteFrameItem, PaletteGridItem, PaletteItem } from "../types";
import { PALETTE_MAX_RESULTS } from "../constants";
import { filterAndSort } from "../lib/fuzzySearch";

interface CommandPaletteProps {
  grids: React.RefObject<Grid[]>;
  activeGridId: string;
  onClose: () => void;
  onExecuteAction: (actionId: string) => void;
  onSwitchGrid: (gridId: string) => void;
  onJumpToCard: (gridId: string, cardId: string) => void;
  onJumpToFrame: (gridId: string, frameId: string) => void;
}

const ACTIONS: PaletteActionItem[] = [
  { kind: "action", id: "new-card",    label: "New Card",            shortcut: "Dbl-click" },
  { kind: "action", id: "new-grid",    label: "New Grid" },
  { kind: "action", id: "new-frame",   label: "New Frame" },
  { kind: "action", id: "present",     label: "Start Presentation",  shortcut: "F5" },
  { kind: "action", id: "fit",         label: "Fit to Content",      shortcut: "Ctrl+1" },
  { kind: "action", id: "select-all",  label: "Select All",          shortcut: "Ctrl+A" },
  { kind: "action", id: "undo",        label: "Undo",                shortcut: "Ctrl+Z" },
  { kind: "action", id: "redo",        label: "Redo",                shortcut: "Ctrl+Shift+Z" },
  { kind: "action", id: "delete",      label: "Delete Selected",     shortcut: "Del" },
];

export function CommandPalette({ grids, activeGridId, onClose, onExecuteAction, onSwitchGrid, onJumpToCard, onJumpToFrame }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo((): PaletteItem[] => {
    const gridItems: PaletteGridItem[] = grids.current.map((g) => ({
      kind: "grid" as const,
      id: g.id,
      label: g.name,
      isActive: g.id === activeGridId,
      cardCount: g.cards.length,
    }));

    const cardItems: PaletteCardItem[] = grids.current.flatMap((g) =>
      g.cards.map((c) => {
        const nlIndex = c.text.indexOf("\n");
        const title = nlIndex === -1 ? c.text : c.text.slice(0, nlIndex);
        const body = nlIndex === -1 ? "" : c.text.slice(nlIndex + 1).slice(0, 80);
        return {
          kind: "card" as const,
          id: c.id,
          gridId: g.id,
          gridName: g.name,
          label: title || "Untitled",
          body,
          color: c.color,
        };
      })
    );

    const frameItems: PaletteFrameItem[] = grids.current.flatMap((g) =>
      g.frames.map((f) => ({
        kind: "frame" as const,
        id: f.id,
        gridId: g.id,
        gridName: g.name,
        label: f.label || "Untitled Frame",
        order: f.order,
      }))
    );

    if (query.trim() === "") {
      return [...ACTIONS, ...gridItems];
    }

    const filteredActions = filterAndSort(ACTIONS, query, (a) => a.label, PALETTE_MAX_RESULTS);
    const filteredGrids = filterAndSort(gridItems, query, (g) => g.label, PALETTE_MAX_RESULTS);
    const filteredCards = filterAndSort(cardItems, query, (c) => c.label + " " + c.body, PALETTE_MAX_RESULTS);
    const filteredFrames = filterAndSort(frameItems, query, (f) => f.label, PALETTE_MAX_RESULTS);

    return [
      ...filteredActions.map((r) => r.item),
      ...filteredGrids.map((r) => r.item),
      ...filteredFrames.map((r) => r.item),
      ...filteredCards.map((r) => r.item),
    ].slice(0, PALETTE_MAX_RESULTS);
  }, [query, activeGridId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    const el = listRef.current?.querySelector(".command-palette-item.selected");
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function executeItem(item: PaletteItem): void {
    onClose();
    switch (item.kind) {
      case "action": onExecuteAction(item.id); break;
      case "grid":   onSwitchGrid(item.id); break;
      case "card":   onJumpToCard(item.gridId, item.id); break;
      case "frame":  onJumpToFrame(item.gridId, item.id); break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) executeItem(items[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function categoryLabel(kind: PaletteItem["kind"]): string {
    switch (kind) {
      case "action": return "ACTIONS";
      case "grid":   return "GRIDS";
      case "card":   return "CARDS";
      case "frame":  return "FRAMES";
    }
  }

  function isFirstOfKind(index: number): boolean {
    return index === 0 || items[index].kind !== items[index - 1].kind;
  }

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          placeholder="Search cards, grids, frames, actions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette-list" ref={listRef}>
          {items.length === 0 && (
            <div className="command-palette-empty">No results</div>
          )}
          {items.map((item, i) => (
            <div key={`${item.kind}-${item.id}`}>
              {isFirstOfKind(i) && (
                <div className="command-palette-category">{categoryLabel(item.kind)}</div>
              )}
              <div
                className={`command-palette-item${i === selectedIndex ? " selected" : ""}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => executeItem(item)}
              >
                {item.kind === "card" && (
                  <span className="command-palette-color-dot" style={{ background: item.color }} />
                )}
                {item.kind === "grid" && item.isActive && (
                  <span className="command-palette-active-dot" />
                )}
                {item.kind === "frame" && (
                  <span className="sidebar-frame-order" style={{ width: 16, height: 16, fontSize: 9 }}>{item.order}</span>
                )}
                <span className="command-palette-item-label">
                  {item.label}
                  {item.kind === "card" && item.body && (
                    <span className="command-palette-item-body"> — {item.body}</span>
                  )}
                </span>
                <span className="command-palette-item-right">
                  {item.kind === "action" && item.shortcut && (
                    <span className="command-palette-shortcut">{item.shortcut}</span>
                  )}
                  {item.kind === "grid" && (
                    <span className="command-palette-grid-count">{item.cardCount}</span>
                  )}
                  {item.kind === "card" && (
                    <span className="command-palette-grid-name">{item.gridName}</span>
                  )}
                  {item.kind === "frame" && (
                    <span className="command-palette-grid-name">{item.gridName}</span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
