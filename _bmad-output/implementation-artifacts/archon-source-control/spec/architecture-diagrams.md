# Architecture diagrams

Diagrams for the Source Control tab. Prose lives in SPEC.md / other companions; the kernel references this file by name.

## Tab layout (CAP-1)

```mermaid
flowchart TB
  subgraph Run[Workflow-run screen]
    tabs["Graph | Logs | Chat | Source Control"]
    subgraph SC[Source Control tab]
      direction TB
      changes["Changes (uncommitted)\nM / A / D list"]
      history["Commit history\nclick a commit -> its M / A / D list"]
      viewer["Shared viewer\nM = 2-pane diff (red/green)\nA = 1-pane new content\nD = 1-pane removed content\n[Reload]"]
      changes --> viewer
      history --> viewer
    end
    tabs --> SC
  end
```

## Read request resolution (CAP-5, security)

```mermaid
flowchart TD
  ui["UI: sends runId + file/commit ref\n(never a path)"] --> api["New read-only git API"]
  api --> lookup["GET run -> working_path + codebase_id"]
  lookup --> ctr{"container-backend run?"}
  ctr -- yes --> gone["CAP-6: container / no worktree / not a git checkout"]
  ctr -- no --> rp["realpath(working_path)\nreject '..'"]
  rp --> chk{"working_path exists\n& is a git checkout?"}
  chk -- no --> gone
  chk -- yes --> git["execFileAsync / @archon/git\ngit -C working_path status | log | show | diff"]
  git --> out["status / hunks / content -> viewer"]
```

## Truth model — live worktree vs durable snapshot (CAP-4, CAP-8)

```mermaid
flowchart LR
  subgraph live[Live source of truth]
    wt["run worktree\ngit -C working_path\n(run branch, not base 'dev')"]
  end
  subgraph durable[Durable after cleanup]
    snap["git-snapshot artifact\nunder output_root\n(run-end capture; per-commit post-v1)"]
  end
  cleanup["cleanup: PR/convo close,\nmerged 6h / stale 14d,\nmanual, codebase delete\n-> git branch -D + rm checkout"]
  wt -- checkpoint capture --> snap
  wt -- reaped by --> cleanup
  cleanup -. worktree gone .-> snap
  read["Source Control read"] --> wt
  read -. fallback when reaped .-> snap
```

## Diff direction (CAP-3)

```mermaid
flowchart LR
  now["Now (uncommitted)"] --> nowd["HEAD -> worktree"]
  commit["Selected commit"] --> cd["parent -> commit"]
  nowd --> color["left/red = before\nright/green = after"]
  cd --> color
```
