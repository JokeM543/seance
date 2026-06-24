#!/usr/bin/env node
// seance-nudge.mjs — UserPromptSubmit hook. When the session transcript grows past a
// threshold, print a one-line nudge to run /seance. The nudge goes in the JSON output's
// `systemMessage`, which Claude Code shows to the USER only (not injected into the model
// context), so the reminder itself costs ~no tokens.
//
// Contract: receives { session_id, transcript_path, cwd, prompt } on stdin.
// MUST always exit 0 and never throw — a hook must not slow or block the user's prompt.

import { statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8"); // fd 0
  } catch {
    return "";
  }
}

// Named presets → transcript size in KB. Choose by how long you let a session grow
// before /seance nudges you: "light" nudges early, "long" nudges late.
const PRESETS_KB = { light: 150, medium: 350, long: 700 };
const DISABLED = new Set(["off", "none", "disabled", "false", "0"]);

// Resolve the nudge threshold (bytes) from config. Accepts a preset name, a raw KB number,
// or an off-switch. Falls back to "medium". Backward-compatible with the old numeric
// `nudge_kb` option. Returns 0 when disabled.
function resolveThresholdBytes() {
  const raw = (
    process.env.CLAUDE_PLUGIN_OPTION_NUDGE ??
    process.env.CLAUDE_PLUGIN_OPTION_NUDGE_KB ?? // legacy numeric option
    "medium"
  )
    .toString()
    .trim()
    .toLowerCase();

  if (raw === "") return PRESETS_KB.medium * 1024;
  if (DISABLED.has(raw)) return 0;
  if (raw in PRESETS_KB) return PRESETS_KB[raw] * 1024;
  const n = Number(raw); // raw KB for power users
  if (Number.isFinite(n)) return Math.max(0, n) * 1024;
  return PRESETS_KB.medium * 1024; // unrecognized → default
}

function main() {
  const threshold = resolveThresholdBytes();
  if (threshold <= 0) return; // disabled

  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return; // no/garbled input → stay silent
  }
  const transcriptPath = input?.transcript_path;
  const sessionId = input?.session_id || "unknown";
  if (!transcriptPath) return;

  let size;
  try {
    size = statSync(transcriptPath).size;
  } catch {
    return; // transcript not found yet
  }
  if (size < threshold) return;

  // Per-session state so we nudge on first crossing, then once per added `threshold` of
  // growth — never on every prompt.
  const stateDir = join(tmpdir(), "claude-seance-nudge");
  const statePath = join(stateDir, `${sessionId}.json`);
  let lastNudgedBytes = 0;
  try {
    lastNudgedBytes = JSON.parse(readFileSync(statePath, "utf8")).lastNudgedBytes || 0;
  } catch {
    /* first time this session */
  }
  if (size < lastNudgedBytes + threshold) return;

  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ lastNudgedBytes: size }));
  } catch {
    /* best-effort; a failed write just means we might nudge again next turn */
  }

  const kbNow = Math.round(size / 1024);
  const tokEst = Math.round(size / 4 / 1000); // very rough: ~4 bytes/token
  const msg =
    `🔮 This session is ~${kbNow} KB (~${tokEst}k tokens est.) and re-sent every turn. ` +
    `Run /seance to continue in a fresh, cheaper chat.`;
  process.stdout.write(JSON.stringify({ systemMessage: msg }));
}

try {
  main();
} catch {
  /* never let a hook error affect the prompt */
}
process.exit(0);
