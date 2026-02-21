import { useState, useRef, useEffect } from "react";
import { Plus, X } from "lucide-react";
import type { GridSummary } from "../types";

export interface SidebarProps {
  grids: GridSummary[];
  activeGridId: string;
  onSwitchGrid: (id: string) => void;
  onCreateGrid: () => void;
  onDeleteGrid: (id: string) => void;
  onRenameGrid: (id: string, name: string) => void;
}

export function Sidebar({
  grids,
  activeGridId,
  onSwitchGrid,
  onCreateGrid,
  onDeleteGrid,
  onRenameGrid,
}: SidebarProps): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  function startRename(grid: GridSummary): void {
    setRenamingId(grid.id);
    setRenameValue(grid.name);
  }

  function commitRename(): void {
    if (renamingId && renameValue.trim()) {
      onRenameGrid(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }

  return (
    <>
      <button
        className={`sidebar-pill${open ? " hidden" : ""}`}
        onClick={() => setOpen(true)}
      >
        P
      </button>

      <div className={`sidebar-panel${open ? " open" : ""}`}>
        <div className="sidebar-header" onClick={() => setOpen(false)}>
          PLANE
        </div>

        <div className="sidebar-section-header">
          <span className="sidebar-section-label">GRIDS</span>
          <button className="sidebar-add-btn" onClick={onCreateGrid}>
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>

        <div className="sidebar-grid-list">
          {grids.map((grid) => {
            const isActive = grid.id === activeGridId;
            const isRenaming = grid.id === renamingId;

            return (
              <div
                key={grid.id}
                className={`sidebar-grid-item${isActive ? " active" : ""}`}
                onClick={() => { if (!isRenaming) onSwitchGrid(grid.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); startRename(grid); }}
              >
                {isRenaming ? (
                  <input
                    ref={inputRef}
                    className="sidebar-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span className="sidebar-grid-name">{grid.name}</span>
                    <div className="sidebar-grid-trailing">
                      <span className="sidebar-grid-count">{grid.cardCount}</span>
                      {grids.length > 1 && (
                        <button
                          className="sidebar-delete-btn"
                          onClick={(e) => { e.stopPropagation(); onDeleteGrid(grid.id); }}
                        >
                          <X size={14} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
