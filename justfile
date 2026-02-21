set shell := ["powershell", "-NoProfile", "-Command"]

# Development
dev:
    bun run dev

# Build release binary
build:
    bun run build

# Install dependencies
install:
    bun install

# Run only the frontend dev server
frontend:
    bun run dev

# Type check
check:
    bun run tsc --noEmit
