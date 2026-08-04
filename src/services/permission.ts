// Permission domain service (TASK-M5-01): typed wrappers around the pending
// permission queue and the reply endpoint, factory form per architecture
// §4.4. Errors pass through as ApiError from the client (no catching here).

import type { components, operations } from "./api/schema.js";
import { type ApiClient, type ApiPath, type RequestOptions } from "./client.js";

export type PermissionRequest = components["schemas"]["PermissionRequest"];
/** Request body of `POST /permission/{requestID}/reply` ({ reply }). */
export type PermissionReplyInput = NonNullable<
  operations["permission.reply"]["requestBody"]
>["content"]["application/json"];
/** Reply choices accepted by the reply endpoint. */
export type PermissionReply = PermissionReplyInput["reply"];

function dirQuery(dir?: string): RequestOptions | undefined {
  return dir === undefined ? undefined : { query: { directory: dir } };
}

function replyPath(requestID: string): ApiPath {
  return `/permission/${requestID}/reply` as ApiPath;
}

export function createPermissionService(client: ApiClient) {
  return {
    /** List all pending permission requests (GET /permission). */
    list: (dir?: string) => client.get<PermissionRequest[]>("/permission", dirQuery(dir)),
    /**
     * Reply to one pending request (POST /permission/{requestID}/reply);
     * resolves to true on success.
     */
    reply: (requestID: string, reply: PermissionReply, dir?: string) =>
      client.post<boolean>(replyPath(requestID), {
        body: { reply } satisfies PermissionReplyInput,
        ...(dirQuery(dir) ?? {}),
      }),
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;
