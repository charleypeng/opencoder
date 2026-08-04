// Tray badge sync (TASK-M8-05): keeps the tray badge in step with the
// pending-permission load. The pure pendingPermissionCount is
// unit-tested; startTrayBadgeSync watches the permission store under a
// createRoot (DesktopShell mounts it) and pushes the count through the
// tray facade, which is a no-op outside Tauri.

import { createEffect, createRoot } from "solid-js";
import { permissions, type PermissionMap } from "../stores/permission.js";
import { setTrayBadge } from "./tray.js";

/** Total pending permission requests across all servers. */
export function pendingPermissionCount(map: PermissionMap): number {
  let total = 0;
  for (const server of Object.values(map)) {
    total += server.queue.length;
  }
  return total;
}

/** Watches the permission store and pushes the pending count to the tray
 *  badge (macOS badge / Linux title text; a no-op outside Tauri or on
 *  Windows). Returns a dispose function. */
export function startTrayBadgeSync(): () => void {
  return createRoot((dispose) => {
    createEffect(() => {
      void setTrayBadge(pendingPermissionCount(permissions));
    });
    return dispose;
  });
}
