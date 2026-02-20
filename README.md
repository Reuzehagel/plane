# Plane

A minimal infinite canvas desktop app — create, arrange, and connect cards on an endless zoomable board.

Built with **Tauri 2 + React 19 + TypeScript**, rendered entirely via Canvas 2D (no DOM card elements).

## Features

- **Infinite pan & zoom** — middle-click/drag to pan, scroll to zoom (cursor-anchored)
- **Cards** — double-click empty space to create; click to select; drag to move
- **Inline editing** — double-click a card to edit its title
- **Multi-select** — box-select by shift-dragging on empty space, or shift-click individual cards
- **Group move** — drag any selected card to move the whole selection
- **Deletion** — `Delete` key or right-click to remove selected cards
- **Select all** — `Ctrl+A`

## Stack

| Layer           | Technology                           |
| --------------- | ------------------------------------ |
| Desktop shell   | Tauri 2                              |
| UI / Logic      | React 19 + TypeScript                |
| Rendering       | Canvas 2D (imperative, no DOM cards) |
| Build tool      | Vite 7                               |
| Package manager | Bun                                  |
| Task runner     | Just                                 |
| Backend         | Rust (minimal Tauri shell)           |

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/)
- [Bun](https://bun.sh/)
- [Just](https://just.systems/)
- Tauri system dependencies for your OS ([guide](https://tauri.app/start/prerequisites/))

### Install dependencies

```bash
bun install
```

### Run in development

```bash
just dev
```

### Build release binary

```bash
just build
```

### Type-check only

```bash
just check
```

## Project Structure

```
src/
  App.tsx          # Root component — canvas, all interaction logic
  types.ts         # Shared TypeScript interfaces (Card, Camera, …)
  geometry.ts      # Hit-testing and coordinate helpers
  rendering.ts     # Canvas 2D draw routines
  constants.ts     # Shared magic numbers / config
src-tauri/
  src/             # Rust Tauri backend
  tauri.conf.json  # App config
```

## Architecture Notes

- All visuals are drawn imperatively; `scheduleRedraw()` debounces redraws via `requestAnimationFrame`.
- Two coordinate spaces: **world space** (where cards live) and **screen space** (canvas pixels). `screenToWorld()` / `worldToScreen()` convert between them.
- High-frequency state (camera, cards, drag) is stored in refs to avoid unnecessary React re-renders. React state is only used for the editing overlay.

## Roadmap

See [TODO.md](TODO.md).
