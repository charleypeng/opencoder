// Prompt input box (TASK-M2-08): the chat composer pinned below the message
// list. An auto-growing textarea sends on ⌘/Ctrl+Enter (plain Enter inserts
// a newline); ↑ on an empty input recalls the last sent prompt and keeps
// cycling through the per-server history. Sending goes through the shared
// sendPrompt pipeline (optimistic user message, rollback + inline banner on
// failure); while the session is generating (busy/retry status from the
// store) the input is locked with a "Generating…" placeholder and the Send
// button is replaced by a Stop button — Esc does the same — which calls
// POST /session/{id}/abort (TASK-M2-10; a local aborting lock prevents
// double clicks; an abort failure surfaces as the inline banner). The thin
// streaming progress bar lives at the top of the chat area in MessageList
// (TASK-M2-09, single source: session busy status).
//
// TASK-M3-08 (attachments & @ file references): clipboard images and
// dropped/picked files become removable attachment chips above the
// textarea (images and large/binary files as base64 data URLs, small
// text-like files as plain text) and are sent as FilePartInput parts
// (cleared on success, kept for retry on failure). `@` at a word start
// opens a debounced (150ms, in-flight responses invalidated) file
// reference menu over GET /find/file with ↑↓/Enter/Esc navigation that
// inserts `@<path>` at the caret. Drops use the plain HTML5 handlers —
// File objects from a WebView drop carry no absolute path; when Tauri
// v2's onDragDropEvent is wired the path could be attached there. The
// image picker button is a disabled M7 placeholder (mobile dialog plugin).
//
// TASK-M5-03 (slash commands): a leading `/` opens a filtered command menu
// over GET /command (name/description/argument hints; the command list is
// fetched once per mount on first trigger, in-flight guarded). ↑↓/Enter/
// Esc navigate like the @ menu; selection fills the input with the
// command template (name plus the first argument hint as editable text).
// Submitting a message that matches a known command runs
// POST /session/{id}/command (arguments = text after the name) instead of
// the prompt path, and the reply renders through the normal SSE flow; an
// unmatched `/…` message stays a plain prompt. The two input-triggered
// menus are mutually exclusive: the @ condition wins while it holds.
//
// TASK-M5-04 (agent selector): a toolbar row above the textarea holds the
// agent chip — the effective agent name with its color dot (color field,
// fallback gray). The agent catalog is fetched once per mount via GET
// /agent (reused across mounts through the store's loaded flag; a failed
// fetch leaves the flag off so a later mount retries). Clicking the chip
// opens a menu of the visible (non-hidden) agents — name, mode and
// description, with a check on the current one; selecting records the
// choice per session in the agents store, so each session remembers its
// agent. Tab in the textarea cycles the visible agents while no input
// menu owns the keys (with a menu open it keeps its default focus
// behavior). The send pipeline carries the effective agent in the
// prompt_async body.
//
// TASK-M5-05 (model selector): the toolbar row gains a model chip next to
// the agent chip — the effective model name (id fallback) with its
// provider name. The provider catalog is fetched once per mount via GET
// /provider + GET /config/providers (store loaded flag, same pattern as
// the agents). Clicking the chip opens the ModelPicker dialog; selecting
// a model records the choice per session in the models store, so each
// session remembers its model, and the send pipeline carries the
// effective model ({ providerID, modelID }) in the prompt_async body.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import ErrorBanner from "../../components/ErrorBanner.js";
import { createAgentService } from "../../services/agent.js";
import { createProviderService } from "../../services/provider.js";
import { getApiClient } from "../../services/client.js";
import { ApiError } from "../../services/errors.js";
import { createCommandService, type Command } from "../../services/command.js";
import { createFindService } from "../../services/find.js";
import { createSessionService } from "../../services/session.js";
import { untrackPendingLocalMessage } from "../../stores/messages.js";
import { getServerSessionState } from "../../stores/session.js";
import { agentColor, cycleAgentName, visibleAgents } from "../models/agents.js";
import {
  agentNameFor,
  getServerAgentState,
  setAgentForSession,
  setAgents,
} from "../../stores/agents.js";
import {
  activeModelFor,
  getServerModelState,
  setConfigDefault,
  setProviders,
} from "../../stores/models.js";
import { modelName } from "../models/models.js";
import ModelPicker from "../models/ModelPicker.js";
import { type Attachment, fileToAttachment } from "./attachments.js";
import { commandTemplate, matchCommand, type CommandMatch } from "../commands/commands.js";
import { promptAt } from "./promptHistory.js";
import { sendPrompt } from "./sendPrompt.js";

export interface PromptBoxProps {
  /** The server whose session is composed in. */
  serverId: string;
  /** The active session the prompt is sent to. */
  sessionId: string;
  /** Hard-disabled (no session context); store status still locks below. */
  disabled?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 220; // ~10 lines, then the box scrolls internally
const AT_DEBOUNCE_MS = 150;

/** Open @-reference menu state (TASK-M3-08). */
interface AtMenuState {
  /** The word after the triggering `@`. */
  query: string;
  items: string[];
  selected: number;
}

/** Open `/` command menu state (TASK-M5-03). */
interface SlashMenuState {
  /** The text after the triggering `/`. */
  query: string;
  items: Command[];
  selected: number;
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-4 w-4"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3 w-3"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3 w-3"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3 w-3"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-3.5 w-3.5 shrink-0 text-accent"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Grows the textarea to its content, capped at the max box height. */
function resizeToContent(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

/** `@` at a word start (beginning of input or after whitespace). */
function atQueryAt(el: HTMLTextAreaElement): { atIndex: number; query: string } | null {
  const before = el.value.slice(0, el.selectionStart);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  const prefix = before.slice(0, atIndex);
  if (prefix !== "" && !/\s$/.test(prefix)) return null;
  const query = before.slice(atIndex + 1);
  if (query.includes(" ")) return null;
  return { atIndex, query };
}

const PromptBox: Component<PromptBoxProps> = (props) => {
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [sending, setSending] = createSignal(false);
  const [inlineError, setInlineError] = createSignal<ApiError | null>(null);
  // Rejected-drop message (e.g. an oversized file) shown next to the chips.
  const [attachError, setAttachError] = createSignal<string | null>(null);
  // Local lock while an abort request is in flight (no double stops).
  const [aborting, setAborting] = createSignal(false);
  // -1 = not browsing; >= 0 = index into the history list (0 is most recent).
  const [browseIndex, setBrowseIndex] = createSignal(-1);
  const [atMenu, setAtMenu] = createSignal<AtMenuState | null>(null);
  const [slashMenu, setSlashMenu] = createSignal<SlashMenuState | null>(null);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let atListRef: HTMLDivElement | undefined;
  let slashListRef: HTMLDivElement | undefined;
  // Debounce timer + request sequence for the @-reference search: the
  // sequence invalidates in-flight responses so a stale reply never lands.
  let atTimer: ReturnType<typeof setTimeout> | undefined;
  let atFetchSeq = 0;
  // Suppresses one refresh after a path insert so the inserted `@path`
  // does not immediately reopen the menu.
  let suppressAtRefresh = false;
  // Command list cache (TASK-M5-03): fetched once per mount on the first
  // `/` trigger; the in-flight promise collapses concurrent opens.
  let commandCache: Command[] | null = null;
  let commandFetch: Promise<Command[]> | null = null;
  // Suppresses one refresh after a command insert so the filled template
  // (e.g. `/init`) does not immediately reopen the menu.
  let suppressSlashRefresh = false;
  // Agent chip (TASK-M5-04): the catalog fetch is in-flight guarded and
  // reused across mounts via the store's loaded flag.
  const [agentMenuOpen, setAgentMenuOpen] = createSignal(false);
  let agentFetch: Promise<void> | null = null;
  // Model chip (TASK-M5-05): the ModelPicker dialog's open state plus the
  // provider catalog fetch (store loaded flag, same pattern as agents).
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false);
  let modelFetch: Promise<void> | null = null;

  // Store-driven generating lock: busy/retry means the session is streaming.
  const status = createMemo(() => getServerSessionState(props.serverId).statuses[props.sessionId]);
  const busy = createMemo(() => status()?.type === "busy" || status()?.type === "retry");
  const disabled = () => props.disabled === true || busy() || sending();
  const canSend = () => !disabled() && (text().trim() !== "" || attachments().length > 0);

  // Agent catalog (TASK-M5-04): fetched once per mount unless the store
  // already holds the server's agents; a failed fetch keeps loaded=false so
  // a later mount retries. The effective agent resolves per session
  // (recorded selection -> session agent when visible -> first visible).
  createEffect(() => {
    const serverId = props.serverId;
    if (getServerAgentState(serverId).loaded || agentFetch !== null) return;
    agentFetch = createAgentService(getApiClient())
      .list()
      .then((agents) => setAgents(serverId, agents))
      .catch(() => {
        // Catalog failures degrade to the fallback agent; retried on mount.
      })
      .finally(() => {
        agentFetch = null;
      });
  });

  const sessionAgent = createMemo(
    () => getServerSessionState(props.serverId).sessions[props.sessionId]?.agent,
  );
  const agentName = createMemo(() => agentNameFor(props.serverId, props.sessionId, sessionAgent()));
  const currentAgent = createMemo(() => {
    const name = agentName();
    if (name === null) return undefined;
    return getServerAgentState(props.serverId).agents.find((agent) => agent.name === name);
  });
  const menuAgents = createMemo(() => visibleAgents(getServerAgentState(props.serverId).agents));

  // Provider catalog (TASK-M5-05): fetched once per mount unless the store
  // already holds the server's providers; a failed fetch keeps loaded=false
  // so a later mount retries. The effective model resolves per session
  // (recorded selection -> session model -> config default -> first
  // connected) and the picker reads the same store.
  createEffect(() => {
    const serverId = props.serverId;
    if (getServerModelState(serverId).loaded || modelFetch !== null) return;
    modelFetch = Promise.all([
      createProviderService(getApiClient()).list(),
      createProviderService(getApiClient()).configProviders(),
    ])
      .then(([list, config]) => {
        setProviders(serverId, list);
        setConfigDefault(serverId, config.default);
      })
      .catch(() => {
        // Catalog failures degrade to the session model; retried on mount.
      })
      .finally(() => {
        modelFetch = null;
      });
  });

  const sessionModel = createMemo(
    () => getServerSessionState(props.serverId).sessions[props.sessionId]?.model,
  );
  const modelRef = createMemo(() =>
    activeModelFor(props.serverId, props.sessionId, sessionModel()),
  );
  const currentModel = createMemo(() => {
    const ref = modelRef();
    if (ref === null) return undefined;
    return getServerModelState(props.serverId).providers.find(
      (provider) => provider.id === ref.providerID,
    )?.models[ref.modelID];
  });
  const currentProvider = createMemo(() => {
    const ref = modelRef();
    if (ref === null) return undefined;
    return getServerModelState(props.serverId).providers.find(
      (provider) => provider.id === ref.providerID,
    );
  });
  const modelChipName = createMemo(() => {
    const model = currentModel();
    if (model !== undefined) return modelName(model);
    return modelRef()?.modelID ?? "model";
  });

  // TASK-M2-08: a prompt the server never echoes keeps its optimistic bubble;
  // the pending marker is dropped when the composed session changes or the
  // box unmounts so another session's events never reconcile against it.
  createEffect(() => {
    const sessionId = props.sessionId;
    onCleanup(() => untrackPendingLocalMessage(props.serverId, sessionId));
  });

  onCleanup(() => {
    if (atTimer !== undefined) clearTimeout(atTimer);
  });

  // Esc aborts generation from anywhere while the session is generating
  // (the textarea is disabled then and cannot receive the key itself); a
  // focused widget that handled the key (e.g. a dialog) wins via the
  // defaultPrevented check.
  createEffect(() => {
    if (!busy()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      void stopGeneration();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  function applyHeight(el: HTMLTextAreaElement): void {
    // Browsing fills the value programmatically; resize so the textarea
    // never shows a scrollbar right after a recall.
    queueMicrotask(() => resizeToContent(el));
  }

  function exitBrowse(): void {
    setBrowseIndex(-1);
  }

  function recall(): void {
    const next = promptAt(props.serverId, browseIndex());
    if (next === undefined) return;
    setText(next);
    const el = textareaRef;
    if (el !== undefined) {
      el.value = next;
      el.selectionStart = el.selectionEnd = next.length;
      applyHeight(el);
    }
  }

  function browseOlder(): void {
    const nextIndex = browseIndex() + 1;
    // The oldest entry reached: stay put instead of wrapping around.
    if (promptAt(props.serverId, nextIndex) === undefined) return;
    setBrowseIndex(nextIndex);
    recall();
  }

  function browseNewer(): void {
    if (browseIndex() < 0) return;
    const nextIndex = browseIndex() - 1;
    setBrowseIndex(nextIndex);
    if (nextIndex < 0) {
      // Past the newest entry: back to an empty input.
      setText("");
      const el = textareaRef;
      if (el !== undefined) {
        el.value = "";
        applyHeight(el);
      }
    } else {
      recall();
    }
  }

  function closeAtMenu(): void {
    if (atTimer !== undefined) {
      clearTimeout(atTimer);
      atTimer = undefined;
    }
    atFetchSeq += 1;
    setAtMenu(null);
  }

  // Keeps the keyboard-selected option visible inside the scrollable list.
  createEffect(() => {
    if (atMenu() === null && slashMenu() === null) return;
    const selected =
      atListRef?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      slashListRef?.querySelector<HTMLElement>('[aria-selected="true"]');
    // Optional call: jsdom lacks scrollIntoView; the WebView supports it.
    selected?.scrollIntoView?.({ block: "nearest" });
  });

  async function fetchAtResults(query: string): Promise<void> {
    const seq = ++atFetchSeq;
    try {
      const items = await createFindService(getApiClient()).files(query);
      if (seq !== atFetchSeq) return; // stale response; a newer query owns the menu
      setAtMenu((prev) => (prev?.query === query ? { query, items, selected: 0 } : prev));
    } catch {
      // Search failures close the menu silently; typing is unaffected.
      if (seq === atFetchSeq) setAtMenu(null);
    }
  }

  function refreshAtMenu(el: HTMLTextAreaElement): void {
    if (suppressAtRefresh) {
      suppressAtRefresh = false;
      return;
    }
    if (atTimer !== undefined) {
      clearTimeout(atTimer);
      atTimer = undefined;
    }
    const hit = atQueryAt(el);
    if (hit === null || hit.query === "") {
      closeAtMenu();
      return;
    }
    setAtMenu((prev) =>
      prev === null || prev.query !== hit.query
        ? { query: hit.query, items: [], selected: 0 }
        : prev,
    );
    atTimer = setTimeout(() => {
      atTimer = undefined;
      void fetchAtResults(hit.query);
    }, AT_DEBOUNCE_MS);
  }

  function insertAtReference(path: string): void {
    const el = textareaRef;
    if (el !== undefined) {
      const caret = el.selectionStart;
      const hit = atQueryAt(el);
      if (hit !== null) {
        // Caret still on the `@query` word: replace the query up to the
        // caret and keep the rest of the text.
        const next = `${el.value.slice(0, hit.atIndex)}@${path}${el.value.slice(caret)}`;
        el.value = next;
        setText(next);
        el.selectionStart = el.selectionEnd = next.length;
        applyHeight(el);
      } else {
        // The caret moved off the query while the menu stayed open: insert
        // at the caret instead of splicing at a stale position (which could
        // duplicate the text before the old `@`).
        const next = `${el.value.slice(0, caret)}@${path}${el.value.slice(caret)}`;
        el.value = next;
        setText(next);
        el.selectionStart = el.selectionEnd = next.length;
        applyHeight(el);
      }
    }
    suppressAtRefresh = true;
    closeAtMenu();
  }

  function closeSlashMenu(): void {
    setSlashMenu(null);
  }

  // Fetches the command list once per mount on the first `/` trigger and
  // caches it; a failed fetch resets the in-flight guard so the next
  // trigger retries.
  function loadCommands(): Promise<Command[]> {
    if (commandCache !== null) return Promise.resolve(commandCache);
    if (commandFetch === null) {
      commandFetch = createCommandService(getApiClient())
        .list()
        .then((commands) => {
          commandCache = commands;
          return commands;
        })
        .catch((err: unknown) => {
          commandFetch = null;
          throw err;
        });
    }
    return commandFetch;
  }

  function filterCommands(commands: readonly Command[], query: string): Command[] {
    const needle = query.toLowerCase();
    return commands.filter((command) => command.name.toLowerCase().includes(needle));
  }

  async function refreshSlashResults(query: string): Promise<void> {
    try {
      const commands = await loadCommands();
      setSlashMenu((prev) =>
        prev === null || prev.query !== query
          ? prev
          : { ...prev, items: filterCommands(commands, query) },
      );
    } catch {
      // Command list failures close the menu silently; typing is unaffected.
      setSlashMenu(null);
    }
  }

  function refreshSlashMenu(el: HTMLTextAreaElement): void {
    if (suppressSlashRefresh) {
      suppressSlashRefresh = false;
      return;
    }
    // The @-reference menu owns the input while open; a `/`-prefixed line
    // can only win once the @ condition is gone (TASK-M5-03 coordination).
    if (atMenu() !== null) {
      closeSlashMenu();
      return;
    }
    const before = el.value.slice(0, el.selectionStart);
    if (!before.startsWith("/")) {
      closeSlashMenu();
      return;
    }
    const query = before.slice(1);
    if (query.includes(" ")) {
      closeSlashMenu();
      return;
    }
    const prev = slashMenu();
    if (prev === null || prev.query !== query) {
      setSlashMenu({ query, items: [], selected: 0 });
    }
    void refreshSlashResults(query);
  }

  function insertSlashCommand(command: Command): void {
    const el = textareaRef;
    const template = commandTemplate(command);
    if (el !== undefined) {
      el.value = template;
      setText(template);
      el.selectionStart = el.selectionEnd = template.length;
      applyHeight(el);
    }
    suppressSlashRefresh = true;
    closeSlashMenu();
  }

  async function addFileAttachment(file: File): Promise<void> {
    try {
      const attachment = await fileToAttachment(file);
      setAttachError(null);
      setAttachments((prev) => [...prev, attachment]);
    } catch (err) {
      // Oversized or unreadable file: surface the failure next to the chips.
      setAttachError(err instanceof Error ? err.message : "File too large");
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }

  function onKeyDown(event: KeyboardEvent) {
    // The `/` command menu owns arrow/enter/escape keys while open; the @
    // menu below can never be open at the same time (refreshSlashMenu
    // defers to it), so the two checks are exclusive in practice.
    const slash = slashMenu();
    if (slash !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const count = slash.items.length;
        const selected = count === 0 ? 0 : (slash.selected + delta + count) % count;
        setSlashMenu({ ...slash, selected });
        return;
      }
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && slash.items.length > 0) {
        event.preventDefault();
        insertSlashCommand(slash.items[slash.selected]);
        return;
      }
    }
    // The @-reference menu owns arrow/enter/escape keys while open.
    const menu = atMenu();
    if (menu !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAtMenu();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const count = menu.items.length;
        const selected = count === 0 ? 0 : (menu.selected + delta + count) % count;
        setAtMenu({ ...menu, selected });
        return;
      }
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && menu.items.length > 0) {
        event.preventDefault();
        insertAtReference(menu.items[menu.selected]);
        return;
      }
    }
    // Tab cycles the agent (TASK-M5-04) while no input menu owns the keys;
    // with a menu open Tab keeps its default focus behavior.
    if (event.key === "Tab") {
      const next = cycleAgentName(getServerAgentState(props.serverId).agents, agentName());
      if (next !== null) {
        event.preventDefault();
        setAgentForSession(props.serverId, props.sessionId, next);
        return;
      }
    }
    // Esc exits prompt history browsing (the browser default, e.g. closing
    // overlays, is kept when not browsing).
    if (event.key === "Escape") {
      if (browseIndex() >= 0) {
        event.preventDefault();
        setBrowseIndex(-1);
      }
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === "ArrowUp" && !event.shiftKey) {
      const el = event.currentTarget as HTMLTextAreaElement;
      if (browseIndex() >= 0 || el.selectionStart === 0) {
        event.preventDefault();
        browseOlder();
      }
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      if (browseIndex() >= 0) {
        event.preventDefault();
        browseNewer();
      }
    }
  }

  function onInput(event: Event) {
    const el = event.currentTarget as HTMLTextAreaElement;
    setText(el.value);
    if (browseIndex() >= 0) exitBrowse();
    resizeToContent(el);
    refreshAtMenu(el);
    refreshSlashMenu(el);
  }

  function onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (items === undefined) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file === null) continue;
      event.preventDefault();
      void addFileAttachment(file);
      return;
    }
  }

  function onDrop(event: DragEvent) {
    if (disabled()) return;
    const files = event.dataTransfer?.files;
    if (files === undefined || files.length === 0) return;
    event.preventDefault();
    for (const file of Array.from(files)) void addFileAttachment(file);
  }

  function onFileInputChange(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    for (const file of Array.from(el.files ?? [])) void addFileAttachment(file);
    // Reset so picking the same file again re-fires the change event.
    el.value = "";
  }

  /**
   * Runs a known command through POST /session/{id}/command (TASK-M5-03);
   * the reply streams in over SSE like a prompt. On failure the input is
   * restored to the submitted text so the user can retry (the plain prompt
   * path rolls back its optimistic message instead).
   */
  async function runCommand(match: CommandMatch, rawMessage: string): Promise<ApiError | null> {
    try {
      await createCommandService(getApiClient()).run(props.sessionId, {
        command: match.command.name,
        arguments: match.args,
      });
      return null;
    } catch (err) {
      const el = textareaRef;
      if (el !== undefined) {
        el.value = rawMessage;
        setText(rawMessage);
        el.selectionStart = el.selectionEnd = rawMessage.length;
        applyHeight(el);
      }
      return ApiError.fromUnknown(err);
    }
  }

  async function send() {
    const message = text().trim();
    const atts = attachments();
    if ((message === "" && atts.length === 0) || disabled()) return;
    closeAtMenu();
    closeSlashMenu();
    // Clear the input immediately; the pipeline handles the store side.
    setText("");
    const el = textareaRef;
    if (el !== undefined) {
      el.value = "";
      applyHeight(el);
    }
    exitBrowse();
    setSending(true);
    setInlineError(null);
    setAttachError(null);
    try {
      let err: ApiError | null;
      if (message.startsWith("/")) {
        // Commands load lazily on the first `/` keystroke; a paste-and-send
        // can beat that fetch, so wait for it before classifying the input.
        // A message that matches a known command runs it; anything else
        // starting with `/` falls back to the plain prompt path.
        const commands = await loadCommands().catch(() => []);
        const match = matchCommand(message, commands);
        err =
          match === null
            ? await sendPrompt(
                props.serverId,
                props.sessionId,
                message,
                atts,
                agentName() ?? undefined,
                modelRef() ?? undefined,
              )
            : await runCommand(match, message);
      } else {
        err = await sendPrompt(
          props.serverId,
          props.sessionId,
          message,
          atts,
          agentName() ?? undefined,
          modelRef() ?? undefined,
        );
      }
      // Chips clear on success only; a failed send keeps them for retry.
      if (err === null) setAttachments([]);
      setInlineError(err);
    } finally {
      setSending(false);
    }
  }

  async function stopGeneration() {
    if (aborting() || !busy()) return;
    setAborting(true);
    setInlineError(null);
    try {
      // The server answers with session.status idle via SSE, which flips
      // the busy lock and restores the Send button.
      await createSessionService(getApiClient()).abort(props.sessionId);
    } catch (err) {
      setInlineError(ApiError.fromUnknown(err));
    } finally {
      setAborting(false);
    }
  }

  // Memoized snapshots: component bodies run once, and reading a plain
  // signal twice inside a JSX conditional can tear when it flips between
  // the reads — memos cache their value, so both issues are avoided.
  const menu = createMemo(() => atMenu());
  const slash = createMemo(() => slashMenu());
  const atts = createMemo(() => attachments());

  return (
    <div
      data-testid="prompt-box"
      class="shrink-0 border-t border-bg-sunken bg-bg-elevated"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div class="flex items-end gap-2 px-4 py-3">
        <div class="min-w-0 flex-1">
          <ErrorBanner error={inlineError()} onDismiss={() => setInlineError(null)} />
          <div class="relative flex flex-col gap-1.5 rounded-lg border border-bg-sunken bg-bg-sunken px-2 py-1.5 focus-within:border-fg-faint">
            {/* Agent selector (TASK-M5-04): the toolbar row above the input
              holds the agent chip; the menu lists the visible agents and
              records the per-session choice in the store. The model chip
              (TASK-M5-05) sits next to it and opens the ModelPicker. */}
            <div class="flex flex-wrap items-center gap-1.5" data-testid="prompt-toolbar">
              <div class="relative">
                <button
                  type="button"
                  data-testid="agent-chip"
                  aria-label={`Agent: ${agentName() ?? "none"}`}
                  aria-haspopup="listbox"
                  aria-expanded={agentMenuOpen() ? "true" : "false"}
                  disabled={disabled()}
                  onClick={() => setAgentMenuOpen((open) => !open)}
                  onBlur={() => setAgentMenuOpen(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setAgentMenuOpen(false);
                    }
                  }}
                  class="flex items-center gap-1.5 rounded-full border border-bg-sunken bg-bg-base py-0.5 pl-2 pr-1.5 text-xs text-fg-default transition-colors hover:border-fg-faint hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span
                    data-testid="agent-chip-dot"
                    aria-hidden="true"
                    class="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: agentColor(currentAgent()) }}
                  />
                  <span data-testid="agent-chip-name" class="max-w-28 truncate font-mono">
                    {agentName() ?? "agent"}
                  </span>
                  <ChevronDownIcon />
                </button>
                <Show when={agentMenuOpen()}>
                  <div
                    data-testid="agent-menu"
                    role="listbox"
                    aria-label="Agents"
                    class="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-bg-sunken bg-bg-elevated py-1 shadow-lg"
                  >
                    <Show
                      when={menuAgents().length > 0}
                      fallback={<div class="px-3 py-1.5 text-xs text-fg-faint">No agents</div>}
                    >
                      <For each={menuAgents()}>
                        {(agent) => (
                          <button
                            type="button"
                            data-testid="agent-menu-item"
                            role="option"
                            aria-selected={agent.name === agentName()}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setAgentForSession(props.serverId, props.sessionId, agent.name);
                              setAgentMenuOpen(false);
                            }}
                            class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                              agent.name === agentName() ? "bg-bg-sunken" : ""
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              class="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: agentColor(agent) }}
                            />
                            <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                              <span class="flex w-full items-baseline gap-2">
                                <span class="shrink-0 font-mono text-fg-default">{agent.name}</span>
                                <span class="shrink-0 text-fg-faint">{agent.mode}</span>
                              </span>
                              <Show when={agent.description !== undefined}>
                                <span class="w-full truncate text-fg-faint">
                                  {agent.description}
                                </span>
                              </Show>
                            </span>
                            <Show when={agent.name === agentName()}>
                              <CheckIcon />
                            </Show>
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
              <button
                type="button"
                data-testid="model-chip"
                aria-label={`Model: ${modelChipName()}`}
                disabled={disabled()}
                onClick={() => setModelPickerOpen(true)}
                class="flex items-center gap-1.5 rounded-full border border-bg-sunken bg-bg-base py-0.5 pl-2 pr-1.5 text-xs text-fg-default transition-colors hover:border-fg-faint hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span data-testid="model-chip-name" class="max-w-28 truncate font-mono">
                  {modelChipName()}
                </span>
                <Show when={currentProvider() !== undefined}>
                  <span data-testid="model-chip-provider" class="max-w-20 truncate text-fg-faint">
                    {currentProvider()!.name}
                  </span>
                </Show>
                <ChevronDownIcon />
              </button>
            </div>
            <Show when={menu()} fallback={null}>
              {(m) => (
                <div
                  data-testid="prompt-at-menu"
                  role="listbox"
                  aria-label="File references"
                  ref={atListRef}
                  class="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-bg-sunken bg-bg-elevated py-1 shadow-lg"
                >
                  <Show
                    when={m().items.length > 0}
                    fallback={<div class="px-3 py-1.5 text-xs text-fg-faint">No matches</div>}
                  >
                    <For each={m().items}>
                      {(path, index) => (
                        <button
                          type="button"
                          data-testid="prompt-at-item"
                          role="option"
                          aria-selected={index() === m().selected}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertAtReference(path)}
                          class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                            index() === m().selected ? "bg-bg-sunken" : ""
                          }`}
                        >
                          <span class="truncate font-mono text-fg-default">{path}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={slash()} fallback={null}>
              {(m) => (
                <div
                  data-testid="prompt-slash-menu"
                  role="listbox"
                  aria-label="Commands"
                  ref={slashListRef}
                  class="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-bg-sunken bg-bg-elevated py-1 shadow-lg"
                >
                  <Show
                    when={m().items.length > 0}
                    fallback={<div class="px-3 py-1.5 text-xs text-fg-faint">No matches</div>}
                  >
                    <For each={m().items}>
                      {(command, index) => (
                        <button
                          type="button"
                          data-testid="prompt-slash-item"
                          role="option"
                          aria-selected={index() === m().selected}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertSlashCommand(command)}
                          class={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-xs ${
                            index() === m().selected ? "bg-bg-sunken" : ""
                          }`}
                        >
                          <span class="flex w-full items-baseline gap-2">
                            <span class="shrink-0 font-mono text-fg-default">{command.name}</span>
                            <Show when={command.description !== undefined}>
                              <span class="truncate text-fg-faint">{command.description}</span>
                            </Show>
                          </span>
                          <Show when={command.hints.length > 0}>
                            <span class="truncate font-mono text-fg-faint">
                              {command.hints.join(" ")}
                            </span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={atts().length > 0 || attachError() !== null}>
              <div class="flex flex-wrap gap-1.5 pb-1.5" data-testid="attachment-chips">
                <For each={atts()}>
                  {(attachment) => (
                    <span
                      data-testid="attachment-chip"
                      class="flex items-center gap-1.5 rounded-full border border-bg-sunken bg-bg-base py-0.5 pl-2 pr-1 text-xs text-fg-default"
                    >
                      {attachment.category === "image" ? <ImageIcon /> : <FileIcon />}
                      <span class="max-w-40 truncate" title={attachment.name}>
                        {attachment.name}
                      </span>
                      <button
                        type="button"
                        data-testid="attachment-remove"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => removeAttachment(attachment.id)}
                        class="flex h-4 w-4 items-center justify-center rounded-full text-fg-faint hover:text-danger"
                      >
                        <XIcon />
                      </button>
                    </span>
                  )}
                </For>
                <Show when={attachError() !== null}>
                  <span data-testid="attachment-error" role="alert" class="text-xs text-danger">
                    {attachError()}
                  </span>
                </Show>
              </div>
            </Show>
            <div class="flex items-end gap-1">
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="prompt-attach"
                  aria-label="Attachments"
                  title="Add files"
                  disabled={disabled()}
                  onClick={() => fileInputRef?.click()}
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-bg-base hover:text-fg-default disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PaperclipIcon />
                </button>
                <button
                  type="button"
                  data-testid="prompt-pick-image"
                  aria-label="Pick image"
                  // M7 wires the mobile system image picker (dialog plugin)
                  // plus platform detection; until then the picker is inert.
                  title="Image picker — M7"
                  disabled
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint"
                >
                  <ImageIcon />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  data-testid="prompt-file-input"
                  aria-hidden="true"
                  tabIndex={-1}
                  class="hidden"
                  onChange={onFileInputChange}
                />
              </div>
              <textarea
                ref={textareaRef}
                data-testid="prompt-input"
                rows={1}
                value={text()}
                placeholder={busy() ? "Generating…" : "Message"}
                disabled={disabled()}
                aria-label="Message"
                onInput={onInput}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => {
                  closeAtMenu();
                  closeSlashMenu();
                }}
                class="max-h-[220px] min-h-[2rem] flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-fg-faint disabled:cursor-not-allowed"
              />
              {busy() ? (
                <button
                  type="button"
                  data-testid="prompt-stop"
                  aria-label="Stop generating"
                  title="Stop (Esc)"
                  disabled={aborting()}
                  onClick={() => void stopGeneration()}
                  class="mb-0.5 flex shrink-0 items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-bg-base outline-none transition-opacity hover:opacity-90 focus:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SquareIcon />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="prompt-send"
                  disabled={!canSend()}
                  onClick={() => void send()}
                  class="mb-0.5 shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg-base outline-none transition-opacity hover:opacity-90 focus:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
          </div>
          <p class="mt-1 px-1 text-xs text-fg-faint">
            {busy() ? "Generating — Esc to stop" : "⌘/Ctrl+Enter to send"}
          </p>
        </div>
      </div>
      <ModelPicker
        serverId={props.serverId}
        sessionId={props.sessionId}
        open={modelPickerOpen()}
        onOpenChange={(open) => setModelPickerOpen(open)}
      />
    </div>
  );
};

export default PromptBox;
