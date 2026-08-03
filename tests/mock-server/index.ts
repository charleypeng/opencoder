import { buildApp } from "./app.js";
import { fixturesRoot } from "./fixtures.js";

// CLI entry point for the mock OpenCode server.
//
// Usage:
//   tsx tests/mock-server/index.ts [--port 14096] [--cors] [--auth]
//
//   --port <number>      listen port (default 14096)
//   --cors               enable dev-only CORS (Tauri webview / Vite origins)
//   --auth               require Basic Auth; password from the
//                        OPENCODE_SERVER_PASSWORD env var or --auth-password
//   --auth-password <pw> Basic Auth password (overrides the env var)
//
// Fixtures come from tests/mock-server/fixtures by default; set
// MOCK_FIXTURES_DIR to an alternate fixture root (e.g. tests/fixtures).

interface CliOptions {
  port: number;
  cors: boolean;
  authPassword: string | undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { port: 14096, cors: false, authPassword: undefined };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--port":
        options.port = Number(argv[++i]);
        if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
          throw new Error(`invalid --port value: "${argv[i]}"`);
        }
        break;
      case "--cors":
        options.cors = true;
        break;
      case "--auth":
        options.authPassword = process.env.OPENCODE_SERVER_PASSWORD;
        break;
      case "--auth-password":
        options.authPassword = argv[++i];
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: tsx tests/mock-server/index.ts [options]",
            "",
            "Options:",
            "  --port <number>       listen port (default 14096)",
            "  --cors                enable dev-only CORS for Tauri/Vite origins",
            "  --auth                require Basic Auth (OPENCODE_SERVER_PASSWORD env var)",
            "  --auth-password <pw>  Basic Auth password (overrides the env var)",
            "  --help, -h            show this help",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: "${arg}" (see --help)`);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.authPassword === undefined) {
  console.log("[mock] auth disabled (no password configured)");
} else if (options.authPassword === "") {
  throw new Error("--auth given but OPENCODE_SERVER_PASSWORD is empty (use --auth-password)");
}

const app = buildApp({ cors: options.cors, authPassword: options.authPassword });

app.listen(options.port, () => {
  console.log(`[mock] OpenCode mock server listening on http://localhost:${options.port}`);
  console.log(
    `[mock] cors=${options.cors} auth=${options.authPassword !== undefined ? "on" : "off"}`,
  );
  console.log(`[mock] fixtures root=${fixturesRoot()}`);
});
