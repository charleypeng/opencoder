import AddServer from "./features/servers/AddServer";

function App() {
  return (
    <div class="min-h-screen bg-bg-base text-fg-primary">
      <header class="glass sticky top-0 z-10 flex items-center justify-between px-6 py-4">
        <div>
          <h1 class="text-lg font-semibold">opencode-client</h1>
          <p class="text-sm text-fg-secondary">Add a server</p>
        </div>
      </header>
      <main class="mx-auto max-w-xl px-6 py-10">
        <AddServer />
      </main>
    </div>
  );
}

export default App;
