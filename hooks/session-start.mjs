// SessionStart hook: warns once, in one line, when the plugin cannot work.
// Plain stdout of a SessionStart hook becomes session context. Prints nothing when
// everything is fine, never reads or prints the token value, always exits 0.
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_NODE = [22, 17, 0];

function nodeIsSupported(version) {
  const parts = version.split(".").map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < MIN_NODE.length; i += 1) {
    const have = parts[i] ?? 0;
    if (have !== MIN_NODE[i]) return have > MIN_NODE[i];
  }
  return true;
}

export function diagnose(nodeVersion, env) {
  const problems = [];
  if (!nodeIsSupported(nodeVersion)) {
    problems.push(
      `LoadCraft: Node ${MIN_NODE.slice(0, 2).join(".")} or newer is required (found ${nodeVersion}) — run /loadcraft:doctor`,
    );
  }
  const token = env["CLAUDE_PLUGIN_OPTION_API_TOKEN"];
  if (token === undefined || token === "") {
    problems.push(
      "LoadCraft: API token is not configured — run /loadcraft:doctor",
    );
  }
  return problems;
}

function isEntryPoint() {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return (
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href ===
      pathToFileURL(realpathSync(script)).href
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    const lines = diagnose(process.versions.node, process.env);
    if (lines.length > 0) process.stdout.write(`${lines.join("; ")}\n`);
  } catch {
    // A diagnostic hook must never block or fail the session.
  }
  process.exitCode = 0;
}
