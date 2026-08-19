---
name: github-ssh-setup
description: "mail-mafia lives at withewolf-dev/mail-mafia on GitHub, pushed via the github-ozer SSH alias; gh CLI is not installed"
metadata: 
  node_type: memory
  type: project
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T12:52:33.570Z
---

[[mail-mafia-project]] is on GitHub at `withewolf-dev/mail-mafia`, remote `origin = git@github-ozer:withewolf-dev/mail-mafia.git`.

`~/.ssh/config` has three GitHub identities: `github.com` and `github-personal` → `id_ed25519_personal` (authenticates as `stn91-git`), `github-ozer` → `id_ed25519_ozer`. The user chose the **ozer** key for this repo — use the `github-ozer` host alias for any remote work here, not plain `github.com`.

**How to apply:** `gh` CLI is not installed (and the user declined having me install it), so GitHub operations here go through git over SSH only.
