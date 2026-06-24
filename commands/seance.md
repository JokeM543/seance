---
description: Summon a fresh Claude chat that channels this session — summarize the task and open a new chat pre-loaded with it.
argument-hint: "[optional extra note for the next session]"
allowed-tools: Bash, Write, Read
---

You are conducting a **séance**: handing this session off to a **brand-new** Claude chat that
starts with no memory of this conversation. The note you write is the only thing it will see,
so make it complete enough that the next session can resume the task immediately.

## Step 1 — Write the séance note

Using the full context of THIS conversation, write a concise but complete handoff to
`${CLAUDE_PROJECT_DIR}/.claude/seance.md` (create the `.claude` directory if it does not
exist). Address it to the next Claude session. Use exactly these sections:

```markdown
# Séance note

## Goal
<the overall objective in 1–3 sentences>

## Current state
<what is done so far; what is working / not working right now>

## Key decisions & constraints
<choices already made, things to NOT redo, conventions to follow, gotchas>

## Files touched
<bullet list of paths created/edited, each with a one-line note>

## Next steps
<an ordered, actionable to-do list — start here>

## How to run / test
<exact commands to build, run, or verify>
```

If the user passed an extra note as `$ARGUMENTS`, weave it into the relevant section
(usually **Next steps**).

### Budget — keep it lean (this is the point)

The note is the new session's *entire* starting context, and its only token-saving value
comes from being small. So:

- **Target ≤ ~40 lines / ~600 tokens.** Shorter is better.
- **Reference files by path** (e.g. `src/auth.ts:42`), **never paste code, file contents,
  diffs, or long tool output** — the new session reads files fresh as needed.
- Bullets only. No prose padding, no preamble, no restating these instructions.
- Omit any section that would be empty. Cut anything the next session can rediscover cheaply.
- Capture *decisions and state*, not a transcript. Favor "what's true now + what to do next"
  over "what we tried."

## Step 2 — Open the new chat

Run the bundled helper, which detects the current IDE (VSCode / Cursor / …), URL-encodes the
note, and opens a fresh Claude chat via the IDE deep link:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/seance-open.mjs" --file "${CLAUDE_PROJECT_DIR}/.claude/seance.md"
```

If `${CLAUDE_PROJECT_DIR}` is empty in your shell, use the current working directory's
`.claude/seance.md` instead.

## Step 3 — Report and stop

Tell the user which IDE/scheme the helper used and that a new chat has opened pre-loaded with
the note. **Do not keep working on the task in this session** — the new chat takes over from
"Next steps".
