# Viewer & diff rules

Fixed behavior for the file list and the shared viewer. Cited by CAP-3 and CAP-7.

## Two regions, one list widget, one viewer

- The tab holds two regions, VS Code SCM style: **Changes** (uncommitted) on top, **commit history** below.
- Both regions feed the **same** list widget and the **same** viewer. Selecting a file in either region opens it in that one viewer; only the read scope differs.
- Three file states in any list: `M` (modified), `A` (added), `D` (deleted). Untracked-new files use the `A` mechanism. Other git statuses project onto these: rename → `D` (old path) + `A` (new path); copy → `A`; type-change → `M`; unmerged → `M`.

## Viewer mode, keyed by status

| Status         | Viewer                            | Coloring                    |
| -------------- | --------------------------------- | --------------------------- |
| `M` (modified) | Two-pane diff                     | red = before, green = after |
| `A` (added)    | Single pane, full file content    | none                        |
| `D` (deleted)  | Single pane, removed-file content | none                        |

`M` is **diff-only** in v1 — there is no standalone "snapshot" mode for a modified file.

## Diff direction (which two trees are compared)

| Scope                          | Compared          |
| ------------------------------ | ----------------- |
| Now (uncommitted Changes)      | `HEAD → worktree` |
| Selected commit (from history) | `parent → commit` |

"Before" is always the left/red side; "after" is the right/green side.

## Refresh

- Refresh is a **manual Reload** control. No auto-refresh, no polling.
- If content changed on the host since load, surface a "changed — Reload" affordance rather than mutating the open view underneath the reader.

## Every file must open (large + binary)

- **Large text:** stream in chunks with "Load more" — first paint ~256 KB / ~2,000 lines; for `M`, send diff hunks + 3 lines of context rather than the whole file.
- **Skeleton first:** list and sizes render immediately from metadata; the viewer paints a skeleton while bytes arrive, with a **Cancel** affordance. Files > ~1 MB stream with Cancel; files > ~50 MB offer download only.
- **Binary:** detected by a NUL byte in the first 8 KB (git heuristic); never dumped as text. Images (png/jpg/gif/webp/svg) render inline; other binaries offer download + a hex peek of the first ~4 KB.
- Nothing is blocked: every file either opens or presents a usable fallback. All numeric thresholds here are defaults, tunable at build.
