# Agent memory

Working notes kept by Claude Code for this project: decisions and their reasons,
conventions that are not obvious from the code, gotchas that cost time once, and
the state of work in flight.

`MEMORY.md` is the index and is loaded at the start of every session; each other
file holds one fact.

This directory is the canonical copy. Claude Code reads and writes it through a
symlink at:

    ~/.claude/projects/-Users-gitarth-Documents-code-armstrongco-lab-mail-mafia/memory

so edits made during a session show up here as ordinary working-tree changes and
are committed like anything else. Recreate the link with:

    ln -s "$PWD/docs/memory" \
      ~/.claude/projects/-Users-gitarth-Documents-code-armstrongco-lab-mail-mafia/memory
