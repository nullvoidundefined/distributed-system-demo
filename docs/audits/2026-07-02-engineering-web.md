# Engineering Audit - Web Surface
**Date:** 2026-07-02
**Scope:** `web/src/**`, `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
**Auditor role:** CTO / Engineering (Sonnet)
**Governing rules:** `~/.claude/CLAUDE.md` R-217..R-242, CLAUDE-FRONTEND.md, CLAUDE-STYLING.md, `~/Desktop/code/personal/.claude/CLAUDE.md`

---

## Executive Summary

The web surface is structurally sound for a local demo: correct directory taxonomy, good semantic HTML foundations, working SCSS module discipline, and accurate `@demo/shared` imports. Four issues require immediate attention before this surface can be considered correct:

1. Compiled `.js` artifacts are committed next to `.ts` sources with no `outDir` set and no `.gitignore` exclusion. During `vite dev`, Vite resolves `.js` extensions first, serving stale pre-compiled output and bypassing the TypeScript compiler. Source changes are silently ignored until artifacts are deleted.
2. No reconnection logic exists in either WebSocket hook. A server restart drops the session permanently with no user-visible indication.
3. Two separate WebSocket connections are opened where the spec calls for one bidirectional channel. Commands and state flow over different sockets, contradicting the transport design.
4. Commands are silently discarded if sent before the command socket reaches `OPEN`, with no queuing or user feedback.

**Top 3 priorities:**
1. Delete all `src/**/*.js` artifacts; add `outDir` to tsconfig; update `.gitignore`. (P1 - build correctness)
2. Add reconnection and `onerror`/`onclose` handlers to both hooks; add connection-status UI. (P1 - operational correctness)
3. Merge the two WebSocket connections into one; resolve WS_URL duplication. (P1 - spec conformance + R-219)

---

## Operational Basics

| Check | Result |
|---|---|
| Tests run (web surface) | No. No test files exist under `web/`. Spec says "optional: one Playwright smoke test". Absence is spec-compliant but noted. |
| CI green / CI exists | No CI config. Local demo; spec non-goal. Acceptable. |
| E2E wired up | No. Spec defers this to optional. Acceptable. |
| Monitoring / error tracking | None. Spec non-goal. Acceptable. |
| Rollback plan | Not applicable; local demo. |

No operational blockers for the stated demo scope. The test and CI gaps are accepted by the spec.

---

## P1 Findings

### P1-1 - Committed compiled `.js` artifacts shadow `.ts` sources during `vite dev`

**Rule:** Build hygiene; Vite module resolution; `moduleResolution: "Bundler"` in `tsconfig.base.json`.

**Evidence:**

```
web/src/App.js              (alongside App.tsx)
web/src/main.js             (alongside main.tsx)
web/src/state/useWorldState.js    (alongside useWorldState.ts)
web/src/state/useCommands.js      (alongside useCommands.ts)
web/src/components/ControlBar/ControlBar.js
web/src/components/EventLog/EventLog.js
web/src/components/KanbanBoard/KanbanBoard.js
web/src/components/NodeStrip/NodeStrip.js
web/vite.config.js          (alongside vite.config.ts)
```

All source imports use explicit `.js` extensions, e.g. `web/src/App.tsx:3`:
```typescript
import { ControlBar } from './components/ControlBar/ControlBar.js';
```

With `moduleResolution: "Bundler"`, Vite resolves `.js` first. Since `ControlBar.js` exists on disk, Vite serves it - the pre-compiled TypeScript artifact - instead of processing `ControlBar.tsx`. `App.js:1-14` already contains JSX-transformed output (`import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"`). Any subsequent edit to `ControlBar.tsx` is silently ignored during `vite dev` until the `.js` artifact is deleted.

The `.gitignore` covers only `node_modules/`, `dist/`, `.env`, and `.env.*`. No rule excludes `src/**/*.js`. The root `tsconfig.base.json` sets no `outDir`, so a bare `tsc` invocation emits alongside sources.

**Direction:** Add `"outDir": "dist"` to `web/tsconfig.json` (Vite's own build ignores `outDir` for its emit but this prevents accidental bare-`tsc` pollution). Delete all eight `.js` artifacts from `web/src/` and `web/vite.config.js`. Add `web/src/**/*.js` exclusion to `.gitignore` if any `tsc --emitDeclarationOnly` workflow is later needed, or exclude by pattern. `to confirm:` verify after deletion that `vite dev` correctly picks up edits to `.tsx`/`.ts` files; run `vite build` and confirm it passes `tsc` cleanly.

---

### P1-2 - No reconnection or error handling in either WebSocket hook

**Rule:** React hook correctness; operational correctness for a self-running cyclic demo.

**Evidence - `web/src/state/useWorldState.ts:19-26`:**
```typescript
useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as { type: string; state: WorldState };
        if (msg.type === 'snapshot') setState(msg.state);
    };
    return () => socket.close();
}, []);
```

**Evidence - `web/src/state/useCommands.ts:10-14`:**
```typescript
useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;
    return () => socket.close();
}, []);
```

Neither hook sets `onerror` or `onclose`. If the orchestrator restarts (expected during local development) or the network hiccups, the socket closes and the dependency array `[]` prevents re-connection. `useWorldState` freezes on the last received snapshot with no indication; `useCommands` silently discards all commands. There is no connection-status state returned from either hook, so the UI has no way to show a "disconnected" banner. For a self-running cyclic demo this makes the app appear broken whenever the server restarts.

**Direction:** Add `socket.onerror` and `socket.onclose` handlers in `useWorldState` that set a connection status (an enum: `'connecting' | 'open' | 'closed'`) and schedule a reconnect with exponential backoff. Expose the status from the hook; render a banner in `App` when not `'open'`. Apply the same pattern to `useCommands`. `to confirm:` check whether the server's WebSocket server assigns any per-connection identity for command routing; if so, verify that reconnection on a new socket still routes correctly.

---

### P1-3 - Two separate WebSocket connections where spec mandates one bidirectional channel

**Rule:** Spec: "WebSocket, bidirectional: server->browser snapshots, browser->server control commands." Design doc transport section, `web/` section.

**Evidence - `web/src/state/useWorldState.ts:6` and `web/src/state/useCommands.ts:6`:**
```typescript
// useWorldState.ts
const WS_URL = 'ws://localhost:3001';
// ...
const socket = new WebSocket(WS_URL);   // connection #1

// useCommands.ts
const WS_URL = 'ws://localhost:3001';
// ...
const socket = new WebSocket(WS_URL);   // connection #2
```

`App.tsx:12-13` calls both hooks unconditionally:
```typescript
const world = useWorldState();
const send = useCommands();
```

Every browser session opens two connections to the orchestrator. The spec's architecture diagram shows a single bidirectional WebSocket arrow from the orchestrator to the SPA. This contradicts that. Concretely: the server's `createBroadcaster` sends the initial snapshot to every connected socket on `'connection'`; the commands socket also receives that snapshot but never uses it. If the server ever routes commands back to the originating socket (e.g. command acknowledgments), the commands socket receives no world-state and the world-state socket sends no commands - the routing breaks. This is also the source of the R-219 violation (WS_URL defined twice).

**Direction:** Merge the two hooks into a single `useOrchestrator` (or keep two hooks but have them share a single WebSocket instance via a module-level or context-level singleton). The WebSocket must be opened once, receive snapshots on `onmessage`, and send commands via the same socket's `send`. `to confirm:` verify the server's command handler routes by message type (not by which socket sent the message); if it does, a single socket suffices. If the server routes by connection, it needs a single bidirectional socket per session.

---

### P1-4 - Commands silently discarded when command socket is not yet `OPEN`

**Rule:** Correctness; user-visible data loss.

**Evidence - `web/src/state/useCommands.ts:15-18`:**
```typescript
return (cmd: Command) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
};
```

The guard `socket.readyState === WebSocket.OPEN` is correct but the else branch is silent discard. Between mount and `OPEN` (typically <100ms on localhost but not guaranteed), any command invocation is lost with no feedback. More practically, if the socket is reconnecting after a close (once P1-2 is addressed), any command issued during the reconnect window disappears. There is no queue, no pending-command buffer, no user-facing error. A user who clicks "Pause" while the socket is connecting gets no acknowledgment.

**Direction:** In the send function, either (a) queue commands issued before `OPEN` and flush on `socket.onopen`, or (b) disable the control buttons until `readyState === OPEN` by exposing connection status from the hook and gating the `ControlBar` with a `disabled` prop. Option (b) is the simpler UX. `to confirm:` decide whether commands issued during reconnect should be queued (stateful, risk of stale commands) or discarded with visible feedback (simpler, more honest).

---

## P2 Findings

### P2-1 - `WS_URL` magic string duplicated across two files (R-219)

**Rule:** R-219 - "Any string literal appearing 2+ times becomes a named constant."

**Evidence - `web/src/state/useWorldState.ts:6` and `web/src/state/useCommands.ts:6`:**
```typescript
const WS_URL = 'ws://localhost:3001';  // in useWorldState.ts
const WS_URL = 'ws://localhost:3001';  // in useCommands.ts
```

Two identical string literals in two files. If the port changes or the URL scheme changes, both files must be updated in sync.

**Direction:** Extract `WS_URL` to `web/src/config/` (e.g. `web/src/config/websocket.ts`) or to a `web/src/constants/` module, and import from it in both hooks. Once P1-3 is addressed and the two hooks are merged, the duplication resolves naturally. `to confirm:` whether a `web/src/config/` or `web/src/constants/` directory already exists; it does not currently, so this would be a new file.

---

### P2-2 - `send` function in `useCommands` recreated on every render (CLAUDE-FRONTEND.md)

**Rule:** CLAUDE-FRONTEND.md - "`useCallback` for event handlers and async functions passed as props."

**Evidence - `web/src/state/useCommands.ts:15-18`:**
```typescript
return (cmd: Command) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
};
```

`useCommands` returns an inline arrow function literal on every call. `App` calls `useCommands()` on every render. `world` state updates arrive at ~5 Hz, so `send` is a new function reference 5 times per second. It is passed as `onCommand` to `ControlBar`. Any `React.memo` or `useCallback` optimization in `ControlBar` (or future children) that depends on `onCommand` stability breaks silently.

**Direction:** Wrap the returned function in `useCallback` with `[]` as dependency array, using `socketRef` (already a stable ref) for the socket lookup inside. `to confirm:` confirm `socketRef` is the only captured value; `useCallback(() => { ... }, [])` is safe because the ref object is stable.

---

### P2-3 - Props interfaces not named `{ComponentName}Props` (CLAUDE-FRONTEND.md)

**Rule:** CLAUDE-FRONTEND.md - "Props interfaces named `{ComponentName}Props`, defined above the component."

**Evidence - `web/src/components/KanbanBoard/KanbanBoard.tsx:7`, `web/src/components/NodeStrip/NodeStrip.tsx:7`, `web/src/components/EventLog/EventLog.tsx:6`:**
```typescript
// KanbanBoard.tsx:7
interface Props {
    frames: Frame[];
}

// NodeStrip.tsx:7
interface Props {
    nodes: WorkerNode[];
}

// EventLog.tsx:6
interface Props {
    events: LogEvent[];
}
```

All three use the generic name `Props`. `ControlBar.tsx:6-9` uses the correct pattern:
```typescript
interface Props {
    onCommand: (cmd: Command) => void;
    phase: WorldState['phase'];
}
```
(Also non-compliant - same unnamed `Props`.)

**Direction:** Rename each interface to `KanbanBoardProps`, `NodeStripProps`, `EventLogProps`, `ControlBarProps` in the respective files. `to confirm:` the rename is file-local; no exports to update.

---

### P2-4 - `[...events].reverse()` on every render (performance + allocation)

**Rule:** R-010 - "Optimize for the durable fix, not the expedient one."

**Evidence - `web/src/components/EventLog/EventLog.tsx:18`:**
```typescript
{[...events].reverse().map((event) => (
    <li key={event.id} className={`${styles.row} ${styles[event.level]}`}>
```

At 5 Hz with up to 200 events per the server's cap, this spreads and reverses a 200-element array on every render of the EventLog component - a 200-element array allocation + traversal 5 times per second purely for display order. The events array is already stored newest-last in the server (each `appendEvent` push to the tail); reversing in the component is a display concern.

**Direction:** The canonical CSS approach is `flex-direction: column-reverse` on the `.list` container - the DOM renders elements in source order but the visual stack is inverted, and new items appear at the top with no JS work. Alternatively, `useMemo` the reversed array with `events` as the dependency, which bounds the work to one reversal per state update rather than one per render. `to confirm:` whether `column-reverse` interacts correctly with the scroll behavior (the log scrolls from bottom; `column-reverse` + `overflow-y: auto` needs `justify-content: flex-start` to anchor new items at the visual top).

---

### P2-5 - `ControlBar` root element is `<div>` with no accessible role (Accessibility - project CLAUDE.md)

**Rule:** Project CLAUDE.md Accessibility section - "Semantic HTML over `div` + `role`; interactive elements natively focusable; WCAG 2.1 AA."

**Evidence - `web/src/components/ControlBar/ControlBar.tsx:14`:**
```typescript
<div className={styles.bar}>
    <button type="button" onClick={() => onCommand({ type: paused ? 'resume' : 'pause' })}>
    ...
```

A collection of operator controls with no landmark role and no accessible label. Screen reader users encounter four anonymous buttons with no grouping context. The ARIA authoring practices define `role="toolbar"` for a group of controls that operate on a document or application. Without it, the button group has no structural identity.

**Direction:** Change the root `<div>` to use `role="toolbar"` with `aria-label="Operator controls"`. Alternatively, wrap in a `<nav aria-label="Operator controls">` if these are considered navigation actions (less appropriate here than toolbar). `to confirm:` check whether the ARIA toolbar role requires arrow-key navigation between toolbar items per the APG toolbar pattern; if so, keyboard handler logic is also needed.

---

### P2-6 - `<time>` elements missing `datetime` attribute (Accessibility / WHATWG spec)

**Rule:** WHATWG HTML spec for `<time>`; project CLAUDE.md Accessibility - semantic HTML.

**Evidence - `web/src/components/EventLog/EventLog.tsx:20`:**
```typescript
<time>{formatTime(event.ts)}</time>
```

`formatTime` at line 11 returns `new Date(ts).toLocaleTimeString()` - a locale-dependent human string. The `<time>` element's semantic value is its machine-readable `datetime` attribute. Without `datetime`, assistive technology and machine parsers cannot interpret the element as a point in time. The human-readable content is ambiguous (locale, 12/24h format).

**Direction:** Add `datetime={new Date(event.ts).toISOString()}` to every `<time>` element. `to confirm:` `new Date(event.ts).toISOString()` produces a valid datetime string (ISO 8601); verify `event.ts` is a Unix ms timestamp (it is, per the shared `LogEvent` type `ts: number`).

---

### P2-7 - Hardcoded hex colors in component SCSS modules (CLAUDE-STYLING.md)

**Rule:** CLAUDE-STYLING.md - "All colors come from custom properties; never hardcode hex values in component SCSS."

**Evidence - `web/src/components/KanbanBoard/KanbanBoard.module.scss:43`:**
```scss
.card {
    ...
    background: #1f2630;
    ...
}
```

**Evidence - `web/src/components/NodeStrip/NodeStrip.module.scss:52`:**
```scss
.track {
    ...
    background: #0d1117;
    ...
}
```

`#0d1117` is identical to the `--bg` custom property defined in `web/src/styles/global.scss:2` (`--bg: #0d1117`). `#1f2630` is an undeclared color with no corresponding token. Both should be CSS custom properties. If the color theme changes, these hardcoded values will not update.

**Direction:** Add `--card-bg: #1f2630;` (or a suitable semantic name like `--panel-alt`) to the `:root` block in `global.scss` and replace the hex in `KanbanBoard.module.scss`. Replace `#0d1117` in `NodeStrip.module.scss` with `var(--bg)`. `to confirm:` no other component uses `#1f2630`; if it is unique to the kanban card, add as a distinct token.

---

### P2-8 - Dead CSS selector in `App.module.scss` (correctness)

**Rule:** R-010 - eliminate dead code; R-226 one responsibility per file.

**Evidence - `web/src/App.module.scss:35-37`:**
```scss
.header .app :global(button) {
    grid-column: 2;
}
```

`.app` is the root `<main>` element. `.header` is a direct child of `.app`. No element inside `.header` can have an ancestor with the `.app` class; the nesting direction is reversed. This selector cannot match any element in the rendered DOM. CSS Modules compiles it to `.App_header__xxx .App_app__xxx button`, which is also unreachable. The effective grid placement is handled by the correct selector on line 39-42:

```scss
.header > :last-child {
    grid-column: 2;
    grid-row: 1 / span 2;
}
```

The `:global(button)` rule is dead code that misleads future maintainers.

**Direction:** Delete lines 35-37 (`web/src/App.module.scss:35-37`). The layout relies entirely on `.header > :last-child`. `to confirm:` visually verify the header layout is unchanged after deletion; it should be, since the matching rule is on line 39.

---

### P2-9 - `ControlBar.module.scss` and `EventLog.module.scss` use bare element selectors (CLAUDE-STYLING.md)

**Rule:** CLAUDE-STYLING.md - "camelCase for all class names; no BEM; use class selectors for variants."

**Evidence - `web/src/components/ControlBar/ControlBar.module.scss:5-22`:**
```scss
.bar {
    ...
    button {
        padding: 6px 10px;
        ...
        &:hover { ... }
        &:focus-visible { ... }
    }
}
```

**Evidence - `web/src/components/EventLog/EventLog.module.scss:31-45`:**
```scss
.info span {
    color: var(--text);
}
.success span {
    color: var(--success);
}
.warn span {
    color: var(--warn);
}
.danger span {
    color: var(--danger);
}
```

Bare element selectors (`button`, `span`) inside SCSS modules are fragile: they apply to any button or span that appears as a descendant, and they break if the HTML element is changed (e.g., using an anchor styled as a button). Class-based selectors are explicit and refactor-safe.

**Direction:** In ControlBar, give each button a class (e.g. `.controlButton`) and style that class. In EventLog, give the message `<span>` a class (e.g. `.message`) and target `.info .message`, `.success .message`, etc. `to confirm:` the EventLog `<li>` renders `<time>` and `<span>` as direct children; only the `<span>` carries the message color, so `.message` or `.eventMessage` is the correct target.

---

## P3 Findings

### P3-1 - `useEffect` cleanup in `useCommands` does not null `socketRef`

**Rule:** React hook correctness; defensive programming.

**Evidence - `web/src/state/useCommands.ts:10-14`:**
```typescript
useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;
    return () => socket.close();
}, []);
```

After the cleanup runs (`socket.close()`), `socketRef.current` still holds the closed socket. A subsequent call to `send(cmd)` checks `socket.readyState === WebSocket.OPEN`, which returns `false` for a closed socket, so no actual send occurs. The stale ref is benign due to the readyState guard but is hygienically incorrect. In StrictMode (enabled in `main.tsx`), effects mount/unmount/remount; the ref is set to the first socket, that socket is closed, then set to the second socket. The timing gap between close and remount is where the stale ref is observable.

**Direction:** Add `socketRef.current = null;` in the cleanup function, after `socket.close()`. `to confirm:` the send function already guards on `socket && socket.readyState === WebSocket.OPEN`; the null ref is handled by the `socket &&` check.

---

### P3-2 - Dynamic CSS module key access on `node.state` (type safety)

**Rule:** TypeScript strict mode; defensive SCSS module access.

**Evidence - `web/src/components/NodeStrip/NodeStrip.tsx:14`:**
```typescript
<article key={node.id} className={`${styles.node} ${styles[node.state] ?? ''}`}>
```

`styles[node.state]` is an indexed access on a CSS Module object. TypeScript types CSS Module imports as `{ [className: string]: string }`, so this compiles without error, but TypeScript won't catch a mismatch between `node.state` values and defined class names. Currently `NodeStrip.module.scss` defines `.crashed` and `.spawning` but not `.idle`, `.rendering`, or `.compositing`. The `?? ''` handles the missing class, but the intent (apply a state-variant class only for `crashed` and `spawning`) is implicit.

**Direction:** Use an explicit map or conditional expression: `node.state === 'crashed' ? styles.crashed : node.state === 'spawning' ? styles.spawning : ''`. This makes the two special cases explicit and gives TypeScript a chance to catch unused branches if `NodeState` changes. `to confirm:` R-242 prohibits nested ternaries; the above replaces one obscure indexed access with an explicit conditional but introduces nesting. Use a lookup object `const STATE_CLASS: Partial<Record<NodeState, string>> = { crashed: styles.crashed, spawning: styles.spawning }` and `STATE_CLASS[node.state] ?? ''` instead.

---

### P3-3 - No ESLint configuration in the web package

**Rule:** CLAUDE-FRONTEND.md - "`@typescript-eslint/naming-convention`... `curly: 'error'`... No unused imports... No explicit `any`."

No ESLint config (`.eslintrc.*`, `eslint.config.js`, or `lint` script) exists in `web/`. The conventions listed in CLAUDE-FRONTEND.md are unenforced mechanically. Naming violations, unused imports, and `any` usage in future edits will not be caught at the editor or pre-commit level.

**Direction:** Add an `eslint.config.js` to `web/` with `@typescript-eslint/recommended`, `@typescript-eslint/naming-convention`, `no-nested-ternary`, and `react-hooks/rules-of-hooks`. Add a `"lint": "eslint src"` script to `web/package.json`. `to confirm:` check whether a root-level ESLint config in the monorepo already covers the web workspace via `extends`; none was found, so a workspace-level config is needed.

---

### P3-4 - `formatTime` allocates a `Date` object for every event on every render

**Rule:** R-010 - durable fix over expedient; minor performance.

**Evidence - `web/src/components/EventLog/EventLog.tsx:10-12`:**
```typescript
function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
}
```

Called once per event per render. At 5 Hz with 200 events, this is 1000 `Date` allocations per second. This is negligible for a demo but becomes unnecessary once P2-4 (reverse) is addressed, since `useMemo` on the event list would also be the place to pre-compute timestamps.

**Direction:** Pre-compute `formatTime` once per event entry (outside the render path) or memoize the formatted list alongside the reverse in a `useMemo` that depends on `events`. `to confirm:` this is a P3 note; address after P2-4.

---

## Architecture and Design

**What is correct:**
- `web/src/` taxonomy follows R-240 (`components/<PascalCase>/`, `state/`, `styles/`) and the project spec's intended layout.
- `@demo/shared` is consumed correctly via workspace alias; no relative cross-package imports.
- `state/` is the correct location for WebSocket hooks per R-240 (`state/` = stores, hooks, context providers).
- Component files each carry one responsibility at the demo's scope; `App.tsx` is a clean orchestrator.
- File-level header comments (R-230) are present on all `.ts`/`.tsx` files.
- `verbatimModuleSyntax: true` is correctly respected: all type-only imports use `import type`.

**What is architecturally concerning:**
- The dual-socket design (P1-3) is the primary architectural finding. It violates the spec's bidirectional model and adds unnecessary complexity.
- The hooks expose no status channel (`connecting | open | closed`). For any production use this would be a hard requirement; for the demo it means silent failures.

---

## Code Quality

- Naming: R-217/R-232/R-233 are followed for functions (`formatTime`, `useWorldState`, `useCommands`). Component names are PascalCase. `EMPTY` is correctly `ALL_CAPS`.
- Magic strings: `WS_URL` duplication flagged at P2-1. Stage labels (`'QUEUED'`, `'RENDERING'`, etc.) correctly come from `STAGES` constant; no magic stage strings in the web surface.
- R-215 (no IIFE): compliant; no IIFEs found.
- R-242 (no nested ternary): one candidate at `NodeStrip.tsx:14` (`styles[node.state] ?? ''`) but this is indexed access, not a nested ternary. Compliant.
- R-001 (no em dash): compliant.

---

## Accessibility

| Check | Result |
|---|---|
| Semantic HTML (`<main>`, `<header>`, `<section>`, `<article>`, `<ul>`, `<li>`) | Pass |
| Single `<h1>` per page | Pass (`<h1>` in header, `<h2>` for column titles) |
| `aria-label` on landmark sections | Pass (KanbanBoard, NodeStrip, EventLog all carry `aria-label`) |
| `aria-live="polite"` on EventLog | Pass |
| `aria-label="high priority"` on priority badge | Pass |
| `aria-hidden="true"` on decorative progress bars | Pass |
| `<button>` with `type="button"` on all controls | Pass |
| `focus-visible` ring on buttons | Pass (ControlBar.module.scss) |
| ControlBar group landmark/role | FAIL (P2-5) |
| `<time datetime=...>` | FAIL (P2-6) |
| `prefers-reduced-motion` | Pass - `global.scss:30-34` applies `animation: none !important; transition: none !important` universally |
| Inline styles for dynamic width (progress bars) | Acceptable - dynamic percentage widths require runtime values; CSS custom property `var(--pct)` is the alternative but `style={{ width: \`${x}%\` }}` is the standard approach in React for this pattern. No finding. |

---

## Styling

| Check | Result |
|---|---|
| SCSS modules used for all components | Pass |
| `camelCase` class names | Pass |
| No BEM | Pass (no `__`/`--`) |
| CSS custom properties for colors | FAIL (P2-7: two hardcoded hex values) |
| No Tailwind / no utility classes | Pass |
| Nesting depth <= 2 levels (excl. pseudo-classes) | Pass |
| `prefers-reduced-motion` | Pass (global rule) |
| Dead CSS | FAIL (P2-8: `.header .app :global(button)`) |
| Element selectors inside modules | FAIL (P2-9) |

---

## Performance

No client-side polling. Data arrives via WebSocket push (~5 Hz server-side throttle). No TanStack Query, no `refetchInterval`, no `setInterval` in the web surface (no polling primitives found). The server-side broadcast cadence is correct: the SPA consumes pushes, not polls.

The only performance concern is P2-4 (`[...events].reverse()` on every render), which is bounded by the 200-event server cap.

---

## Security

No authentication surface in this demo (by design). No user-supplied input is rendered as HTML. Event messages from the server are rendered as text nodes, not `dangerouslySetInnerHTML`. No secrets or credentials in the web surface. No third-party scripts. Acceptable for a local demo.

---

## Dependencies

| Package | Version | Note |
|---|---|---|
| `react` | `^18.3.1` | Current 18.x. No React 19 features used. |
| `react-dom` | `^18.3.1` | Matches React. |
| `@vitejs/plugin-react` | `^4.3.4` | Current. |
| `vite` | `^6.0.0` | Current 6.x. |
| `sass` | `^1.83.0` | Current. |
| `typescript` | `^5.6.0` | Slightly behind 5.7/5.8 but no CVEs. |

No known CVEs in declared dependencies. No lockfile committed (`package-lock.json` is at the monorepo root). This is acceptable for a local demo but a lockfile ensures reproducible installs.

---

## Bug Fix Discipline

No git history (repo not initialized). No fix commits to audit. This section cannot be evaluated.

---

## Runbook-vs-Code Drift

No runbooks in `docs/runbooks/`. The design doc and plan are informational. No drift findings.

---

## Workspace Hygiene

Project is at `/Users/iangreenough/Desktop/code/personal/development/distributed-system-demo`. This is a development workspace - expected location for this category of project. No duplicate copies found in the audit scope.

---

## Tech Debt Register

| ID | Item | Risk | Notes |
|---|---|---|---|
| TD-W1 | Dual WebSocket connections | High | Spec violation; silent failures on command routing |
| TD-W2 | No reconnection logic | High | Demo appears broken on server restart |
| TD-W3 | Committed `.js` artifacts | High | Stale output serves during `vite dev` |
| TD-W4 | No ESLint config | Medium | Conventions unenforced mechanically |
| TD-W5 | Missing connection-status UI | Medium | Silent disconnection UX |
| TD-W6 | `send` ref instability | Low | Premature optimization concern; affects future memoization |

---

## Prioritized Recommendations

| Priority | Finding | Impact | Effort |
|---|---|---|---|
| 1 | P1-1: Delete `.js` artifacts; add `outDir`; update `.gitignore` | H | L |
| 2 | P1-2: Add reconnection + `onerror`/`onclose` to both hooks; add connection status UI | H | M |
| 3 | P1-3: Merge dual sockets into single bidirectional WebSocket | H | M |
| 4 | P1-4: Queue or gate commands until socket is `OPEN` | H | L |
| 5 | P2-1: Extract `WS_URL` to a single constant module | M | L |
| 6 | P2-5: Add `role="toolbar"` + `aria-label` to ControlBar | M | L |
| 7 | P2-6: Add `datetime` attribute to `<time>` elements | M | L |
| 8 | P2-4: Replace `[...events].reverse()` with CSS `column-reverse` or `useMemo` | M | L |
| 9 | P2-7: Replace hardcoded hex colors with CSS custom properties | L | L |
| 10 | P2-8: Delete dead `.header .app :global(button)` CSS selector | L | L |
| 11 | P2-9: Replace element selectors with class selectors in ControlBar and EventLog SCSS | L | M |
| 12 | P2-2: Wrap `send` in `useCallback` | L | L |
| 13 | P2-3: Rename `Props` to `{ComponentName}Props` in all four components | L | L |
| 14 | P3-1: Null `socketRef.current` in `useCommands` cleanup | L | L |
| 15 | P3-2: Replace dynamic `styles[node.state]` with explicit lookup map | L | L |
| 16 | P3-3: Add ESLint config to web package | M | M |
