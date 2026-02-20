# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- `just dev` — run Tauri + frontend dev server
- `just build` — build release binary
- `just check` — type-check (`bun run tsc --noEmit`)
- `just frontend` — frontend dev server only
- Always use `bun`, never `npx` or `node_modules/.bin`

## Stack
- Tauri 2 + React 19 + TypeScript + Vite
- Canvas 2D rendering (not DOM-based UI) with infinite pan/zoom
- Rust backend in `src-tauri/` (currently minimal — just the Tauri shell)
- `justfile` uses PowerShell on Windows

## Code Style
- `function` declarations over arrow functions
- Explicit return types on all functions
- Shared types in `src/types.ts`
- Use refs (not state) for high-frequency data (camera, cards, drag state)
- Only use React state when a re-render is needed (e.g. editing overlay)
- Keep comments to "why", not "what"

## Architecture

The app is a single `App` component (`src/App.tsx`) that owns a full-window `<canvas>` and all interaction logic.

### Rendering Pipeline
- All visuals are drawn imperatively via Canvas 2D in the `draw()` callback
- `scheduleRedraw()` must be called after every ref mutation that affects visuals — it debounces via `requestAnimationFrame`
- The only React-rendered DOM element is the `<input>` overlay for card title editing, positioned absolutely to match the card's screen coordinates

### Coordinate System
- **World space**: where cards live (card.x, card.y)
- **Screen space**: pixel position on the canvas
- `screenToWorld()` / `worldToScreen()` convert between them using the camera (pan + zoom)
- Camera stores pan as world-space offset (`cam.x`, `cam.y`) and a `zoom` scalar

### Event Handling
- All canvas interaction (mouse, keyboard) is handled via native event listeners in a single `useEffect`, not React event props
- `editingRef` mirrors the `editing` state so imperative handlers can read it without stale closures

### Selection
- `selectedCardIds` is a `Set<string>` ref, not React state
- Shift-click toggles individual card selection; shift-drag on empty space does box select
- Cards are hit-tested back-to-front; selected cards are moved to end of array (top of z-order)
