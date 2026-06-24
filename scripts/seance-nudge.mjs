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

function main() {
  // Threshold in KB from plugin user config (CLAUDE_PLUGIN_OPTION_NUDGE_KB), default 400.
  // 0 (or negative) disables the nudge entirely.
  const kb = Number(process.env.CLAUDE_PLUGIN_OPTION_NUDGE_KB ?? 400);
  if (!Number.isFinite(kb) || kb <= 0) return;
  const threshold = kb * 1024;

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
