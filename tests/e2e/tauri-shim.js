// Browser-side Tauri IPC shim for the Playwright E2E suite (tests/e2e).
//
// The app is a Tauri client: server registry, health monitor, SSE stream,
// PTY channel and plugin events all ride the `window.__TAURI_INTERNALS__`
// IPC bridge. CI runs plain Chromium against vite dev + the Mock OpenCode
// Server, so this init script (installed via page.addInitScript) replaces
// the bridge with browser implementations of the commands the UI actually
// uses. Everything else resolves a benign default so unguarded calls at
// mount never crash.
//
// Implemented against the real Tauri v2 bridge surface (docs/testing.md
// §3 L4): invoke(cmd, args), transformCallback / postMessage (Channel
// protocol: { channel, payload: { index, message } }), the event plugin
// (plugin:event|listen with transformCallback handler ids), and the window
// metadata (`metadata.currentWindow`). Test-side hooks hang off
// window.__TAURI_SHIM__ (event emission, connection counters, PTY echo
// recording). State lives on window.__TAURI_SHIM_STATE__ so re-running the
// init script (reload) never double-installs or resets the registry.

(function () {
  "use strict";

  if (window.__TAURI_INTERNALS__ !== undefined) return;

  var MOCK_BASE = "http://localhost:14096";
  var HEALTH_INTERVAL_MS = 1500;

  // ---- persistent state -------------------------------------------------

  var state = (window.__TAURI_SHIM_STATE__ = window.__TAURI_SHIM_STATE__ || {
    servers: [],
    discovered: [],
    listeners: {}, // event name -> handler ids
    listenerEvents: {}, // event id -> event name
    callbacks: {}, // transformCallback id -> fn
    channels: {}, // channel id -> channel callback (redundant; see callbacks)
    subIndex: 0,
    eventIndex: 0,
    callbackIndex: 0,
    connIndex: 0,
    sse: {}, // subscription id -> { es }
    sseConnections: 0,
    sseReconnects: 0,
    healthTimers: {}, // serverId -> interval
    healthFails: {},
    ptyChannels: {}, // connection id -> channel id
    ptyIndex: {}, // connection id -> delivered frame index
    ptySends: [],
    ptyFrames: [],
    sseMessages: 0,
    seenEvents: [],
    // desktop prefs replay state (close-to-tray + summon accelerator).
    globalShortcut: undefined,
    closeToTray: undefined,
  });

  // ---- helpers ----------------------------------------------------------

  // Records a desktop-prefs command (close-to-tray / summon accelerator)
  // into sessionStorage so the E2E tests can assert the startup prefs
  // replay across a page reload (sessionStorage survives reloads; the
  // __TAURI_SHIM_STATE__ object does not).
  function recordDesktopInvoke(cmd, args) {
    try {
      var log = JSON.parse(sessionStorage.getItem("__desktop_invoke_log__") || "[]");
      log.push(cmd + ":" + JSON.stringify(args));
      sessionStorage.setItem("__desktop_invoke_log__", JSON.stringify(log));
    } catch {
      // Storage unavailable: the replay test has nothing to assert on.
    }
  }

  function emit(event, payload) {
    var ids = state.listeners[event] || [];
    for (var i = 0; i < ids.length; i++) {
      var cb = state.callbacks[ids[i]];
      if (typeof cb === "function") {
        try {
          cb({ event: event, id: event, payload: payload });
        } catch (err) {
          console.warn("[tauri-shim] listener threw for " + event, err);
        }
      }
    }
  }

  function deliver(channelId, message) {
    var cb = state.callbacks[channelId];
    state.deliveries = (state.deliveries || 0) + 1;
    if (typeof cb !== "function") {
      state.deliveriesMissed = (state.deliveriesMissed || 0) + 1;
      return;
    }
    try {
      cb(message);
    } catch (err) {
      console.warn("[tauri-shim] channel handler threw", err);
    }
  }

  function serversChanged() {
    emit(
      "servers-changed",
      state.servers.map(function (s) {
        return { id: s.id, name: s.name, url: s.url, createdAt: s.createdAt };
      }),
    );
  }

  function serverUrl(serverId) {
    for (var i = 0; i < state.servers.length; i++) {
      if (state.servers[i].id === serverId) return state.servers[i].url;
    }
    return null;
  }

  function probeHealth(url) {
    return fetch(url.replace(/\/+$/, "") + "/global/health", {
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (!response.ok) throw new Error("probe failed: HTTP " + response.status);
      return response.json();
    });
  }

  function emitHealth(serverId, url, healthy, version, failCount) {
    emit("server-health", {
      serverId: serverId,
      healthy: healthy,
      version: version,
      latencyMs: healthy ? 3 : undefined,
      status: healthy ? "ok" : "down",
      lastOk: healthy ? Date.now() : undefined,
      failCount: failCount,
    });
  }

  function startHealthMonitor(serverId, url) {
    if (state.healthTimers[serverId] !== undefined) return;
    state.healthFails[serverId] = 0;
    var timer = setInterval(function () {
      probeHealth(url)
        .then(function (health) {
          state.healthFails[serverId] = 0;
          emitHealth(
            serverId,
            url,
            health.healthy === true,
            typeof health.version === "string" ? health.version : undefined,
            0,
          );
        })
        .catch(function () {
          state.healthFails[serverId] = (state.healthFails[serverId] || 0) + 1;
          emitHealth(serverId, url, false, undefined, state.healthFails[serverId]);
        });
    }, HEALTH_INTERVAL_MS);
    state.healthTimers[serverId] = timer;
  }

  function stopHealthMonitor(serverId) {
    var timer = state.healthTimers[serverId];
    if (timer !== undefined) {
      clearInterval(timer);
      delete state.healthTimers[serverId];
    }
  }

  // ---- transformCallback / postMessage ----------------------------------

  function transformCallback(callback) {
    state.callbackIndex += 1;
    state.callbacks[state.callbackIndex] = callback;
    return state.callbackIndex;
  }

  function unregisterCallback(id) {
    delete state.callbacks[id];
  }

  function postMessage(message) {
    if (message !== null && typeof message === "object") {
      if (typeof message.channel === "number") {
        deliver(message.channel, message.payload);
        return;
      }
      if (typeof message.callback === "number") {
        deliver(message.callback, message.payload);
        return;
      }
    }
  }

  // ---- PTY echo channel -------------------------------------------------

  function ptyFrame(connId, bytes) {
    var channelId = state.ptyChannels[connId];
    if (channelId === undefined) return;
    state.ptyFrames.push(Array.prototype.slice.call(bytes));
    var envelope = { bytes: Array.prototype.slice.call(bytes) };
    // The Channel protocol requires sequential indexes starting at 0.
    state.ptyIndex[connId] = (state.ptyIndex[connId] ?? -1) + 1;
    deliver(channelId, { index: state.ptyIndex[connId], message: envelope });
  }

  // ---- invoke -----------------------------------------------------------

  function invoke(cmd, args) {
    args = args || {};
    switch (cmd) {
      // ---- server registry ----
      case "list_servers":
        return Promise.resolve(
          state.servers.map(function (s) {
            return { id: s.id, name: s.name, url: s.url, createdAt: s.createdAt };
          }),
        );
      case "add_server": {
        var entry = args.entry || {};
        state.servers.push({
          id: "srv-" + (state.servers.length + 1),
          name: entry.name,
          url: entry.url,
          username: entry.username,
          password: entry.password,
          createdAt: Date.now(),
          lastConnectedAt: undefined,
        });
        var saved = state.servers[state.servers.length - 1];
        serversChanged();
        startHealthMonitor(saved.id, saved.url);
        return Promise.resolve({
          id: saved.id,
          name: saved.name,
          url: saved.url,
          username: saved.username,
          createdAt: saved.createdAt,
        });
      }
      case "update_server": {
        var existing = null;
        for (var i = 0; i < state.servers.length; i++) {
          if (state.servers[i].id === args.id) existing = state.servers[i];
        }
        if (existing === null) return Promise.reject(new Error("unknown server " + args.id));
        var patch = args.entry || {};
        if (typeof patch.name === "string") existing.name = patch.name;
        if (typeof patch.url === "string") existing.url = patch.url;
        if (typeof patch.username === "string") existing.username = patch.username;
        if (typeof patch.password === "string") existing.password = patch.password;
        serversChanged();
        return Promise.resolve({
          id: existing.id,
          name: existing.name,
          url: existing.url,
          username: existing.username,
          createdAt: existing.createdAt,
        });
      }
      case "remove_server": {
        state.servers = state.servers.filter(function (s) {
          return s.id !== args.id;
        });
        stopHealthMonitor(args.id);
        delete state.healthFails[args.id];
        serversChanged();
        return Promise.resolve();
      }
      case "probe_server": {
        var url = String(args.url || "");
        return probeHealth(url)
          .then(function (health) {
            return {
              serverId: url,
              healthy: health.healthy === true,
              version:
                health.healthy === true && typeof health.version === "string"
                  ? health.version
                  : undefined,
              latencyMs: health.healthy === true ? 3 : undefined,
              lastOk: health.healthy === true ? Date.now() : undefined,
              failCount: 0,
              status: health.healthy === true ? "ok" : "down",
            };
          })
          .catch(function () {
            return {
              serverId: url,
              healthy: false,
              failCount: 1,
              status: "down",
            };
          });
      }
      case "start_health_monitoring": {
        var target = serverUrl(args.serverId);
        if (target !== null) startHealthMonitor(args.serverId, target);
        return Promise.resolve();
      }

      // ---- mDNS discovery (simulated) ----
      case "start_mdns_discovery": {
        if (state.discovered.length === 0) {
          setTimeout(function () {
            var entry = {
              id: "mdns-1",
              name: "Mock Server (mDNS)",
              url: "http://localhost:14096",
              host: "localhost",
              port: 14096,
            };
            state.discovered.push(entry);
            emit("server-discovered", entry);
          }, 400);
        }
        return Promise.resolve();
      }
      case "stop_mdns_discovery":
        return Promise.resolve();
      case "get_discovered_servers":
        return Promise.resolve(state.discovered.slice());

      // ---- SSE stream (EventSource against the mock) ----
      case "sse_subscribe": {
        var directory = typeof args.directory === "string" ? args.directory : undefined;
        // syncDelay (mock extension) holds the scenario timeline back so
        // the client's server.connected re-sync settles before the first
        // scenario event races it (see tests/mock-server/sse.ts).
        var sseUrl =
          MOCK_BASE +
          (directory
            ? "/event?directory=" + encodeURIComponent(directory) + "&syncDelay=250"
            : "/global/event?syncDelay=250");
        var channelId = args.channel ? args.channel.id : undefined;
        var es = new EventSource(sseUrl);
        // The Channel protocol requires sequential indexes starting at 0.
        var index = -1;
        state.sseConnections += 1;
        es.onopen = function () {
          state.sseReconnects += 1;
        };
        es.onmessage = function (event) {
          if (channelId === undefined) return;
          var parsed = null;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return;
          }
          state.sseMessages += 1;
          if (state.seenEvents.length < 20) state.seenEvents.push(parsed.type);
          index += 1;
          deliver(channelId, { index: index, message: parsed });
        };
        es.onerror = function () {
          // EventSource auto-reconnects; the mock replays its scenario per
          // connection, so a drop + reconnect re-syncs the app state.
        };
        state.subIndex += 1;
        state.sse[state.subIndex] = { es: es };
        return Promise.resolve(state.subIndex);
      }
      case "sse_unsubscribe": {
        var sub = state.sse[args.subscriptionId];
        if (sub !== undefined) {
          sub.es.close();
          delete state.sse[args.subscriptionId];
        }
        return Promise.resolve();
      }

      // ---- PTY channel (echo loop, no server WebSocket) ----
      case "pty_ws_connect": {
        state.connIndex += 1;
        var connId = state.connIndex;
        state.ptyChannels[connId] = args.channel ? args.channel.id : undefined;
        // Welcome banner so the terminal is visibly alive after creation.
        var welcome = "\u001b[1;32mmock pty ready\u001b[0m\r\n$ ";
        setTimeout(function () {
          ptyFrame(
            connId,
            Uint8Array.from(welcome, function (ch) {
              return ch.charCodeAt(0);
            }),
          );
        }, 50);
        return Promise.resolve(connId);
      }
      case "pty_ws_send": {
        var data = Array.isArray(args.data) ? args.data : [];
        state.ptySends.push(data.slice());
        // Echo the keystrokes back with a prompt, like a local shell.
        var echoed = data.slice();
        Array.prototype.push.apply(
          echoed,
          Uint8Array.from("\r\n$ ", function (ch) {
            return ch.charCodeAt(0);
          }),
        );
        ptyFrame(args.connectionId, echoed);
        return Promise.resolve();
      }
      case "pty_ws_close":
        delete state.ptyChannels[args.connectionId];
        return Promise.resolve();

      // ---- event plugin ----
      case "plugin:event|listen": {
        var eventName = String(args.event || "");
        state.eventIndex += 1;
        var eventId = "evt-" + state.eventIndex;
        if (typeof args.handler === "number") {
          (state.listeners[eventName] = state.listeners[eventName] || []).push(args.handler);
          state.listenerEvents[eventId] = eventName;
        }
        return Promise.resolve(eventId);
      }
      case "plugin:event|unlisten": {
        var unlistenEvent = state.listenerEvents[args.eventId];
        if (unlistenEvent !== undefined) {
          delete state.listenerEvents[args.eventId];
        }
        return Promise.resolve();
      }
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        return Promise.resolve();

      // ---- app / updater / window plugins (benign) ----
      case "plugin:app|version":
        return Promise.resolve("0.1.0");
      case "plugin:updater|check":
        return Promise.resolve(null);
      case "plugin:window|is_maximized":
      case "plugin:window|is_focused":
      case "plugin:window|is_visible":
      case "plugin:window|is_decorated":
      case "plugin:window|is_fullscreen":
      case "plugin:window|is_resizable":
      case "plugin:window|is_closable":
      case "plugin:window|is_minimized":
      case "plugin:window|is_enabled":
        return Promise.resolve(false);
      case "plugin:window|title":
        return Promise.resolve("opencoder");
      case "plugin:window|scale_factor":
        return Promise.resolve(1);
      case "plugin:window|theme":
        return Promise.resolve("light");
      case "plugin:window|inner_size":
        return Promise.resolve({ width: 1280, height: 800 });
      case "plugin:window|inner_position":
        return Promise.resolve({ x: 0, y: 0 });
      case "plugin:window|get_all_windows":
        return Promise.resolve([{ label: "main" }]);

      // ---- desktop / tray / pet commands (benign) ----
      case "get_close_to_tray":
        return Promise.resolve(!!state.closeToTray);
      case "set_close_to_tray":
        recordDesktopInvoke("set_close_to_tray", args);
        state.closeToTray = !!args.enabled;
        return Promise.resolve();
      case "get_global_shortcut":
        return Promise.resolve(state.globalShortcut || "Alt+Space");
      case "set_global_shortcut":
        recordDesktopInvoke("set_global_shortcut", args);
        state.globalShortcut = args.accelerator || "Alt+Space";
        return Promise.resolve(state.globalShortcut);
      case "tray_set_badge":
        return Promise.resolve();

      case "http_request":
        return Promise.reject(
          new Error("http_request is not implemented in the E2E shim (fetch transport is active)"),
        );

      default:
        // pet_*, plugin:notification|*, anything else: benign default.
        return Promise.resolve(null);
    }
  }

  // ---- install ----------------------------------------------------------

  window.__TAURI_INTERNALS__ = {
    invoke: invoke,
    transformCallback: transformCallback,
    unregisterCallback: unregisterCallback,
    postMessage: postMessage,
    convertFileSrc: function (path) {
      return path;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWindows: [{ label: "main" }],
    },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function () {},
  };

  // Test-side hooks: emit synthetic events, read connection/health/pty
  // telemetry, or force an mDNS discovery entry.
  window.__TAURI_SHIM__ = {
    emit: emit,
    state: state,
    discover: function (entry) {
      state.discovered.push(entry);
      emit("server-discovered", entry);
    },
  };
})();
