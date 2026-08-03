import { createSignal, For, onMount } from "solid-js";
import { Switch } from "@kobalte/core";

const THEME_STORAGE_KEY = "oc-theme";

type Theme = "dark" | "light";

interface TokenMeta {
  name: string;
  var: string;
}

const colorTokens: TokenMeta[] = [
  { name: "bg-base", var: "--bg-base" },
  { name: "bg-elevated", var: "--bg-elevated" },
  { name: "bg-sunken", var: "--bg-sunken" },
  { name: "fg-primary", var: "--fg-primary" },
  { name: "fg-secondary", var: "--fg-secondary" },
  { name: "fg-faint", var: "--fg-faint" },
  { name: "accent", var: "--accent" },
  { name: "accent-soft", var: "--accent-soft" },
  { name: "success", var: "--success" },
  { name: "warning", var: "--warning" },
  { name: "danger", var: "--danger" },
];

const glassTokens: TokenMeta[] = [
  { name: "glass-bg", var: "--glass-bg" },
  { name: "glass-border", var: "--glass-border" },
  { name: "glass-blur", var: "--glass-blur" },
];

const typeScale: TokenMeta[] = [
  { name: "xs", var: "--text-xs" },
  { name: "sm", var: "--text-sm" },
  { name: "md", var: "--text-md" },
  { name: "lg", var: "--text-lg" },
];

const radii: TokenMeta[] = [
  { name: "sm", var: "--r-sm" },
  { name: "md", var: "--r-md" },
  { name: "lg", var: "--r-lg" },
  { name: "xl", var: "--r-xl" },
];

const motionTokens: TokenMeta[] = [
  { name: "ease-spring", var: "--ease-spring" },
  { name: "dur-fast", var: "--dur-fast" },
  { name: "dur-med", var: "--dur-med" },
];

function TokenDemo() {
  const [theme, setTheme] = createSignal<Theme>("dark");
  const [resolved, setResolved] = createSignal<Record<string, string>>({});

  function refreshResolved() {
    const style = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const t of [
      ...colorTokens,
      ...glassTokens,
      ...typeScale,
      ...radii,
      ...motionTokens,
    ]) {
      next[t.var] = style.getPropertyValue(t.var).trim();
    }
    next["--density"] = style.getPropertyValue("--density").trim();
    setResolved(next);
  }

  onMount(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const initial: Theme = saved === "light" || saved === "dark" ? saved : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    refreshResolved();
  });

  function onThemeChange(isLight: boolean) {
    const next: Theme = isLight ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_STORAGE_KEY, next);
    refreshResolved();
  }

  return (
    <div class="min-h-screen bg-bg-base text-fg-primary" data-testid="token-demo">
      <header class="glass sticky top-0 z-10 flex items-center justify-between px-6 py-4">
        <div>
          <h1 class="text-lg font-semibold">Design tokens</h1>
          <p class="text-sm text-fg-secondary">
            TASK-M0-02 demo · Tailwind v4 bridge + Kobalte base
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-fg-secondary">Light mode</span>
          <Switch.Root checked={theme() === "light"} onChange={onThemeChange}>
            <Switch.Control class="inline-flex h-6 w-11 cursor-pointer items-center rounded-full bg-fg-faint px-0.5 transition-[background-color] duration-(--dur-fast) data-[checked]:bg-accent">
              <Switch.Thumb class="block h-5 w-5 rounded-full bg-bg-elevated shadow transition-transform duration-(--dur-med) ease-(--ease-spring) data-[checked]:translate-x-5" />
            </Switch.Control>
            <Switch.Input data-testid="theme-toggle" />
          </Switch.Root>
        </div>
      </header>

      <main class="mx-auto max-w-5xl space-y-10 px-6 py-10">
        <section>
          <h2 class="mb-4 text-lg font-semibold">Colors</h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <For each={colorTokens}>
              {(t) => (
                <div
                  class="rounded-r-md border border-bg-sunken bg-bg-elevated p-4"
                  data-token={t.var}
                >
                  <div
                    class="h-10 rounded-r-sm border border-fg-faint/20"
                    style={{ background: `var(${t.var})` }}
                  />
                  <p class="mt-2 text-sm font-medium">{t.name}</p>
                  <p class="font-code text-xs text-fg-faint">
                    {resolved()[t.var] || `var(${t.var})`}
                  </p>
                </div>
              )}
            </For>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-lg font-semibold">Type scale</h2>
          <div class="divide-y divide-bg-sunken rounded-r-md border border-bg-sunken bg-bg-elevated">
            <For each={typeScale}>
              {(t) => (
                <div
                  class="flex items-baseline justify-between px-4 py-3"
                  data-token={t.var}
                >
                  <span class="font-code text-xs text-fg-faint">
                    {t.name} · {resolved()[t.var] || `var(${t.var})`}
                  </span>
                  <span style={{ "font-size": `var(${t.var})` }}>
                    The quick brown fox jumps
                  </span>
                </div>
              )}
            </For>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-lg font-semibold">Radii</h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <For each={radii}>
              {(t) => (
                <div
                  class="rounded-r-md border border-bg-sunken bg-bg-elevated p-4"
                  data-token={t.var}
                >
                  <div class="h-10 bg-accent" style={{ "border-radius": `var(${t.var})` }} />
                  <p class="mt-2 text-sm">{t.name}</p>
                  <p class="font-code text-xs text-fg-faint">
                    {resolved()[t.var] || `var(${t.var})`}
                  </p>
                </div>
              )}
            </For>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-lg font-semibold">Motion</h2>
          <div class="rounded-r-md border border-bg-sunken bg-bg-elevated p-4">
            <ul class="mb-4 font-code text-xs text-fg-faint">
              <For each={motionTokens}>
                {(t) => (
                  <li data-token={t.var}>
                    {t.name}: {resolved()[t.var] || `var(${t.var})`}
                  </li>
                )}
              </For>
              <li data-token="--density">
                density: {resolved()["--density"] || "var(--density)"}
              </li>
            </ul>
            <div class="flex items-center gap-6">
              <div class="flex h-10 w-32 items-center justify-center rounded-r-md bg-accent text-xs transition-transform duration-(--dur-med) ease-(--ease-spring) hover:scale-110">
                Hover me
              </div>
              <div class="h-10 w-10 animate-pulse rounded-full bg-accent-soft" />
            </div>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-lg font-semibold">Density</h2>
          <div
            class="rounded-r-md border border-bg-sunken bg-bg-elevated"
            data-token="--density"
          >
            <div
              class="flex flex-wrap gap-2"
              style={{ padding: "calc(var(--density) * 0.75rem)" }}
            >
              <span class="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
                Server
              </span>
              <span class="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
                Sessions
              </span>
              <span class="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
                Files
              </span>
            </div>
            <p class="px-4 pb-3 font-code text-xs text-fg-faint">
              density: {resolved()["--density"] || "1"} · compact 0.92 · comfortable 1.06
            </p>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-lg font-semibold">Glass</h2>
          <div
            class="relative overflow-hidden rounded-r-xl p-10"
            style={{
              background:
                "linear-gradient(135deg, var(--accent), #34d399 60%, var(--warning))",
            }}
          >
            <div class="glass max-w-md p-6">
              <p class="text-md font-medium">Glass panel (.glass)</p>
              <p class="mt-1 text-sm text-fg-secondary">
                blur {resolved()["--glass-blur"] || "var(--glass-blur)"} · saturate 1.6 · 0.5px
                border
              </p>
              <ul class="mt-3 font-code text-xs text-fg-secondary">
                <For each={glassTokens}>
                  {(t) => (
                    <li data-token={t.var}>
                      {t.name}: {resolved()[t.var] || `var(${t.var})`}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-lg font-semibold">Fonts</h2>
          <div class="space-y-2 rounded-r-md border border-bg-sunken bg-bg-elevated p-4">
            <p data-token="--font-ui" style={{ "font-family": "var(--font-ui)" }}>
              UI stack — The quick brown fox jumps over the lazy dog
            </p>
            <p data-token="--font-code" class="font-code text-sm">
              Code stack — const tokens = { "{}" }; // JetBrains Mono / SF Mono
            </p>
          </div>
        </section>

        <footer class="pb-8 text-xs text-fg-faint" data-testid="theme-label">
          Current theme: {theme()}
        </footer>
      </main>
    </div>
  );
}

export default TokenDemo;
