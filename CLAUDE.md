# Plane — Spatial Canvas Workspace

## Commands
- `just dev` — run Tauri + frontend dev server
- `just build` — build release binary
- `just check` — type-check (`bun run tsc --noEmit`)
- `just frontend` — frontend dev server only
- Always use `bun`, never `npx` or `node_modules/.bin`

## Stack
- Tauri + React + TypeScript + Vite
- Canvas 2D rendering (not DOM-based UI) with infinite pan/zoom
- `justfile` uses PowerShell on Windows

## Code Style
- `function` declarations over arrow functions
- Explicit return types on all functions
- Shared types in `src/types.ts`
- Use refs (not state) for high-frequency data (camera, cards, drag state)
- Only use React state when a re-render is needed (e.g. editing overlay)
- Keep comments to "why", not "what"
