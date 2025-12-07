# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZenGM is a suite of single-player sports simulation games (Basketball GM, Football GM, ZenGM Baseball, and ZenGM Hockey) that run entirely in the browser using client-side JavaScript and IndexedDB. The codebase supports all four sports through a multi-sport architecture controlled by the `SPORT` environment variable.

**License Note:** This project uses a custom license (see LICENSE.md). A Contributor License Agreement (CLA) is required for contributions.

## Common Commands

### Development
```bash
# Install dependencies
pnpm install

# Start development server with hot reload (default: basketball)
pnpm run start-watch

# Start for specific sport
SPORT=football pnpm run start-watch
SPORT=baseball pnpm run start-watch
SPORT=hockey pnpm run start-watch

# Build production version
pnpm run build

# Just start server (without watch)
pnpm run start

# Just watch for changes (without server)
pnpm run watch
```

### Testing
```bash
# Run all tests
pnpm test

# Run linting (ESLint + TypeScript)
pnpm run lint

# Run just ESLint
pnpm run lint-js

# Run just TypeScript checks
pnpm run lint-ts

# End-to-end test (basketball by default)
pnpm run test-e2e

# End-to-end test for specific sport
SPORT=football pnpm run test-e2e

# E2E with auto-watch
pnpm run test-e2e-watch

# Format code with Prettier
pnpm run prettier
```

## Architecture

### Multi-Process Architecture

The game uses a **Shared Worker** (or Web Worker in older browsers) architecture:

- **Worker process** (`src/worker/`): Core game logic, simulation, data management
- **UI process** (`src/ui/`): React-based UI, user interactions, rendering
- **Communication**: `toWorker()` (UI → Worker) and `toUI()` (Worker → UI) functions via promise-worker-bi

Communication flow:
1. UI calls `toWorker(category, functionName, params)`
2. Worker executes the function from `src/worker/api/`
3. Worker returns result or calls `toUI()` to update UI state

### Directory Structure

```
src/
├── common/          # Shared code between worker and UI
│   ├── constants.ts              # Core constants
│   ├── constants.{sport}.ts      # Sport-specific constants
│   ├── types.ts                  # Shared TypeScript types
│   ├── types.{sport}.ts          # Sport-specific types
│   └── bySport.ts                # Multi-sport utility
├── worker/          # Core game logic (runs in Shared Worker)
│   ├── api/         # API endpoints callable from UI
│   ├── core/        # Game simulation and logic
│   │   ├── GameSim.{sport}/     # Sport-specific game simulation
│   │   ├── draft/               # Draft logic
│   │   ├── freeAgents/          # Free agency
│   │   ├── league/              # League management
│   │   ├── phase/               # Season phase transitions
│   │   ├── player/              # Player management and generation
│   │   ├── realRosters/         # Real roster data
│   │   ├── season/              # Season simulation
│   │   └── team/                # Team management
│   ├── db/          # Database layer (IndexedDB + Cache)
│   │   ├── Cache.ts             # In-memory cache layer
│   │   └── connectLeague.ts     # Database connection
│   ├── util/        # Worker utilities
│   └── views/       # Data preparation for views
├── ui/              # User interface (React)
│   ├── components/  # React components
│   ├── hooks/       # React hooks
│   ├── util/        # UI utilities including toWorker
│   └── views/       # Page-level views
└── test/            # Test fixtures and utilities
```

### Database & Cache System

The game stores all data in **IndexedDB** with an in-memory **Cache** layer (`src/worker/db/Cache.ts`) for performance:

- **Cache stores**: Frequently accessed data (current players, current season teams, etc.)
- **IndexedDB**: Full historical data, retired players, past seasons
- **Critical**: Cache values are mutable. Always call `idb.cache.*.put()` after modifying cached objects
- Access cache via `idb.cache.*` (e.g., `idb.cache.players.get()`)
- Access IndexedDB via `idb.league.*` or `idb.getCopies.*` for defensive copies

### Multi-Sport Support

The codebase supports 4 sports through conditional compilation:

**File naming patterns:**
- `filename.basketball.ts` - Basketball-specific
- `filename.football.ts` - Football-specific
- `filename.baseball.ts` - Baseball-specific
- `filename.hockey.ts` - Hockey-specific
- `filename.ts` - Shared across sports

**Runtime sport selection:**
```typescript
import bySport from "../common/bySport";

const value = bySport({
  basketball: "basketball-specific",
  football: "football-specific",
  baseball: "baseball-specific",
  hockey: "hockey-specific",
  default: "fallback" // optional
});
```

**Build-time sport selection:**
- Set via `SPORT` environment variable
- Build system includes only the relevant sport files
- Access via `process.env.SPORT`

### Global Variables

- **Worker**: `self.bbgm` provides access to internal functions for debugging
- **UI**: `self.bbgm` similar debug access in browser console

## Development Notes

### Shared Worker Debugging

- **Chrome**: Navigate to `chrome://inspect/#workers`, click "Inspect" under the worker URL
- **Console logs**: Must be viewed in worker inspector, not main console
- **Reload behavior**: Shared Worker persists across tab reloads. Close all tabs before reloading to see worker changes

### Service Worker (Apache only, not with `pnpm run start`)

Service worker caches for offline support can interfere with development:
- Chrome: Use "Update on reload" in DevTools with Application → Service Workers
- Use Ctrl+Shift+R to force refresh

### TypeScript Path Mappings

Configured in `tsconfig.json` and `jest.config.mjs`:
```typescript
import "bbgm-polyfills"     // → src/common/polyfills-modern.ts
import "bbgm-polyfills-ui"  // → src/common/polyfills-noop.ts
import "bbgm-debug"         // → src/worker/core/debug/index.ts
import "league-schema"      // → build/files/league-schema.json
```

### Stat Abbreviations

Follow Basketball Reference and Football Reference conventions:
- "defensive rebounds" → "drb"
- "touchdowns" → "td"
- Be consistent with existing stats in `constants.{sport}.ts`

### Testing Strategy

- **Unit tests**: `*.test.ts` files throughout codebase
- **Integration tests**: Also in `*.test.ts` files
- **E2E test**: Single test that creates league and simulates full season (see `karma.conf.js`)
- **Test environment**: Uses `fake-indexeddb` for database mocking

### Common Pitfalls

1. **Cache mutations**: Always call `idb.cache.*.put()` after modifying cached objects
2. **Sport-specific imports**: Import from sport-specific files breaks in other sports
3. **Shared Worker reload**: Must close all tabs to reload worker
4. **Async IndexedDB**: All database operations are async, use `await`
5. **Phase transitions**: Game phases (PHASE.DRAFT, PHASE.PLAYOFFS, etc.) require careful state management

### Key Utilities

**Worker:**
- `g.get()` - Get game attributes (league settings)
- `local.state` - Ephemeral worker state
- `idb.cache.*` - Access cached data
- `helpers.*` - Common helper functions

**UI:**
- `toWorker()` - Call worker API functions
- `useLocal()` - React hook for local state
- `realtimeUpdate()` - Subscribe to worker updates

## Build System

- **Bundler**: Rollup for production, esbuild for development
- **CSS**: SASS compilation
- **TypeScript**: Strict mode enabled
- **Code splitting**: Separate bundles for worker and UI
- **Assets**: Built to `build/` directory

## API Structure

Worker API organized by category in `src/worker/api/`:
- `actions` - User actions (trades, roster moves, etc.)
- `main` - Core operations (create league, sim games, etc.)
- `playMenu` - Play controls
- `toolsMenu` - Tools and utilities
- `leagueFileUpload` - Import/export
- `exhibitionGame` - Exhibition mode

Call from UI: `toWorker('category', 'functionName', params)`
