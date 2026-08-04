import { createSignal, Show } from "solid-js";
import ServerHome from "./features/servers/ServerHome";
import DesktopShell from "./shells/desktop/DesktopShell";
import MobileShell from "./shells/mobile/MobileShell";
import { platform } from "./platform";
import type { ServerEntry } from "./services/servers";

// App shell (TASK-M1-06/08 + M7-03): the server navigation home is the
// landing page; opening a server mounts the workspace shell for the
// detected platform (src/platform, docs/architecture.md §3) — DesktopShell
// on desktop, MobileShell on iOS/Android. Platform detection is
// UA/WebView-based with a viewport fallback; it never changes at runtime.

function App() {
  const [selected, setSelected] = createSignal<ServerEntry | null>(null);

  return (
    <>
      <Show when={selected()} fallback={<ServerHome onSelect={setSelected} />}>
        {platform.kind === "mobile" ? (
          <MobileShell server={selected() as ServerEntry} onExit={() => setSelected(null)} />
        ) : (
          <DesktopShell server={selected() as ServerEntry} onExit={() => setSelected(null)} />
        )}
      </Show>
    </>
  );
}

export default App;
