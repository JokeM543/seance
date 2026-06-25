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

### Note written by a cheaper model (spares your Opus budget)

By default `/seance` does **not** make your main (Opus) session write the note. Instead it
runs `seance-summarize.mjs`, which reads the session transcript from disk, trims it to a small
digest (a 1.4 MB transcript → ~17k tokens — mostly by dropping tool output and thinking), and
asks a separate `claude -p --model <summarizer>` to write the note. Two payoffs:

- **Spares your Opus usage** — the heavy read is done by Sonnet/Haiku, not Opus. Useful when
  you're near a usage limit.
- **Works when the chat is maxed out** — because it reads the transcript from disk, it can hand
  off even when the main session is too full to take a turn ("Prompt is too long"). See the
  standalone command under [The helpers](#the-helpers).

If the summarizer call fails (or you set `summarizer = self`), `/seance` falls back to composing
the note in the current session — the original behavior.

> Honest note: this is about **sparing the Opus budget**, not a huge absolute saving — the
> in-session note was already cheap thanks to prompt caching. Picking `opus` as the summarizer
> costs *more* than in-session (cold, uncached), so only use it if you want max note quality.

### Size nudge (zero model-token cost)

A `UserPromptSubmit` hook watches the session transcript and, once it grows past a threshold,
shows you a one-line reminder to run `/seance`. The reminder uses the hook's `systemMessage`
channel — shown to **you only**, never injected into the model context, so it costs no tokens.
It fires on first crossing then once per further increment, never every turn, and never blocks
or slows a prompt.

Tune **how long you let a session grow before the nudge** in the plugin config
(`/plugin` → seance):

| Option       | Default  | Values                                                                                |
| ------------ | -------- | ------------------------------------------------------------------------------------- |
| `nudge`      | `medium` | `light` (~150 KB, early) · `medium` (~350 KB) · `long` (~700 KB, late) · `off` — or a raw KB number |
| `summarizer` | `sonnet` | `sonnet` · `haiku` (cheapest) · `opus` (best note, costs more) · `self` (compose in-session) |

## The helpers

```bash
# Generate the note with a cheaper model and open a fresh chat (what /seance runs):
node scripts/seance-summarize.mjs --open
node scripts/seance-summarize.mjs --dry-run          # build+measure the digest, no model call
node scripts/seance-summarize.mjs --model haiku --print

# Just open a chat from an existing note:
node scripts/seance-open.mjs --file .claude/seance.md
node scripts/seance-open.mjs --file .claude/seance.md --dry-run   # print URL, don't open
```

- `seance-summarize.mjs` — locates the newest transcript in `~/.claude/projects/<cwd>/`, trims
  it, and pipes it to `claude -p --model <summarizer>` to write the note. **This is also your
  escape hatch when the chat is maxed out:** run it from a plain terminal and it hands off
  without needing the stuck session.
- `seance-open.mjs` — IDE detection (from `~/.claude/ide/<port>.lock`), URL-encodes the note,
  opens the deep link.
- `seance-nudge.mjs` — the size-nudge hook described above.

## Notes

- The new chat opens in whichever IDE window is registered as the URL handler, in your current
  workspace, so the file is right there to read.
- Requires Node on your PATH (used by the helpers).

## License

MIT — see [LICENSE](LICENSE).
