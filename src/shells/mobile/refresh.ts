// Mobile session list refresh (TASK-M7-06): the pull-to-refresh target of
// the mobile Sessions tab. Re-fetches the session list and the status map
// (the two session calls `syncAll` performs — the mobile shell has no
// directory/project UI yet, so projects are skipped) and applies both to
// the stores. Errors propagate; the caller decides how to surface them
// (pull-to-refresh swallows — the next pull retries).

import { getApiClient } from "../../services/client.js";
import { createSessionService } from "../../services/session.js";
import { applySessionList, setStatusMap } from "../../stores/session.js";

/** Re-fetches GET /session + GET /session/status and applies both. */
export async function refreshSessionList(serverId: string): Promise<void> {
  const service = createSessionService(getApiClient());
  const [list, statuses] = await Promise.all([service.list(), service.statusAll()]);
  applySessionList(serverId, list);
  setStatusMap(serverId, statuses);
}
