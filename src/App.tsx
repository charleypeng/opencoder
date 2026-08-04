import { createSignal, Show } from "solid-js";
import ServerHome from "./features/servers/ServerHome";
import DesktopShell from "./shells/desktop/DesktopShell";
import MobileShell from "./shells/mobile/MobileShell";
import type { ServerEntry } from "./services/servers";

// App shell (TASK-M1-06/08): the server navigation home is the landing page;
// opening a server mounts the desktop workspace shell. Platform detection
// (DesktopShell vs MobileShell) lands in M7; every platform uses the
// desktop shell until then.

// (M7-02 spike) On iOS the glass plugin injects a native UITabBar; mount the
// mobile shell so the Liquid Glass demo is reachable in the simulator.
// Replaced by real platform detection (src/platform) in TASK-M7-03.
const isIOSWebView = typeof window !== "undefined" && !!window.webkit;

function App() {
  const [selected, setSelected] = createSignal<ServerEntry | null>(null);

  return (
    <>
      {isIOSWebView ? (
        <MobileShell />
      ) : (
        <Show when={selected()} fallback={<ServerHome onSelect={setSelected} />}>
          <DesktopShell server={selected() as ServerEntry} onExit={() => setSelected(null)} />
        </Show>
      )}
    </>
  );
}

export default App;
