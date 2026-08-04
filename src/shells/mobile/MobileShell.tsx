// Mobile shell placeholder (TASK-M1-08): the mobile workspace (bottom-tab
// navigation, sheets, gestures) lands in M7 together with platform
// detection. App.tsx currently mounts DesktopShell for every platform; this
// component is the seam for `platform.kind === "mobile"` once src/platform/
// exists (see docs/architecture.md §3).

import type { Component } from "solid-js";

const MobileShell: Component = () => {
  return (
    <div class="min-h-screen bg-bg-base text-fg-primary" data-testid="mobile-shell">
      <div class="flex min-h-screen items-center justify-center">
        <p class="text-sm text-fg-secondary">Mobile shell — M7</p>
      </div>
    </div>
  );
};

export default MobileShell;
