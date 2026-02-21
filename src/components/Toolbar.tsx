import { MousePointer2, Spline } from "lucide-react";
import type { ActiveTool } from "../types";

interface ToolbarProps {
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
}

export function Toolbar({ activeTool, onToolChange }: ToolbarProps): React.JSX.Element {
  const idx = activeTool === "pointer" ? 0 : 1;
  return (
    <div className="toolbar">
      <div
        className="toolbar-indicator"
        style={{ transform: `translateX(${idx * (32 + 2)}px)` }}
      />
      <button
        className={`toolbar-btn${activeTool === "pointer" ? " active" : ""}`}
        onClick={() => onToolChange("pointer")}
        title="Pointer tool"
      >
        <MousePointer2 size={16} strokeWidth={1.8} />
      </button>
      <button
        className={`toolbar-btn${activeTool === "connection" ? " active" : ""}`}
        onClick={() => onToolChange("connection")}
        title="Connection tool (C)"
      >
        <Spline size={16} strokeWidth={1.8} />
        <span className="toolbar-shortcut">C</span>
      </button>
    </div>
  );
}
