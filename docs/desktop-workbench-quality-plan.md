# Desktop workbench quality upgrade

Status: implementation authorized by the user on 2026-10-03.

## Goal and reference

Use the supplied Codex screenshot as the visual reference: quiet neutral-gray chrome,
a session sidebar, a stable chat canvas, and a resizable right workspace with
browser-style tabs. The existing API and mobile navigation remain the baseline.
Older presentation proposals are not implementation inputs.

## TASK-WORKBENCH-01

Prerequisites: current desktop shell, viewer store, file viewer, theme store, and
existing reduced-motion tokens. No new dependencies or API endpoints are required.

Scope:

- `src/shells/desktop/`: workspace tabs, panel sizing, shell integration, tests.
- `src/features/files/FileViewer.tsx` and its tests: externally managed file tabs,
  safe asynchronous loading, retained scroll positions.
- `src/features/messages/markdown/highlighter.ts`, `MarkdownText.tsx`, and matching
  tests: recognize gray as a light syntax theme and retain code during theme changes.
- `src/stores/theme.ts`, theme/token tests, `src/styles/`, `index.html`: neutral-gray
  theme and first-paint parity, scoped workspace motion.
- `src/features/settings/AppearanceSection.tsx`: expose the gray theme if needed.
- `src/i18n/en.json`, `src/i18n/zh-CN.json`: matching localized controls.
- `tests/e2e/`: workbench acceptance and update selectors for affected journeys.
- `tests/mock-server/scenarios/index.ts` and `self-test.mjs`: add an isolated
  interactive permission scenario for E05, preserving the old timed scenario.
  Final validation exposed its 500ms auto-reply window racing the real click;
  the interactive journey must drain via the actual reply POST instead.
- Both changelogs and this implementation record.
- Existing accessibility harness, compact-menu assertions, and transcript snapshot:
  align stale test expectations with the existing UI while keeping accessibility
  rules and journey assertions active.

### Design decisions

1. Gray is an explicit selectable theme, the desktop default when no preference
   exists. Existing saved light/dark/system selections and custom accent colors
   remain honored. Mobile keeps its existing default behavior.
2. Use neutral surfaces, subtle dividers, compact tabs, system fonts, and restrained
   shadows. The chat canvas stays visually distinct from the chrome.
3. The right workspace combines file and tool tabs. Users can add review, files,
   and browser pages, select them, and close them. Reopening an existing file
   focuses its existing tab. Closing the active tab selects a neighbor; closing
   the final tab leaves a useful empty state with an add control.
4. Browser tabs each own their address and frame state. Hiding the panel and
   switching tabs preserve visited content. Project/server changes clear context
   bound tabs so content cannot leak between workspaces.
5. File content continues to use the existing viewer store and cache. File tabs
   integrate into the outer tab strip without a duplicate strip. Markdown
   preview/source controls remain reachable.
6. Preserve the main chat/composer during tool navigation. Wider desktop windows
   use three working columns; narrow windows clamp the tool width to keep the
   chat usable, with explicit tools maximize and sidebar collapse controls.
7. Splitter pointer updates are batched with requestAnimationFrame. Persist widths
   on release or discrete keyboard changes, not every move. Clean up frames,
   listeners, and observers on teardown.
8. Use short opacity/color transitions for tabs and surfaces. Avoid continuously
   animating layout dimensions or transcript rows during resize. Respect reduced
   motion and reserve stable loading areas.

### Ownership

The main agent owns architecture, FileViewer integration, localization, final diff
review, changelogs, and release boundaries. Per the repository execution playbook,
one implementation agent owns desktop-shell files, and one owns theme/style files.
After completing the theme files, the theme agent handles the small shared
highlighting integration identified during rendered inspection.
Agents do not commit or push; verification and a scoped local commit follow the
completed integrated change. The existing untracked presentation proposal is
outside this task.

### Acceptance

- Gray default and selectable gray appearance survive reload without first-paint
  color changes; existing explicit theme choices still work.
- Session sidebar, chat, and workspace are simultaneously usable at desktop sizes.
- File/tool/browser tabs open and close independently and are keyboard accessible.
- Switching/hiding tabs retains content and scroll state; closed tabs release their
  resources; context changes isolate content.
- File opening, search hits, message diffs, and quick-open target the workspace.
- Splitter resize is bounded, frame-batched, keyboard accessible, and recoverable.
- Reduced motion disables introduced animations; no animated transcript reflow.

### Verification and delivery

Add focused L1/L2 tests for theme defaults, tab lifecycle, context resets,
file-loading races, and resize behavior. Add browser acceptance for tabs, retained
content, geometry, and reduced motion. Inspect rendered desktop screenshots in
gray and dark themes, and run `pnpm verify` and `pnpm test:e2e` before committing.
Record actual results and any blockers, without treating build/tests as visual
acceptance. Commit with both Unreleased changelog entries using
`feat(desktop): add a polished tabbed workbench`. No version bump or remote push
is part of this request.
