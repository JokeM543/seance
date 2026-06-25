---
description: Summon a fresh Claude chat that channels this session — summarize the task and open a new chat pre-loaded with it.
argument-hint: "[optional extra note for the next session]"
allowed-tools: Bash, Write, Read
---

You are conducting a **séance**: handing this session off to a **brand-new** Claude chat that
starts with no memory of this conversation. The note you write is the only thing it will see,
so make it complete enough that the next session can resume the task immediately.

## Step 1 — Generate the note and open the new chat

By default, **offload the summarizing to a cheaper model** so this (expensive) session does
not spend a turn composing the note. Run this single command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/seance-summarize.mjs" --open --note "$ARGUMENTS"
```

It reads this session's transcript, trims it to a small digest, writes
`${CLAUDE_PROJECT_DIR}/.claude/seance.md` using a separate model (Sonnet by default;
configurable via the `summarizer` plugin option), and opens a fresh Claude chat pre-loaded
with it. **If it exits 0, you're done — go to Step 2.**

### Fallback — compose it yourself

If that command **fails (non-zero exit)** — e.g. `claude -p` is unavailable, or the user set
`summarizer = self` (the script bails so this path runs) — then compose the note from THIS
conversation yourself and open the chat manually:

1. Write `${CLAUDE_PROJECT_DIR}/.claude/seance.md` (create `.claude/` if needed) using exactly
   these sections:

   ```markdown
   # Séance note

   ## Goal
   <objective, 1–3 sentences>

   ## Current state
   <what's done; what works / doesn't right now>

   ## Key decisions & constraints
   <choices made, what NOT to redo, conventions, gotchas>

   ## Files touched
   <bullet list of paths, each a one-line note>

   ## Next steps
   <ordered, actionable to-do — start here>

   ## How to run / test
   <exact commands>
   ```

   **Keep it lean** (this is the point): ≤ ~40 lines, bullets only, reference files by path,
   **never paste code or long output**, omit empty sections, capture decisions/state — not a
   transcript. If the user passed an extra note as `$ARGUMENTS`, fold it into **Next steps**.

2. Open the new chat:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/seance-open.mjs" --file "${CLAUDE_PROJECT_DIR}/.claude/seance.md"
   ```

## Step 2 — Report and stop

Tell the user which IDE/scheme the helper used and that a new chat has opened pre-loaded with
the note. **Do not keep working on the task in this session** — the new chat takes over from
"Next steps".
