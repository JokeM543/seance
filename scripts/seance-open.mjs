#!/usr/bin/env node
// seance-open.mjs — open a fresh Claude Code chat in the current IDE, pre-loaded with a
// séance note, via the Claude Code extension deep link:
//   <scheme>://anthropic.claude-code/open?prompt=<urlencoded text>
// Omitting the `session` param makes the extension open a brand-new conversation.
//
// Usage:
//   node seance-open.mjs --file <path-to-seance.md>
//   node seance-open.mjs --prompt "<text>"
//
// IDE is detected from ~/.claude/ide/<port>.lock ({ ideName, workspaceFolders }).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

const EXTENSION_ID = "anthropic.claude-code";
// Above this many encoded characters we pass a short pointer prompt instead of the whole
// note, so we never overflow the OS URL handler. The file remains the source of truth.
const ENCODED_LIMIT = 8000;

// ── arg parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--prompt") out.prompt = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

// ── IDE detection ───────────────────────────────────────────────────────────
const IDE_SCHEME = {
  "visual studio code": "vscode",
  "visual studio code - insiders": "vscode-insiders",
  "vscodium": "vscodium",
  "cursor": "cursor",
  "windsurf": "windsurf",
};

function schemeForIdeName(ideName) {
  if (!ideName) return null;
  const key = String(ideName).toLowerCase().trim();
  if (IDE_SCHEME[key]) return IDE_SCHEME[key];
  // Fall back to a loose contains-match so minor name variants still resolve.
  for (const [name, scheme] of Object.entries(IDE_SCHEME)) {
    if (key.includes(name)) return scheme;
  }
  return null;
}

// Returns { scheme, ideName } or null if no IDE lock found.
function detectIde(projectDir) {
  const ideDir = join(homedir(), ".claude", "ide");
  let entries;
  try {
    entries = readdirSync(ideDir).filter((f) => f.endsWith(".lock"));
  } catch {
    return null;
  }
  const locks = [];
  for (const f of entries) {
    const full = join(ideDir, f);
    try {
      const data = JSON.parse(readFileSync(full, "utf8"));
      locks.push({ data, mtime: statSync(full).mtimeMs });
    } catch {
      /* ignore malformed lock */
    }
  }
  if (locks.length === 0) return null;

  // Prefer the lock whose workspaceFolders contains the current project dir.
  let chosen = null;
  if (projectDir) {
    for (const l of locks) {
      const folders = l.data.workspaceFolders || [];
      if (folders.some((wf) => projectDir === wf || projectDir.startsWith(wf + "/"))) {
        chosen = l;
        break;
      }
    }
  }
  // Otherwise the most recently touched lock.
  if (!chosen) chosen = locks.sort((a, b) => b.mtime - a.mtime)[0];

  const scheme = schemeForIdeName(chosen.data.ideName);
  return { scheme, ideName: chosen.data.ideName };
}

// ── opening the URL ─────────────────────────────────────────────────────────
function openUrl(url) {
  const plat = platform();
  if (plat === "darwin") return spawn("open", [url], { stdio: "ignore", detached: true });
  if (plat === "win32")
    return spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  return spawn("xdg-open", [url], { stdio: "ignore", detached: true }); // linux & others
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Resolve the note text and the file path (for the pointer fallback).
  let fullText;
  let filePath = args.file;
  if (filePath) {
    if (!isAbsolute(filePath)) filePath = join(projectDir, filePath);
    try {
      fullText = readFileSync(filePath, "utf8");
    } catch (e) {
      console.error(`seance: could not read --file ${filePath}: ${e.message}`);
      process.exit(1);
    }
  } else if (args.prompt) {
    fullText = args.prompt;
  } else {
    console.error("seance: provide --file <path> or --prompt <text>");
    process.exit(1);
  }

  const lead = "You're picking up a handed-off task in a fresh session. Full context below — start from \"Next steps\".\n\n";
  const inlinePrompt = lead + fullText;
  const encodedInline = encodeURIComponent(inlinePrompt);

  // Length guard: fall back to a short pointer that tells the new chat to read the file.
  let promptText;
  if (encodedInline.length <= ENCODED_LIMIT || !filePath) {
    promptText = inlinePrompt;
  } else {
    const rel = filePath.startsWith(projectDir) ? relative(projectDir, filePath) : filePath;
    promptText = `Read \`${rel}\` for the full séance note from the previous session, then continue from its "Next steps".`;
  }
  const encoded = encodeURIComponent(promptText);

  // Detect IDE.
  const ide = detectIde(projectDir);

  // No IDE connected → can't deep-link reliably. Print actionable fallback.
  if (!ide) {
    console.log("seance: no IDE detected (no ~/.claude/ide/*.lock).");
    if (filePath) {
      console.log(`Séance note written to: ${filePath}`);
      console.log(`Start a new chat with it from a terminal:\n  claude "$(cat '${filePath}')"`);
    }
    process.exit(0);
  }

  const scheme = ide.scheme || "vscode";
  if (!ide.scheme) {
    console.error(
      `seance: unrecognized IDE "${ide.ideName}" — defaulting to scheme "vscode". ` +
        `Add it to IDE_SCHEME in seance-open.mjs if this opens the wrong app.`
    );
  }
  const url = `${scheme}://${EXTENSION_ID}/open?prompt=${encoded}`;

  if (args.dryRun) {
    console.log(`ideName : ${ide.ideName}`);
    console.log(`scheme  : ${scheme}`);
    console.log(`mode    : ${promptText === inlinePrompt ? "inline" : "pointer"}`);
    console.log(`urlLen  : ${url.length}`);
    console.log(`url     : ${url.slice(0, 120)}${url.length > 120 ? "…" : ""}`);
    return;
  }

  const child = openUrl(url);
  child.on("error", (e) => {
    console.error(`seance: failed to open URL (${e.message}). URL was:\n${url}`);
    process.exit(1);
  });
  child.unref();

  const mode = promptText === inlinePrompt ? "inline context" : "pointer to séance note";
  console.log(`seance: opened a new chat in ${ide.ideName} (${scheme}://) with ${mode}.`);
}

main();
