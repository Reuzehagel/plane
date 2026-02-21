# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Always use `bun`, never `npx` or `node_modules/.bin`

- `just dev` — run Electron + Vite dev server (Note, don't use this unless told to.)
- `just build` — build frontend + Electron
- `just check` — type-check (`bun run tsc --noEmit`)
- `just frontend` — alias for `just dev` (same command)
- `just install` — install dependencies (`bun install`)
- Dev server runs on `localhost:1420` (`strictPort: true` — will error if port is taken)
- When asked to commit, always use the `/commit-commands:commit` skill
- No test suite exists; don't suggest or attempt to run tests

## Stack

- Electron + React 19 + TypeScript + Vite (via `vite-plugin-electron`)
- Tailwind CSS 4 (via `@tailwindcss/vite`) for DOM overlay styling; `lucide-react` for icons
- Canvas 2D rendering (not DOM-based UI) with infinite pan/zoom
- Electron main/preload in `electron/` — IPC-based file persistence scoped to `app.getPath('userData')`
- `"type": "module"` in package.json → main process is ESM (no `__dirname`, use `import.meta.url`)
- Must use `vite-plugin-electron/simple` (not flat API) — it builds preload as CJS (`.mjs`), main as ESM (`.js`)
- `justfile` uses PowerShell on Windows

## Code Style

- `function` declarations over arrow functions
- Explicit return types on all functions
- Shared types in `src/types.ts`
- Constants in `src/constants.ts`; pure logic modules (e.g. `src/lib/history.ts`, `src/lib/geometry.ts`) have no React dependencies
- Use refs (not state) for high-frequency data (camera, cards, drag state)
- Only use React state when a re-render is needed (e.g. editing overlay)
- Keep comments to "why", not "what"
- TypeScript strict mode is on — `noUnusedLocals` and `noUnusedParameters` will fail `just check`; don't leave unused variables

## Architecture

The app is a single `App` component (`src/components/App.tsx`) that owns a full-window `<canvas>`, with interaction logic extracted into hooks.

### Modules

- **`electron/`** — Electron process files (built by `vite-plugin-electron` into `dist-electron/`)
  - `main.ts` — Main process: BrowserWindow, IPC handlers for fs ops; uses `import.meta.url` for `__dirname` (ESM build)
  - `preload.ts` — Preload: exposes `window.electronAPI` via `contextBridge`
- `src/types/electron.d.ts` — Type declaration for `window.electronAPI`
- `src/main.tsx` — React entry point
- `src/types.ts` — All shared interfaces and type aliases
- `src/constants.ts` — Visual and behavior constants
- **`src/components/`** — React components
  - `App.tsx` — Canvas app: state declarations, card CRUD, editor, history/persistence, grid management, rendering
  - `Sidebar.tsx` — Grid list sidebar component
  - `PresentationOverlay.tsx` — Presentation mode bottom bar (frame label, progress, nav)
  - `CommandPalette.tsx` — Ctrl+K command palette (fuzzy search across cards, grids, actions)
- **`src/hooks/`** — React hooks
  - `useKeyboard.ts` — Keyboard shortcut hook (undo/redo, delete, nudge, select-all, fit-to-content, copy/paste)
  - `useCanvasInteractions.ts` — Mouse/wheel/space-key event handling hook (drag, resize, box-select, pan, zoom)
- **`src/lib/`** — Pure logic modules (no React dependencies)
  - `geometry.ts` — Coordinate conversion, hit testing (`hitTestRectHandles<T>` returns `{ item: T, handle }`), snap/lerp utilities, bounds helpers (`getRectBounds`, `mergeBounds`), and `rectsIntersect`
  - `rendering.ts` — Canvas 2D draw functions (drawScene)
  - `history.ts` — Undo/redo snapshot logic (pushSnapshot, undo, redo)
  - `mutation.ts` — `runMutation(deps, action)` helper: saveSnapshot → action → scheduleRedraw → markDirty
  - `menuHandlers.ts` — Context menu action handlers (edit, duplicate, copy, reset size, paste, delete, new card)
  - `textLayout.ts` — Canvas text wrapping (`wrapText`) and auto-height calculation (`computeCardHeight`)
  - `fuzzySearch.ts` — Fuzzy scoring and filtering (used by command palette)
  - `persistence.ts` — Workspace save/load via Electron IPC (`window.electronAPI`)

### Rendering Pipeline

- All visuals are drawn imperatively via Canvas 2D in the `draw()` callback
- `scheduleRedraw()` must be called after every ref mutation that affects visuals — it debounces via `requestAnimationFrame`
- Continuous animation loops (drag/resize lerp) call `draw()` directly and manage their own RAF cycle, separate from `scheduleRedraw()`
- React-rendered DOM overlays are positioned absolutely over the canvas at screen coordinates (z-index: editor 10, context menu 20, command palette 30, presentation 40)
- DOM overlays intercept wheel/keyboard events — overlays must manually forward pan/zoom to the camera when the canvas can't see the event
- All DOM `<input>`/`<textarea>` overlays must call `e.stopPropagation()` in `onKeyDown` to prevent global keyboard shortcuts (Delete, Ctrl+A, etc.) from firing while typing — checking `e.target`/`document.activeElement` in the global handler is unreliable
- All `.focus()` calls on DOM overlays (editors, inputs) must use `focus({ preventScroll: true })` — without it, the browser scrolls off-canvas elements into view, causing the page to jump. Never use `autoFocus` on overlay inputs.

### State

- Workspace (grids, cards, frames, cameras) persists to Electron userData via `src/lib/persistence.ts` with 2s debounced save and v1→v4 migration
- Active grid's cards live in `cards.current` ref, not in `grids.current[i].cards` — call `syncCurrentGridBack()` before reading cross-grid data
- Active grid's frames live in `frames.current` ref — also synced by `syncCurrentGridBack()`

### Coordinate System

- **World space**: where cards live (card.x, card.y)
- **Screen space**: pixel position on the canvas
- `screenToWorld()` / `worldToScreen()` convert between them using the camera (pan + zoom)
- Camera stores pan as world-space offset (`cam.x`, `cam.y`) and a `zoom` scalar

### Event Handling

- `useRefState<T>()` helper in App.tsx pairs `useState` with a ref — returns `[state, ref, setState]`
- Mouse/wheel interaction is handled via native event listeners in `src/hooks/useCanvasInteractions.ts`, not React event props
- Keyboard shortcuts are extracted to `src/hooks/useKeyboard.ts` hook
- Extracted hooks/modules (`useCanvasInteractions.ts`, `useKeyboard.ts`, `menuHandlers.ts`) receive a `*Deps` interface — keeps them decoupled from App internals
- Hooks using `*Deps` follow the `depsRef` pattern: capture deps in a ref, alias stable refs at effect setup, read function deps from `depsRef.current` at call time
- For each React state that imperative event handlers need, a parallel ref mirrors it (e.g. `editingRef` ↔ `editing`, `contextMenuRef` ↔ `contextMenu`)
- Double-click on a card opens editor; double-click on empty space creates a new card and opens editor
- Left-click on empty space starts box select (TLDraw/Excalidraw convention)
- Middle-click and space+left-click pan the canvas (hand tool)
- Space bar held = hand tool mode (cursor changes to grab)

### Selection

- `selectedCardIds` is a `Set<string>` ref, not React state
- Left-click on empty space clears selection and starts box select; shift preserves existing selection
- Shift-click toggles individual card selection
- Cards are hit-tested back-to-front; selected cards are moved to end of array (top of z-order)

### Undo/Redo

- Snapshot-based: deep clones of `cards` + `selectedCardIds` + `frames` + `selectedFrameIds` before each user action (`src/lib/history.ts`)
- Use `runMutation(deps, action)` for the standard snapshot→mutate→redraw→dirty workflow; drag/resize capture snapshot at mousedown, not per frame
- `removeCard()` is a low-level helper — callers push snapshots, not `removeCard` itself
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y; Delete/Backspace deletes selected; Ctrl+A selects all; Ctrl+C/V copy/paste; arrow keys nudge by `NUDGE_AMOUNT` px
- Ctrl+K toggles command palette; `useKeyboard` processes Ctrl+K before all other guards so it works even during editing

### Context Menu

- Right-click opens a context menu (DOM overlay, same pattern as card editor)
- Card menu: Edit, Duplicate, Copy, Reset Size, Delete; frame menu: Rename, Duplicate, Copy, Delete; empty-space menu: Paste, New Card, New Frame
- Internal clipboard refs (`Card[]` and `Frame[]`, mutually exclusive) support multi-card/frame copy; Ctrl+C/V work alongside context menu Copy/Paste
- Ctrl+V prefers internal clipboard; falls back to system clipboard text → new card
- Pasted cards are offset by `DUPLICATE_OFFSET` to avoid overlapping originals
- Menu closes on: left-click, Escape, scroll/zoom

### Camera Animation

- `animateCamera(opts)` is the shared RAF loop for all camera transitions (focal lerp + optional zoom lerp, `onDone` callback)
- `fitToContent()`, `animateCameraToPoint()`, `animateCameraToFrame()`, and `exitPresentation()` are thin wrappers that compute targets and delegate to `animateCamera`
- `fitToContent()` accounts for sidebar width (`SIDEBAR_WIDTH`) when computing usable viewport area and centering — sidebar open state is tracked via `sidebarOpen` ref
- New features needing camera animation should call `animateCamera` rather than duplicating the loop

### Frames & Presentation

- Frames are rectangular regions drawn behind cards (dashed border, label, order badge)
- Frames hit-test on border/label only — clicking inside a frame interacts with cards, not the frame
- Cards always take priority over frames in hit-testing
- Dragging a frame moves all cards fully contained within it (`getCardsInFrame` in geometry.ts); contained card offsets are tracked in `FrameDragState.cardOffsets`
- `animateCameraToFrame(frame)` zooms to fit a frame with `PRESENTATION_FIT_PADDING` via `animateCamera`
- Presentation mode: sorts frames by order, hides frames/sidebar/editor, navigates with arrow keys; exit animates back to saved camera
- During presentation, `drawScene` receives empty `frames` array to hide them — no conditional logic in the renderer

### Snap-to-Grid

- All card positions snap to `DOT_SPACING` (24px) grid — always on, no toggle
- All card dimension constants (`CARD_WIDTH`, `CARD_MIN_*`, `CARD_MAX_*`) must be multiples of `DOT_SPACING`
- Drag and resize use a lerp animation pattern: mousemove sets snap targets in a ref, a continuous RAF loop lerps toward targets via `lerpSnap()`, mouseup settles to exact values
- Card and frame resize share one `ResizeState` (with `item` + min/max constraints baked in at mousedown); `computeResizeTarget()` pure function computes snap targets
- RAF animation loops must always reschedule themselves while active — early-returning before `requestAnimationFrame()` kills the loop
