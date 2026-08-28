# UI Audit — Desktop Client (Playwright, 2026-08)

Automated pass over every screen of the desktop client, driven with Playwright
against the real app (Mock OpenCode Server + vite dev + `tests/e2e/tauri-shim.js`),
plus a production-build measurement and an axe-core scan. Purpose: find concrete
improvements in layout/design, desktop operation convenience, performance, and
the settings center.

Evidence screenshots: `docs/screenshots/audit-2026-08/` (21 captures referenced
below as `shot:`).

## 1. Method & environment

| Aspect | Value |
|---|---|
| Driver | Playwright Chromium, viewport 1280×800 (+ 1024×640 and 860×560 squeeze passes) |
| App under test | vite dev @ :1420, `VITE_TRANSPORT=fetch` → Mock OpenCode Server @ :14096 |
| Tauri surface | browser shim (`tests/e2e/tauri-shim.js`) — IPC fakes, no real window/tray/pet/updater |
| Production measurement | `pnpm build`, asset sizes incl. gzip |
| Accessibility | axe-core scan of the workspace screen |
| Theme | Light only (headless `prefers-color-scheme: light`); dark theme not exercised |

Caveats: this is **web mode under the shim**. Window chrome (traffic lights,
drag region), tray, pet window, notifications, updater and cold-start timing are
not covered here. Latency figures are warm dev-server numbers, useful for
relative comparison only.

## 2. Verified defects / polish (fix first)

| # | Finding | Evidence |
|---|---|---|
| V1 | Dev placeholder ships to users: chat/diff empty state reads **“Select a session — M2”** — a leftover milestone marker, hardcoded English (also violates the i18n rule). | `src/shells/desktop/DesktopShell.tsx:1264`, `:1436`; shot: `06-workspace-no-session.png` |
| V2 | More hardcoded English UI copy in the shell: “Back to servers” (`:1038`), main tabs “Chat”/“Files” (`:1150`,`:1162`), sidebar tab “Files” (`:1072`). | same file |
| V3 | Global summon shortcuts (⌘K palette, ⌘P quick open, ⌘⇧F search) are **dead while any text control has focus** (registry `inputGuard`). Probed: composer focused → ⌘K blocked; session-search focused → blocked; body focus → opens. Desktop users expect modified summons to work anywhere. | probe output (§6); `src/features/settings/shortcuts.ts:294-301`; shot: `13b-command-palette-open.png` (works from body) |
| V4 | Collapsed sidebar has **no pointer affordance to restore** — the rail holds only server/add/settings buttons; ⌘B is the only way back. Discoverability gap. | probe: rail buttons = `[rail-item-srv-1, rail-add, rail-settings]`; shot: `18-sidebar-collapsed.png` |
| V5 | ~~Transcript bottom clipping~~ **Re-checked, not a defect**: the virtual rows carry their own `pb-4` (measured height includes it), `totalHeight` adds no extra trailing space but the auto-scroll pins the newest row above the docked panel, and the TaskPanel is a normal flow sibling (not an overlay). The mid-glyph cut in the capture is an ordinary scrolled intermediate state, not overlap. No fix shipped. | shots: `22-workspace-1024.png`, `23-workspace-860.png`; code: `MessageList.tsx:457-494`, `useVirtualList.ts:122-127` |
| V6 | Server card shows **“Never connected” next to live “3 ms” latency** — contradictory copy from two data sources. | shot: `04-home-grid.png` |
| V7 | Home empty state is vertically unbalanced: the guide text floats detached below the top-left Add card over a large void. | shot: `01-home-empty.png` |
| V8 | Add-provider dialog shows **“Provider ID is required” before any input** (premature validation). | shot: `21-provider-add-dialog.png` |

## 3. Layout & design findings (per screen)

**Server home.** Card grid works well (name/URL/version·latency/health dot/menu).
Improvements: center or enrich the empty state (V7); reconcile the
connected/latency copy (V6); consider showing recent sessions or a compact
“last opened” hint on cards to make the launcher feel alive.

**Workspace / chat.** Three-pane skeleton (rail | sidebar | main) is sound.
Issues: session title in the chat header is small gray text — hierarchy weaker
than the content below it; a timestamp under every message adds noise (group or
dim further); the “Thinking process … 35 chars” bar renders like a disabled
input; the Tasks panel's right-side red/orange dots have no legend (priority?
status?) — unclear at first sight; large dead zone between the last message and
the docked Tasks panel when transcripts are short (acceptable, but a max-width
transcript column would balance it).

**Sidebar.** Two stacked full-width buttons (“+ New session”, “+ Add workspace”)
plus a search field consume ~120px before content; could be one row of actions.
Session rows are clean; loading spinners on stale rows read as persistent
brokenness (they were mid-load in the capture).

**Files (dual “Files” naming).** The sidebar switches `Workspaces | Files`
while Main switches `Chat | Files` — two different scopes sharing one label.
Rename the sidebar tab (e.g. “Tree”/“Explorer”) or merge tree+viewer mental
model. `node_modules` appears in the tree (italic “ignored” styling) — hide
ignored dirs by default with a toggle. Viewer empty state (“No file open”) is
fine but should offer a Quick Open button.

**Search panel.** Replaces the whole viewer area; results can't be read
side-by-side with a file, and “No matches” gives no scope context (which
directory was searched). A bottom/split layout like VS Code, plus a scope line,
would help.

**Diff view.** Clean unified/split rendering with per-file badges and ±stats.
Gaps: ADDED/DELETED files render a bald “Content not available for this diff.”
row (should be a styled placeholder or collapsed); no sticky per-file header or
prev/next-file navigation for long diffs.

**Changes (VCS).** Branch chip + count + Workspace diff/Refresh are good. The
list occupies the top ~40% with a large dead middle before the permanent
“Apply patch” box — let the list flex and move Apply patch into a dialog.

**Terminal.** Full-main-view replacement means chat and terminal never coexist
(no split/bottom-dock option); creating a terminal always routes through the
shell-picker dropdown — default shell should spawn instantly with the picker as
an alternative. Listing “fish (unsupported)” is good transparency.

**Command palette.** Works (sessions/commands/settings groups) but: no footer
key-hint row (↑↓/↵/esc), backdrop barely dims the page, “New session” sits
under the SETTINGS heading (miscategorized), session rows lack metadata.

**Status bar.** Chips are icon+number only (`main · 2 · biome · tokens/cost`);
meanings live in hover tooltips only. Fine for density, but consider brief
labels at ≥1280px widths.

## 4. Desktop operation convenience

Verified behaviors (probe script):

- ⌘, opens settings ✓; Esc stable with no overlay ✓; ⌘D diff, ⌘J terminal,
  ⌘B sidebar, ⌘⇧F search all fire from non-input focus ✓.
- **V3** is the main gap: all modified summons die inside text controls —
  including the search panel's own input, so “search, then hit ⌘P to open a
  result path” fails silently. Recommendation: exempt modified (⌘-bearing)
  global actions from `inputGuard`; keep the guard for plain-key locals
  (Tab/↑/Esc). Browser-reserved risk is limited to ⌘P(print)/⌕K(CRX) which the
  webview already suppresses elsewhere.
- **V4**: add a sidebar-toggle button to the rail (it is already documented as
  “the toggle affordance” but has no button).
- Right-click menus are rich (server card menu verified: QR/Edit/Reconnect/
  Delete; text-selection menu wired app-wide).
- Window squeeze behavior: 1024px holds up; at 860px the chat area is nearly
  consumed by Tasks+composer (only one bubble visible). Auto-collapse the
  sidebar below ~900px, and default-collapse the task panel when main < 700px.

## 5. Performance

Production build (`pnpm build`, 2026-08):

| Metric | Now | Recorded in `docs/performance.md` (2026-08-05) | Note |
|---|---|---|---|
| Startup bundle `index-*.js` | **1,057.18 KB (gzip 320.46 KB)** | 1,000.36 KB (gzip 304.79 KB) | +57 KB raw / +16 KB gzip drift since M9-08 — still budget-shaped, but trending up; add a CI size-limit (e.g. gzip ≤ 330 KB) |
| xterm (TerminalPanel chunk) | 346.25 KB (gzip 88.77 KB), lazy ✓ | 346.2 KB (gzip 86.7 KB) | stays out of startup |
| Total web assets | 10.76 MB (gzip 2.15 MB), 315 files | ~11 MB | dominated by shiki grammars, all lazy |

Warm interaction latencies (dev server): home visible ≈ 200 ms after goto;
card click → workspace shell 37 ms; session click → message list 49 ms; gear →
settings dialog 26 ms. Nothing pathological; the ⌘K “30 s open” in the first
audit run was V3 (blocked, not slow).

Unchanged exemptions from `docs/performance.md`: true cold start, resident
memory, and installer size need a packaged Tauri runtime.

Vite warns about >500 KB chunks (`wasm` 622 KB, `cpp` 785 KB, `emacs-lisp`
790 KB shiki grammars) — these are lazy-loaded language packs; acceptable, but
`build.chunkSizeWarningLimit` tuning or per-grammar splitting would silence the
noise honestly.

## 6. Accessibility spot-check

axe-core on the workspace screen: 1 serious `color-contrast` violation, 1 minor
`aria-allowed-role`. Small counts (see `docs/a11y-report.md` for the earlier
full pass) — fix the contrast instance and re-run axe across settings/dialogs.

## 7. Settings center — functionality & layout

Structure: 15 sections, desktop sidebar nav + search, rendered in a modal
dialog (`SettingsDialog`) floating above the workspace.

Functionality gaps:

1. **Duplication / IA**
   - *General* and *About* both show app identity, version, links — merge.
   - *Models* section is a single “Default model” row that also exists in
     *Config* (two editors for the same value). Fold Models into Config or make
     Models show the provider/model catalog.
   - *Servers* section shows an **unlabeled toggle** per server — it is the
     per-server notification switch, labeled only in *Notifications*. Label it
     or remove it there.
   - Appearance's “Server override” reappears in *Servers* — consistent but
     redundant; pick one home.
2. **Search filters sections only** (title/hint/keywords) — typing “accent”
   highlights nothing actionable. Index individual control labels and jump to
   the control (or at least auto-open the section and flash the row).
3. **No live preview**: the modal dims the workspace, so theme/accent/UI-scale
   changes can't be judged against real content without closing. Lighter
   backdrop, or a non-modal settings panel, would let changes read through.
4. Section nav is a flat 15-item list — group headers
   (App | Connections | Model providers | System | Advanced) would help
   scanning; also add a scroll fade/shadow (Shortcuts list cuts mid-row with no
   affordance).
5. *Desktop* section is minimal (close-to-tray, summon accelerator) — natural
   future home for “start at login”, “dock/tray mode”, default terminal shell.
6. *Diagnostics* is strong (log console, forwarding, saved permission rules);
   add log export/copy and timestamps to captured entries.
7. Provider cards: password-style inputs prevent verifying a stored key (fine),
   but a masked “copy” affordance and last-updated date would help management;
   card stack gets tall with many providers — rows would scale better.
8. Shortcut capture UX is good (click combo → press keys, conflict detection,
   reset all); missing: per-row reset and a filter box.

## 8. Prioritized recommendations

| Priority | Item | Ref |
|---|---|---|
| P0 | Replace “Select a session — M2” placeholder with proper i18n copy | V1 |
| P0 | Route remaining hardcoded shell strings through `t()` | V2 |
| P0 | Allow ⌘-modified global summons inside text controls (drop inputGuard for them) | V3 |
| P1 | Rail button to restore collapsed sidebar | V4 |
| P1 | ~~Fix transcript clipping under task panel~~ re-checked: in-flow layout + auto-scroll, no overlap (see V5) | V5 |
| P1 | Resolve dual “Files” naming; hide ignored dirs by default | §3 |
| P1 | De-duplicate settings sections (General/About, Models/Config), label Servers toggle, grouped nav, deeper search | §7 |
| P1 | CI bundle-size guard; investigate +57 KB drift | §5 |
| P2 | Empty-state composition on home; card copy fix | V6, V7 |
| P2 | Search/diff/changes layout refinements (split views, sticky headers, flex list, Apply-patch dialog) | §3 |
| P2 | Palette footer hints + grouping fix; status-bar labels on wide windows | §3 |
| P2 | Terminal: instant default spawn + optional bottom-dock mode | §3 |
| P2 | Premature validation in Add-provider; provider row layout | V8, §7 |
| P2 | Fix axe color-contrast finding | §6 |

## 9. Reproduction

```bash
pnpm mock:start --cors --port 14096 &
VITE_TRANSPORT=fetch VITE_MOCK_BASE_URL=http://localhost:14096 pnpm dev -- --port 1420 &
# drive tests/e2e-style journeys with @playwright/test chromium against :1420
```

Probe results quoted in §4/§8 were produced by a temporary driver (not
committed); the steps are deterministic and re-runnable from this description.
