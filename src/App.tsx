import { createSignal, Show } from "solid-js";
import ServerHome from "./features/servers/ServerHome";
import type { ServerEntry } from "./services/servers";

// App shell (TASK-M1-06): the server navigation home is the landing page;
// opening a card shows a placeholder for the workspace shell (TASK-M1-08).

function App() {
  const [selected, setSelected] = createSignal<ServerEntry | null>(null);

  return (
    <Show when={selected()} fallback={<ServerHome onSelect={setSelected} />}>
      <ServerPlaceholder server={selected() as ServerEntry} onBack={() => setSelected(null)} />
    </Show>
  );
}

function ServerPlaceholder(props: { server: ServerEntry; onBack: () => void }) {
  return (
    <div class="min-h-screen bg-bg-base text-fg-primary">
      <header class="glass sticky top-0 z-10 flex items-center justify-between px-6 py-4">
        <div>
          <h1 class="text-lg font-semibold">{props.server.name}</h1>
          <p class="text-sm text-fg-secondary">{props.server.url}</p>
        </div>
        <button
          type="button"
          class="rounded-md border border-bg-sunken bg-bg-sunken px-4 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          onClick={() => props.onBack()}
        >
          Back to servers
        </button>
      </header>
      <main class="mx-auto max-w-2xl px-6 py-16 text-center">
        <p class="text-fg-secondary">Server workspace arrives in TASK-M1-08.</p>
      </main>
    </div>
  );
}

export default App;
