import { createSignal, Show } from "solid-js";
import ServerHome from "./features/servers/ServerHome";
import DesktopShell from "./shells/desktop/DesktopShell";
import type { ServerEntry } from "./services/servers";

// App shell (TASK-M1-06/08): the server navigation home is the landing page;
// opening a server mounts the desktop workspace shell. Platform detection
// (DesktopShell vs MobileShell) lands in M7; every platform uses the
// desktop shell until then.

function App() {
  const [selected, setSelected] = createSignal<ServerEntry | null>(null);

  return (
    <Show when={selected()} fallback={<ServerHome onSelect={setSelected} />}>
      <DesktopShell server={selected() as ServerEntry} onExit={() => setSelected(null)} />
    </Show>
  );
}

export default App;
