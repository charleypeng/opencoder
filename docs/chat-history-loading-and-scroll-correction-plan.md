# Chat History Loading and Scroll Correction Plan

## 1. Purpose

This plan addresses two correctness defects in the desktop chat page:

1. An existing session can open as an empty page even though the server has conversation history. Compacted sessions are especially vulnerable.
2. A conversation can reach its final message while the scrollbar still permits a large, empty scroll range below it.

The target is correctness first: available history must become visible promptly, older history may continue loading in pages, and the scroll range must end at the real transcript bottom. This task must not redesign message styling, disclosure animation, the composer, or surrounding desktop chrome.

This document was produced from the reported recording and direct inspection of the relevant source and tests. No other Markdown document in `docs/` was used as input.

## 2. Evidence Collected

### 2.1 Recording observations

The recording shows the selected session rendering only a small tail of the transcript near the top of the chat pane:

- one completed run summary;
- a short assistant line;
- one changed-files summary;
- a timestamp;
- a large unused area before the composer;
- an intermittent loading indicator near the top-center of the message viewport.

This is consistent with a partially restored history plus unstable paging feedback. The recording alone cannot prove whether all missing rows were absent from the store or filtered after loading, so the implementation must instrument both stages.

### 2.2 Confirmed source behavior

The current implementation has these relevant properties:

- `MessageList.tsx` fetches the newest 50 records first.
- If that page contains a compaction part, `MessageList.tsx` waits for every older page before clearing the main `loading` state.
- While the main `loading` state is true, already available visible rows are not rendered.
- Message records are transformed into agent rows, and internal continuation/compaction control messages can be hidden. Therefore, a non-empty API page can still produce zero visible rows.
- `usePaginatedMessages.ts` exposes only `hasMore` and `loadingEarlier`; it cannot distinguish initial loading, first visible content ready, background backfill, exhaustion, replay protection, or earlier-page failure.
- `useVirtualList.ts` derives one scroll limit from estimated/measured virtual height and another from DOM `scrollHeight`, then keeps the larger limit. A stale oversized DOM range therefore cannot be reduced by this reconciliation rule.
- The virtualizer persists across session changes and has no explicit session-generation reset for measurements, observers, and internal scroll state.

### 2.3 Test gap

The focused suite currently passes:

```text
3 test files passed
45 tests passed
```

That passing result does not cover the reported behavior:

- one test explicitly requires a compacted session to remain in one blocking loading state until all history is restored;
- unit tests provide synthetic `clientHeight`, `scrollTop`, or `scrollHeight`, so they do not validate browser layout convergence;
- no browser test asserts that visible first-page rows remain mounted during background history loading;
- no browser test compares the final message boundary, composer boundary, and actual maximum `scrollTop`;
- no test covers a full page of server records that becomes zero visible rows after control-message filtering and is followed by a delayed visible page.

## 3. Product Invariants

The implementation is complete only when all of these invariants hold.

### 3.1 History invariants

1. If the current session store already contains visible rows, opening that session must render those rows immediately while server refresh runs.
2. If the first server page contains at least one visible row, that row must be rendered as soon as the first request resolves. Loading older pages must not replace the transcript with a global loader.
3. If a fetched page contains only hidden control records, automatic paging continues until one of these conditions is reached:
   - a visible row is produced;
   - the server reports the end of history;
   - cursor replay or non-advancement is detected;
   - the request fails or is cancelled.
4. Once any visible row has been shown, background paging must never return the session to the global loading or empty state.
5. The empty state is valid only after the initial request has completed, pagination is exhausted, and the derived visible-row count is zero.
6. A session switch must prevent late responses from the previous session from changing the active session's loading state, cursor, rows, or scroll position.
7. Internal protocol records may remain hidden, but the user-visible conversation before and after a compaction event must remain recoverable. A compaction event must not be treated as permission to discard previous visible history.

### 3.2 Scroll invariants

1. The transcript has exactly one authoritative content height at any settled render.
2. After layout settles:

   ```text
   0 <= scrollTop <= max(0, scrollHeight - clientHeight)
   ```

3. When the user is following the bottom:

   ```text
   abs(scrollTop - (scrollHeight - clientHeight)) <= 2px
   ```

4. The bottom of the last transcript row plus the intentional bottom gutter must align with the bottom of the message viewport. No additional scrollable blank range greater than 2 px is allowed.
5. A transcript shorter than its viewport may naturally leave unused visual space, but that space must not be scrollable and must not produce a scrollbar thumb that stops before the track end.
6. Switching from a tall session to a short session must clear the old scroll extent within two animation frames.
7. Prepending older pages must preserve the user's reading anchor. Appending or growing content must follow the bottom only when the user has not intentionally scrolled away.

## 4. Scope and Ownership

### 4.1 Primary files

- `src/features/messages/MessageList.tsx`
- `src/features/messages/usePaginatedMessages.ts`
- `src/features/messages/pagination.ts`
- `src/features/messages/useVirtualList.ts`
- `src/features/messages/MessageList.test.tsx`
- `src/features/messages/useVirtualList.test.ts`
- `src/features/messages/pagination.test.ts`
- `tests/mock-server/routes.ts`
- a new focused Playwright journey, preferably `tests/e2e/e15-chat-history-scroll.spec.ts`

### 4.2 Conditional files

Change `src/shells/desktop/DesktopShell.tsx` only if browser measurements prove that the outer flex layout contributes an incorrect viewport height. Do not change it pre-emptively.

### 4.3 Out of scope

- message typography, colors, widths, or spacing;
- disclosure styling or animation;
- composer layout;
- sidebar or right-panel redesign;
- session title behavior;
- changing which legitimate user or assistant messages are visible;
- unrelated settings or workspace changes;
- changelog edits for this planning document.

## 5. Phase 0: Reproduce and Measure Before Fixing

Do not modify production behavior until both defects are reproducible in automated fixtures.

### 5.1 Add deterministic history fixtures

Extend the mock server with named sessions that model these cases:

| Fixture | Page layout | Expected visible result |
| --- | --- | --- |
| `visible-recent-delayed-history` | newest page has visible messages; two older pages are delayed | newest visible rows appear immediately; older rows arrive without unmounting them |
| `hidden-tail-visible-history` | newest full page contains only hidden control records; second page contains visible conversation | stable initial loader until the second page; then visible rows render immediately |
| `compacted-visible-tail` | newest page contains a compaction marker and visible messages; older pages are delayed | visible tail renders after page one; backfill continues in the background |
| `cursor-replay` | server repeats the same full page for `before` | paging stops once without an infinite loader |
| `tall-short-tall` | three sessions with very different row counts and row heights | every switch resets scroll extent and preserves the correct target session |
| `dynamic-heights` | markdown, tool output, and disclosure rows resize after mount | bottom remains reachable after every height change |

The mock route must support a controllable per-page delay so the test can inspect intermediate UI states rather than only the final result.

### 5.2 Add test-only diagnostics

Add one test helper that reports a snapshot of both pipelines. Keep it behind test/development code and do not emit production console noise.

Required history fields:

- active session generation/key;
- page request count and returned message IDs;
- cursor before and after each request;
- server-record count in the store;
- source-group count;
- derived visible-row count;
- loading phase;
- `hasMore` and last pagination stop reason.

Required geometry fields:

- `scrollTop`;
- `clientHeight`;
- browser `scrollHeight`;
- virtual content height;
- first and last rendered row IDs;
- last row `top`, `height`, and bottom coordinate;
- message viewport bottom;
- composer top;
- computed scrollable bottom gap.

Use a shared `getTranscriptMetrics()` helper in the browser test. Avoid assertions based only on screenshots; screenshots support diagnosis, while geometry assertions decide pass/fail.

### 5.3 Isolation experiment

Run the failing fixtures once with virtualization disabled through a test-only switch:

- if history remains absent, the history/filtering pipeline has an independent defect;
- if the ghost bottom disappears, the virtualizer is causal for the second defect;
- if the outer message viewport height is already wrong without virtualization, inspect the desktop flex chain before changing virtual-list math.

Record this result in the implementation report. Do not keep the switch as a user-facing setting.

## 6. Phase 1: Replace Blocking Restoration With Incremental Readiness

### 6.1 Introduce an explicit history state machine

Replace the coupled `loading`/`loadingEarlier` booleans with a state that can represent the real user-visible lifecycle:

```ts
type HistoryPhase =
  | "initial-loading"
  | "seeking-visible"
  | "ready"
  | "backfilling"
  | "exhausted"
  | "initial-error"
  | "backfill-error";
```

The exact representation may use signals rather than one union, but these states and transitions must remain observable in tests.

Required transitions:

```text
session selected
  -> cached visible rows? render them + refresh
  -> otherwise initial-loading

initial page resolved
  -> visible rows? ready -> optional background backfill
  -> zero visible rows + hasMore? seeking-visible -> fetch next page
  -> zero visible rows + exhausted? exhausted/empty

background page resolved
  -> keep current rows mounted
  -> more pages? continue or wait for top-reach according to policy
  -> exhausted? ready/exhausted
  -> failure? keep rows mounted + backfill-error
```

### 6.2 Separate “find something visible” from “restore all history”

Remove the rule that a compaction marker alone keeps the entire page behind the global loader.

Implement two operations:

1. `loadUntilVisible()`
   - used only when there are zero visible rows;
   - requests sequential pages until a visible row appears or paging terminates;
   - clears the global loader immediately after visible rows exist.
2. `backfillHistory()`
   - runs only after visible content is mounted;
   - loads older pages without replacing or hiding current rows;
   - may continue automatically for compacted history, but must yield between pages and remain cancellable;
   - uses the fixed-height top loading slot or no indicator when auto-backfilling off-screen, so layout does not blink.

Do not use `containsCompaction` as a readiness condition. It may choose a backfill policy, but it must not decide whether already visible content can render.

### 6.3 Make pagination termination explicit

Change the paging result from a bare inserted count to a structured result, for example:

```ts
type PageResult = {
  received: number;
  inserted: number;
  visibleBefore: number;
  visibleAfter: number;
  cursor: string | undefined;
  stopReason?: "exhausted" | "short-page" | "cursor-replay" | "duplicate-only";
};
```

The implementation must:

- keep a `seenCursors` set per session generation;
- stop if the next cursor is unchanged or previously seen;
- distinguish a duplicate-only page that advanced the cursor from a replay that did not;
- stop on empty or short pages;
- expose errors instead of converting every failed earlier request into inserted count `0`;
- clear `loadingEarlier` in a `finally` block only for the same active generation.

### 6.4 Preserve cached rows during refresh

On session open:

- do not clear existing store rows merely to refresh the newest page;
- derive and render cached visible rows immediately;
- show a non-blocking refresh/backfill state if a request is still running;
- replace the active view only when the session key changes, never because a page request changes phase.

Use one request generation key containing server ID, active directory, and session ID. Every asynchronous continuation must compare its captured key before applying store, loading, error, cursor, or scroll changes.

## 7. Phase 2: Make Scroll Extent Converge to One Source of Truth

### 7.1 Remove the “largest boundary wins” rule

Do not fix the bottom gap by changing `Math.max` to `Math.min`; either choice can be wrong while rows are still being measured.

Instead, make the virtual content spacer the authoritative transcript height. The scroll container's `scrollHeight` must be a consequence of that spacer plus intentional static padding, not a competing measurement retained from a previous session.

Required structure:

```text
message viewport (the only vertical scroller)
  -> virtual spacer (height = reconciled row total)
     -> absolutely positioned visible rows
```

No sibling inside the scroll container may add unaccounted vertical height. Loading, errors, and jump controls must either reserve an explicitly measured slot included in the height model or be overlays outside the spacer.

### 7.2 Add a session-generation reset to the virtualizer

Extend the virtual list API with a reset/invalidation operation that runs before a different session is displayed.

It must:

- disconnect all row observers;
- clear measurements that belong to the old generation;
- clear mounted-row bookkeeping and stale cached positions;
- set internal and DOM `scrollTop` to a valid value for the new generation;
- measure the new viewport;
- establish the new spacer height before calculating its initial visible range.

The row key should remain session-qualified, but qualified keys alone are not a substitute for lifecycle reset.

### 7.3 Reconcile dynamic row measurements in one frame batch

Row `ResizeObserver` callbacks should enqueue measurements and apply them once per animation frame. For every batch:

1. capture whether the user was bottom-locked and, if not, capture the top visible row plus its pixel offset;
2. apply all changed row heights;
3. update the spacer height;
4. restore the reading anchor for prepends or non-following readers;
5. pin to the new maximum only if the user was bottom-locked;
6. clamp to the final spacer-derived maximum;
7. publish the new visible range.

This prevents several independent effects from alternately changing `scrollTop`, virtual height, and mounted rows.

### 7.4 Unify bottom detection and scrolling

Create one helper for all of these consumers:

- near-bottom detection;
- automatic follow;
- “new messages” jump;
- session-open initial placement;
- final clamp after resize or measurement.

It must use the same reconciled maximum:

```ts
const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
```

Do not mix virtual total height in one path and DOM `scrollHeight` in another. The browser value may be asserted against the spacer after settlement, but it must not independently expand the model.

### 7.5 Preserve prepend anchors by row identity

Replace total-height-delta anchoring as the primary strategy with row anchoring:

- capture the first visible row ID and its offset from the viewport top;
- prepend the page;
- after the measurement batch, find the same row and restore the same offset;
- fall back to height delta only if that row no longer exists.

This remains correct when newly prepended rows have estimates that later change.

## 8. Phase 3: Tests That Must Fail Before the Fix and Pass After It

### 8.1 Unit and component tests

Update or replace the existing compacted-session test that requires all pages to finish before any transcript is shown. Its new assertion must be:

- page one contains visible rows;
- page two remains unresolved;
- global loading disappears after page one;
- page-one rows stay mounted while page two is pending;
- backfill completion prepends older rows without resetting the visible content.

Add tests for:

1. hidden-only page followed by a visible page;
2. hidden-only pages followed by exhaustion;
3. visible cached rows during refresh;
4. backfill failure that leaves current rows visible and retryable;
5. stale response after a session switch;
6. cursor replay and cursor cycle protection;
7. tall-to-short session reset with stale DOM height intentionally larger than virtual height;
8. late row growth at the bottom;
9. late row shrink at the bottom;
10. prepend with newly measured rows preserving row-and-offset anchor;
11. resize from right-panel movement and UI scale change;
12. short transcript producing zero scroll range.

### 8.2 Real-browser E2E journey

The new Playwright journey must use the real chat page, not an isolated visual fixture. It should:

1. open `visible-recent-delayed-history`;
2. hold the second history response;
3. assert that the first visible rows render and the global loader is absent;
4. release older pages and assert that the same row remains mounted;
5. open `hidden-tail-visible-history` and assert one stable loader until the first visible page;
6. switch tall -> short -> tall sessions;
7. expand and collapse rows with dynamic content;
8. resize the right panel across narrow and wide layouts;
9. test UI scale values used by the application, including 100% and 120%;
10. scroll to the bottom after each transition and collect transcript metrics.

Geometry assertions after two animation frames:

```text
abs(scrollTop - (scrollHeight - clientHeight)) <= 2
abs(browserScrollHeight - modeledContentHeight) <= 2
scrollableBottomGap <= 2
lastRowBottom <= viewportBottom
viewportBottom - lastRowBottom <= intentionalBottomGutter + 2
```

For a short transcript:

```text
scrollTop == 0
scrollHeight <= clientHeight + 2
```

Take screenshots and a Playwright trace on failure, but do not substitute visual comparison for geometry assertions.

### 8.3 Regression coverage

The following existing behavior must remain covered:

- streaming while pinned follows the bottom;
- streaming while the user reads older content does not move the viewport;
- the new-message jump reaches the real bottom;
- loading older pages does not show the new-message indicator;
- user-initiated scrolling interrupts automatic history restoration safely;
- no duplicate message IDs or rows appear;
- at most the existing bounded number of virtual rows is mounted for a 1,000-message session;
- no request loop occurs when the server ignores `before`.

## 9. Implementation and Commit Sequence

Keep the two fixes independently reviewable. Do not combine them into one large patch.

### Commit 1: Reproduction only

Suggested message:

```text
test(messages): reproduce hidden history and ghost scroll space
```

Contents:

- mock history fixtures and controllable delays;
- test-only metrics helper;
- failing component and E2E tests;
- no production behavior change.

Exit condition: both user-reported defects fail for the intended reason, with recorded history and geometry metrics.

### Commit 2: History readiness and paging

Suggested message:

```text
fix(messages): render compacted history incrementally
```

Contents:

- explicit history phases;
- `loadUntilVisible()` and non-blocking backfill;
- structured pagination outcomes and cursor-cycle protection;
- session-generation cancellation;
- updated history tests;
- matching English and Chinese changelog entries because this is a user-visible implementation change.

Exit condition: every history fixture passes while the scroll defect remains independently reproducible.

### Commit 3: Virtual scroll extent

Suggested message:

```text
fix(messages): reconcile transcript scroll extent
```

Contents:

- authoritative virtual spacer height;
- session-generation reset;
- batched row measurement reconciliation;
- unified bottom helper;
- row-identity prepend anchor;
- geometry and regression tests;
- matching English and Chinese changelog entries.

Exit condition: bottom geometry passes in real Chromium/WebKit-backed app layout across session switches, dynamic row heights, right-panel resizing, and supported UI scales.

### Commit 4: Test cleanup only if necessary

Suggested message:

```text
test(messages): harden history and scroll regressions
```

Use this only for test harness cleanup after both fixes. Do not hide functional changes in it.

## 10. Verification Gate

Run these checks after each relevant phase:

```bash
pnpm exec vitest run src/features/messages/MessageList.test.tsx src/features/messages/useVirtualList.test.ts src/features/messages/pagination.test.ts
pnpm test:e2e -- tests/e2e/e15-chat-history-scroll.spec.ts
```

Before every implementation commit, run:

```bash
pnpm verify
pnpm test:e2e
```

The implementation report must include command results, the fixture used, page counts, visible-row counts, and final geometry metrics. A screenshot saying “looks correct” is insufficient.

## 11. Stop Conditions and Fallback

Stop and report instead of expanding scope when:

- the server's real message endpoint does not honor the documented `before` behavior;
- a compacted session's older visible messages are absent from the API response rather than hidden by the client;
- the outer desktop layout is proven to produce an incorrect viewport and fixing it would require changes outside the chat/message ownership boundary;
- a request can only be reproduced with private session data that cannot be converted into a safe fixture.

If the custom virtualizer still fails the geometry invariants after one focused repair attempt, do not add more corrective effects or repeated `requestAnimationFrame` calls. Use this fallback decision:

1. verify the same fixtures with normal document flow to prove correctness;
2. evaluate replacement with a mature MIT-licensed Solid-compatible virtualizer;
3. adopt it only if it passes the same anchor, bottom, resize, and 1,000-message performance tests;
4. otherwise ship the correctness-first non-virtualized path with an explicit performance limit and a follow-up task.

No paid service, certificate, or proprietary dependency is required for either path.

## 12. Definition of Done

The task is done only when all of the following are true:

- every session with recoverable visible history shows content without requiring the user to scroll or send a new message;
- a compacted session exposes the first available visible page before full backfill finishes;
- hidden control-only pages cannot cause a false empty state;
- background paging never unmounts already visible conversation rows;
- no large scrollable blank region exists below the last message;
- the scrollbar reaches its true end at the same time as the transcript reaches its final row;
- session switching, row expansion/collapse, streaming, right-panel resizing, and UI scaling preserve the scroll invariants;
- focused unit/component tests, the dedicated E2E journey, `pnpm verify`, and the full E2E suite pass;
- the final report includes objective metrics and notes any deviation from this plan.
