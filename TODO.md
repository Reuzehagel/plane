# Plane — Roadmap

## Done

- [x] Infinite pan/zoom canvas with dot grid
- [x] Card creation (double-click)
- [x] Card dragging with z-ordering
- [x] Inline title editing
- [x] Cursor-anchored zoom
- [x] Card deletion (Delete key / right-click)
- [x] Multi-select (box select, shift-click)
- [x] Move selected group together
- [x] Keyboard shortcuts (Delete, Ctrl+A)
- [x] Undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- [x] Arrow nudge for selected cards
- [x] Card resizing (drag handles)
- [x] Card colors (8-color palette, context menu picker)
- [x] Snap to grid (always-on, smooth lerp animation)
- [x] Right-click context menu
- [x] Save/load workspace (Tauri filesystem)
- [x] Auto-save on changes (2s debounce + save on close)
- [x] Multiple grids with sidebar (create, delete, rename, switch)
- [x] Dark theme with JetBrains Mono, accent bars, colored titles
- [x] Fit-to-content button with smooth camera animation (Ctrl+1)
- [x] Collapsible floating sidebar

## High Priority

- [x] Command palette (Ctrl+K) — fuzzy search cards/grids, quick actions
- [x] Clipboard paste as card (Ctrl+V on empty space → new card with text)
- [x] Multiline text / rich content (markdown?)
- [x] Presentation mode — define waypoints, camera flies between cards

## Cards

- [ ] Card links (click to jump to another grid)
- [ ] Image/embed cards
- [ ] Card tags/labels for filtering
- [ ] Card stacks — drag card onto another to create collapsible pile
- [ ] Infinite nesting — double-click to "enter" a card, canvas inside canvas

## Connections

- [x] Draw arrows/lines between cards
- [x] Connection labels
- [ ] Auto-routing around cards

## Canvas & Navigation

- [ ] Minimap
- [ ] Zoom controls UI (buttons, percentage)
- [ ] Smooth animated zoom (scroll wheel)
- [ ] Search across all grids (Ctrl+F / Ctrl+Shift+F)
- [ ] Grid links (navigate between grids via cards)
- [ ] Spatial bookmarks — save/recall named camera positions within a grid
- [ ] Canvas regions — colored background zones to visually group areas
- [ ] Freeform drawing layer — pen tool for sketching, annotations, quick marks

## Sync & Data

- [ ] Cloud sync (iCloud / Google Drive — no server, local-first)
- [ ] Export grid as image (PNG/SVG)
- [ ] Import/export workspace as JSON
- [ ] Quick capture (global hotkey) — system-wide shortcut to add card even when minimized

## Polish

- [ ] Touch/trackpad gesture support
- [ ] Themes (light mode, custom accent colors)
- [ ] Auto-updates (Tauri updater plugin)
- [ ] Onboarding / empty state with hints

## Stretch Goals

- [ ] AI cards (Anthropic/OpenAI/Gemini integration)
- [ ] Website embed cards (live snippet preview)
- [ ] Collaborative editing (CRDTs)
- [ ] Plugin system
