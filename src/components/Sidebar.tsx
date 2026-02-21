import { useState, useRef, useEffect } from "react";
import { Plus, X, Play } from "lucide-react";
import type { FrameSummary, GridSummary } from "../types";

export interface SidebarProps {
  grids: GridSummary[];
  activeGridId: string;
  onSwitchGrid: (id: string) => void;
  onCreateGrid: () => void;
  onDeleteGrid: (id: string) => void;
  onRenameGrid: (id: string, name: string) => void;
  frameSummaries: FrameSummary[];
  onReorderFrames: (orderedIds: string[]) => void;
  onStartPresentation: () => void;
  onJumpToFrame: (frameId: string) => void;
  onRenameFrame: (id: string, name: string) => void;
  onDeleteFrame: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export function Sidebar({
  grids,
  activeGridId,
  onSwitchGrid,
  onCreateGrid,
  onDeleteGrid,
  onRenameGrid,
  frameSummaries,
  onReorderFrames,
  onStartPresentation,
  onJumpToFrame,
  onRenameFrame,
  onDeleteFrame,
  onOpenChange,
}: SidebarProps): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);
  const [renameFrameValue, setRenameFrameValue] = useState("");
  const frameInputRef = useRef<HTMLInputElement>(null);

  const [dragFrameId, setDragFrameId] = useState<string | null>(null);
  const [dragOverFrameId, setDragOverFrameId] = useState<string | null>(null);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (renamingFrameId && frameInputRef.current) {
      frameInputRef.current.focus();
      frameInputRef.current.select();
    }
  }, [renamingFrameId]);

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

  function startFrameRename(frame: FrameSummary): void {
    setRenamingFrameId(frame.id);
    setRenameFrameValue(frame.label);
  }

  function commitFrameRename(): void {
    if (renamingFrameId && renameFrameValue.trim()) {
      onRenameFrame(renamingFrameId, renameFrameValue.trim());
    }
    setRenamingFrameId(null);
  }

  function handleFrameDragStart(e: React.DragEvent, id: string): void {
    setDragFrameId(id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleFrameDragOver(e: React.DragEvent, id: string): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFrameId(id);
  }

  function handleFrameDrop(e: React.DragEvent, targetId: string): void {
    e.preventDefault();
    setDragOverFrameId(null);
    if (!dragFrameId || dragFrameId === targetId) return;

    const sortedFrames = [...frameSummaries].sort((a, b) => a.order - b.order);
    const ids = sortedFrames.map((f) => f.id);
    const fromIndex = ids.indexOf(dragFrameId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, dragFrameId);
    onReorderFrames(ids);
    setDragFrameId(null);
  }

  function handleFrameDragEnd(): void {
    setDragFrameId(null);
    setDragOverFrameId(null);
  }

  const sortedFrames = [...frameSummaries].sort((a, b) => a.order - b.order);

  return (
    <>
      <button
        className={`sidebar-pill${open ? " hidden" : ""}`}
        onClick={() => { setOpen(true); onOpenChange?.(true); }}
      >
        P
      </button>

      <div className={`sidebar-panel${open ? " open" : ""}`}>
        <div className="sidebar-header" onClick={() => { setOpen(false); onOpenChange?.(false); }}>
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
                      else if (e.key === "Escape") setRenamingId(null);
                      e.stopPropagation();
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

        <div className="sidebar-section-header" style={{ marginTop: 12 }}>
          <span className="sidebar-section-label">FRAMES</span>
          {sortedFrames.length > 0 && (
            <button className="sidebar-present-btn" onClick={onStartPresentation} title="Present (F5)">
              <Play size={12} strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="sidebar-frame-list">
          {sortedFrames.map((frame) => {
            const isRenaming = frame.id === renamingFrameId;

            return (
              <div
                key={frame.id}
                className={`sidebar-frame-item${dragFrameId === frame.id ? " dragging" : ""}${dragOverFrameId === frame.id ? " drag-over" : ""}`}
                draggable={!isRenaming}
                onDragStart={(e) => handleFrameDragStart(e, frame.id)}
                onDragOver={(e) => handleFrameDragOver(e, frame.id)}
                onDrop={(e) => handleFrameDrop(e, frame.id)}
                onDragEnd={handleFrameDragEnd}
                onClick={() => { if (!isRenaming) onJumpToFrame(frame.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); startFrameRename(frame); }}
              >
                <span className="sidebar-frame-order">{frame.order}</span>
                {isRenaming ? (
                  <input
                    ref={frameInputRef}
                    className="sidebar-rename-input"
                    value={renameFrameValue}
                    onChange={(e) => setRenameFrameValue(e.target.value)}
                    onBlur={commitFrameRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitFrameRename();
                      else if (e.key === "Escape") setRenamingFrameId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="sidebar-frame-name">{frame.label}</span>
                    <div className="sidebar-frame-trailing">
                      <button
                        className="sidebar-frame-delete-btn"
                        onClick={(e) => { e.stopPropagation(); onDeleteFrame(frame.id); }}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
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
