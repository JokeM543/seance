# 🔮 seance

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A2BE2)](https://code.claude.com/docs/en/plugins)
[![GitHub stars](https://img.shields.io/github/stars/JokeM543/seance?style=social)](https://github.com/JokeM543/seance)

> Summon a fresh Claude chat that channels the context of your current session.

<p align="center">
  <img src="docs/demo.gif" alt="Running /seance writes a handoff note and opens a fresh Claude chat pre-loaded with it" width="820">
</p>

`/seance` summarizes what you're working on and opens a **brand-new** Claude chat in your
IDE, pre-loaded with that context — so the next session grasps the task at once. Useful when
a conversation gets long, you want a clean slate, or you're parking work to resume later.

Unlike `/compact` (which continues the *same* session), `/seance` starts a *new* one and
bridges the gap with a written note. A long session re-sends its whole transcript every turn;
`/seance` lets you reset to a tiny baseline instead of dragging that weight forward.

## How it works

1. You run `/seance` in any session.
2. Claude writes a tight, structured note to `.claude/seance.md` (Goal, Current state, Key
   decisions, Files touched, Next steps, How to run/test) — bullets and file paths, no pasted
   code, so it stays small.
3. A bundled script detects your IDE and opens a new Claude chat via the Claude Code
   extension's deep link — `vscode://anthropic.claude-code/open?prompt=…` (or `cursor://…`,
   `vscode-insiders://…`). With no session id, the extension opens a fresh conversation, which
   auto-starts from the note.

It's a pure Claude Code plugin (a slash command + small Node helpers) — no compiled extension.
Works wherever the Claude Code IDE extension is installed (VSCode, Cursor, Insiders, Windsurf,
VSCodium).

## Install

```bash
claude plugin marketplace add JokeM543/seance
claude plugin install seance@seance
```

Then type `/seance` in any session. Restart Claude Code once after install so the nudge hook
loads.

### Local development

Point the marketplace at a local checkout instead of GitHub:

```bash
claude plugin marketplace add /path/to/seance
claude plugin install seance@seance
```

## Features

### `/seance` — hand off to a fresh chat

Writes `.claude/seance.md` and opens a new pre-loaded chat. For long notes it passes a short
"read `.claude/seance.md`" pointer instead of inlining everything, so it never overflows the
URL handler — the file is always the source of truth. Outside an IDE it prints a ready-to-run
`claude "$(cat .claude/seance.md)"` instead.

### Size nudge (zero model-token cost)

A `UserPromptSubmit` hook watches the session transcript and, once it grows past a threshold,
shows you a one-line reminder to run `/seance`. The reminder uses the hook's `systemMessage`
channel — shown to **you only**, never injected into the model context, so it costs no tokens.
It fires on first crossing then once per further increment, never every turn, and never blocks
or slows a prompt.

Tune the threshold in the plugin config (`/plugin` → seance):

| Option     | Default | Meaning                                                        |
| ---------- | ------- | -------------------------------------------------------------- |
| `nudge_kb` | `400`   | Transcript size (KB) that triggers the nudge. `0` disables it. |

## The helpers

```bash
node scripts/seance-open.mjs --file .claude/seance.md            # what /seance runs
node scripts/seance-open.mjs --prompt "some text"               # open with inline text
node scripts/seance-open.mjs --file .claude/seance.md --dry-run # print, don't open
```

`seance-open.mjs` does IDE detection (from `~/.claude/ide/<port>.lock`), URL-encodes the note,
and opens the deep link. `seance-nudge.mjs` is the hook described above.

## Notes

- The new chat opens in whichever IDE window is registered as the URL handler, in your current
  workspace, so the file is right there to read.
- Requires Node on your PATH (used by the helpers).

## License

MIT — see [LICENSE](LICENSE).
