#!/usr/bin/env node
// seance-summarize.mjs — write the séance note with a SEPARATE (cheaper) model so the main
// session never spends an expensive turn composing it. Reads the session transcript from
// disk, trims it to a compact digest, and pipes that to `claude -p --model <id>`.
//
// This also works standalone from a terminal — the robustness path for when the main chat
// is too full to take a turn ("Prompt is too long" / usage limit).
//
// Usage:
//   node seance-summarize.mjs [--transcript <path>] [--model <id|sonnet|haiku|opus>]
//                             [--open] [--print] [--dry-run]
//
//   --transcript  explicit transcript JSONL (default: newest in ~/.claude/projects/<enc cwd>/)
//   --model       model id or preset; default = $CLAUDE_PLUGIN_OPTION_SUMMARIZER or "sonnet"
//   --open        after writing the note, open a fresh chat (chains seance-open.mjs)
//   --print       print the note path instead of opening
//   --dry-run     build + measure the digest only; no model call

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_PRESETS = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  opus: "claude-opus-4-8",
};
const DIGEST_CHAR_CAP = 240_000; // ~60k tokens; keep the most-recent tail beyond this
const TOOL_INPUT_CAP = 80;
const TOOL_RESULT_CAP = 120;

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--transcript") out.transcript = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--note") out.note = argv[++i];
    else if (a === "--open") out.open = true;
    else if (a === "--print") out.print = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function resolveModel(arg) {
  const raw = (arg ?? process.env.CLAUDE_PLUGIN_OPTION_SUMMARIZER ?? "sonnet").toString().trim();
  const lc = raw.toLowerCase();
  if (lc in MODEL_PRESETS) return MODEL_PRESETS[lc];
  return raw; // assume a full model id
}

// ── locate transcript ───────────────────────────────────────────────────────
function locateTranscript(explicit) {
  if (explicit) return isAbsolute(explicit) ? explicit : join(process.cwd(), explicit);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const enc = projectDir.replace(/[^A-Za-z0-9]/g, "-"); // Claude's project-dir encoding
  const base = join(homedir(), ".claude", "projects");
  const dirs = [join(base, enc)];
  if (!existsSync(dirs[0])) {
    // fallback: scan every project dir
    try {
      for (const d of readdirSync(base)) dirs.push(join(base, d));
    } catch { /* no projects dir */ }
  }
  let newest = null;
  for (const d of dirs) {
    let files;
    try { files = readdirSync(d).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const full = join(d, f);
      const m = statSync(full).mtimeMs;
      if (!newest || m > newest.m) newest = { full, m };
    }
  }
  return newest?.full || null;
}

// ── trim transcript → digest ────────────────────────────────────────────────
function snippet(s, n) {
  s = (s ?? "").toString().replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function buildDigest(transcriptPath) {
  const raw = readFileSync(transcriptPath, "utf8").split("\n");
  const parts = [];
  for (const ln of raw) {
    if (!ln) continue;
    let o;
    try { o = JSON.parse(ln); } catch { continue; }
    if (o.isSidechain) continue;                       // subagent noise
    if (o.type !== "user" && o.type !== "assistant") continue;
    const m = o.message;
    if (!m) continue;
    const c = m.content;
    if (typeof c === "string") {
      if (o.type === "user" && c.trim()) parts.push("USER: " + c.trim());
      continue;
    }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === "text" && b.text?.trim()) {
        parts.push((o.type === "user" ? "USER: " : "ASSISTANT: ") + b.text.trim());
      } else if (b.type === "tool_use") {
        parts.push("  [tool " + b.name + " " + snippet(JSON.stringify(b.input || {}), TOOL_INPUT_CAP) + "]");
      } else if (b.type === "tool_result") {
        const txt = typeof b.content === "string" ? b.content : JSON.stringify(b.content || "");
        parts.push("  [result " + snippet(txt, TOOL_RESULT_CAP) + "]");
      } // skip thinking, image
    }
  }
  let digest = parts.join("\n");
  let trimmed = false;
  if (digest.length > DIGEST_CHAR_CAP) {
    digest = "[…earlier turns trimmed…]\n" + digest.slice(digest.length - DIGEST_CHAR_CAP);
    trimmed = true;
  }
  return { digest, trimmed, blocks: parts.length };
}

// ── prompt for the summarizer model ─────────────────────────────────────────
const TEMPLATE = `You are writing a "séance note": a handoff for a brand-new Claude Code session that
has NO memory of the conversation below. Summarize the session into exactly these sections:

# Séance note

## Goal
<the overall objective in 1–3 sentences>

## Current state
<what is done; what works / does not right now>

## Key decisions & constraints
<choices made, things to NOT redo, conventions, gotchas>

## Files touched
<bullet list of paths, each with a one-line note>

## Next steps
<ordered, actionable to-do list — the next session starts here>

## How to run / test
<exact commands>

Rules: ≤ ~40 lines. Bullets only. Reference files by path (e.g. src/auth.ts:42); NEVER paste
code, file contents, or long output. Omit any empty section. Capture decisions and state, not
a transcript. Output ONLY the note — no preamble, no closing remarks.`;

function buildPrompt(digest, note) {
  const extra =
    note && note.trim()
      ? `\n\nThe user added this instruction for the next session — fold it into "Next steps": ${note.trim()}`
      : "";
  return (
    TEMPLATE +
    extra +
    "\n\n--- SESSION DIGEST (oldest→newest) ---\n" +
    digest +
    "\n--- END DIGEST ---\n"
  );
}

function callModel(model, prompt) {
  const r = spawnSync("claude", ["-p", "--model", model], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  if (r.error) throw new Error(`claude -p failed to spawn: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`claude -p exited ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  return (r.stdout || "").trim();
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const transcript = locateTranscript(args.transcript);
  if (!transcript || !existsSync(transcript)) {
    console.error("seance-summarize: could not find a transcript (use --transcript <path>).");
    process.exit(1);
  }

  const { digest, trimmed, blocks } = buildDigest(transcript);
  const approxTokens = Math.round(digest.length / 4 / 1000);

  if (args.dryRun) {
    console.log(`transcript : ${transcript}`);
    console.log(`blocks kept: ${blocks}${trimmed ? " (older turns trimmed)" : ""}`);
    console.log(`digest     : ${Math.round(digest.length / 1024)} KB (~${approxTokens}k tokens)`);
    console.log(`--- head ---\n${digest.slice(0, 600)}\n--- tail ---\n${digest.slice(-600)}`);
    return;
  }

  const model = resolveModel(args.model);
  if (model.toLowerCase() === "self") {
    console.error("seance-summarize: summarizer=self is handled in-session, not by this script.");
    process.exit(2);
  }

  let note;
  try {
    note = callModel(model, buildPrompt(digest, args.note));
  } catch (e) {
    console.error(`seance-summarize: ${e.message}`);
    process.exit(1); // let the /seance command fall back to in-session composition
  }
  if (!note || !/##\s*Next steps/i.test(note)) {
    console.error("seance-summarize: model returned an unusable note; falling back.");
    process.exit(1);
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const notePath = join(projectDir, ".claude", "seance.md");
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(notePath, note.endsWith("\n") ? note : note + "\n");

  console.log(`seance-summarize: wrote ${notePath} via ${model} (digest ~${approxTokens}k tokens).`);

  if (args.open) {
    const r = spawnSync(process.execPath, [join(HERE, "seance-open.mjs"), "--file", notePath], {
      stdio: "inherit",
    });
    process.exit(r.status ?? 0);
  } else if (args.print) {
    console.log(notePath);
  }
}

main();
