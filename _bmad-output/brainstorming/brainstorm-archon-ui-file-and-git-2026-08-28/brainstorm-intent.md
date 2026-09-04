# Brainstorm Intent — Archon UI: tab Source Control trên màn hình workflow-run

## Vấn đề + JTBD

Người dùng chạy workflow trên node remote, máy laptop KHÔNG có bản clone của repo. Họ cần
kiểm tra worktree remote của chính lần chạy đó ngay trên màn hình workflow-run mà không cần
clone cục bộ.

JTBD cốt lõi: **"Lần chạy này có động vào đúng những file mình nghĩ không?"** — xem trạng thái
file đã đổi, xem file nào commit trước đã đưa vào, và xem nội dung thay đổi. Đây là một
**radar worktree remote sống**, không phải một cây file IDE chung chung, cũng không phải nhúng
VS Code.

Chính ràng buộc "không có repo cục bộ" mới là **lý do tồn tại** của tính năng (không phải hạn
chế) và là điểm tách nó khỏi việc nhúng một IDE.

## Phạm vi đã chốt (MoSCoW — verbatim)

**MUST (v1):** Source Control tab; Changes(M/A)+commit history read from run worktree via
`git -C working_path`; click file opens viewer (M=diff red/green, A=single-pane content);
manual Reload; server resolves path from runId reject `..` read-only `execFileAsync`;
worktree-gone/null empty state; large+binary files must open.

**SHOULD:** server-generated git-snapshot artifact at run-end checkpoint under `output_root`
for durable post-cleanup history and fast reads.

**COULD:** Logs<->Source Control link; Graph node changed-files badge/filter; reuse diff viewer
as HITL review; event provenance overlay; default history to this run own commit with full
history fallback; collapse empty Changes region on auto-commit runs.

**WON'T (this time):** standalone Snapshot mode for M; full Explorer tree of unchanged files;
edit/commit from UI; auto-refresh/polling; authoritative change-view reconstructed from events.

## Mô hình sự thật (truth model)

- **Live (nguồn sự thật):** git đọc trực tiếp từ worktree của lần chạy — `git -C working_path`
  (log/show/diff/status). Worktree chia sẻ object store; `default_cwd` nằm trên baseBranch `dev`
  và KHÔNG hiển thị branch của run trừ khi đã merge → phải đọc từ worktree, không đọc từ base.
- **Durable (bền sau cleanup):** một **git-snapshot artifact do server sinh** tại checkpoint
  (run end / mỗi commit) đặt dưới `output_root`. Đây là sự thật lịch sử bền vững sau khi
  worktree bị dọn.
- **Events = chỉ là provenance:** event stream KHÔNG authoritative cho danh sách thay đổi
  (shell/sed/scripts/subprocess/rename/delete sửa file mà không phát ra path event có cấu trúc).
  Chỉ dùng như lớp gợi ý (node/log nào có thể liên quan file nào), không bao giờ là change list.

## Bằng chứng ràng buộc việc build (từ code + runtime thật)

- **Pin đường dẫn:** mỗi run bind đúng MỘT `codebase_id` + MỘT `working_path` (nullable). Cả
  hai đã được persist và **expose tại `GET /api/workflows/runs/{runId}`**. Pin file reads vào
  `run.working_path` + `codebase_id` (authoritative), KHÔNG đoán repo root. Folder/`--no-worktree`
  project có `working_path` null → phải xử lý null. Submodules init `--recursive` vào worktree.
- **Realpath bắt buộc:** cùng một cây xuất hiện dưới hai root (`/Users/agent/.archon/...` và
  `/Volumes/WD_BLACK/archon/...`) — path bị symlink/relocatable; UI/server phải `realpath` và
  chịu được cả hai; `working_path` cũ (stale) làm hỏng file reads.
- **Lifecycle worktree:** worktree KHÔNG bị xóa khi run vào terminal status (run `completed` vẫn
  còn file). Nó bị dọn bởi: conversation/PR close, scheduler (merged 6h, stale 14d), manual,
  codebase delete, orphan. `destroy` xóa checkout + `git branch -D`; env status `active|destroyed`.
  → File có thể biến mất giữa lúc xem: kiểm tra env `active|destroyed` + worktree tồn tại trước
  khi read, hiển thị trạng thái "worktree gone", không crash.
- **Hệ quả GC:** sau `branch -D` + xóa checkout, commit của run có thể unreachable (GC) trừ khi
  đã merge/pushed → cần capture-before-teardown (chính là git-snapshot artifact ở SHOULD).
- **Chưa có route git/file:** SOURCE-confirmed các raw route chỉ gồm `/api/stream/__dashboard__`,
  `/api/stream/:conversationId`, `/api/artifacts/:runId/*`, webhooks — KHÔNG có route
  git/worktree/diff/source. `@archon/git` chỉ có boolean `hasUncommittedChanges`
  (`git status --porcelain`). Tính năng là mới hoàn toàn.
- **Model để tái dùng:** route artifacts `GET /api/artifacts/:runId/*` + `resolveRunArtifactDir`
  resolve path phía server và reject `..` (api.ts:5071-5078) — dùng đúng khuôn này cho API git
  read-only mới.
- **Bảo mật:** API git-read mới phải resolve worktree path phía server từ `runId`, **không bao
  giờ nhận `working_path` từ UI** (chống path-traversal); tái dùng pattern reject `..`. Dùng
  `execFileAsync`/`@archon/git` với args do server kiểm soát, KHÔNG shell-string.
- **Chưa verify:** sự tồn tại thư mục worktree trên mac mini chưa được `stat` (không có fs
  endpoint, không dùng SSH); `working_path` trong DB chỉ là bản ghi → UI phải xử lý thư mục
  thiếu tại thời điểm read.
- Tham chiếu code: `WorkflowExecution.tsx:344` đã đọc `workingPath`;
  `packages/isolation/providers/worktree.ts`; `workflows/schemas/workflow-run.ts:168-180`;
  `cleanup-service.ts`; `isolation/types.ts:28`.

## Hướng diff (diff direction)

- **Now (uncommitted Changes):** `HEAD -> worktree`.
- **Selected commit (từ history):** `parent -> commit`.
- **Viewer keyed by status:** `M` = diff hai pane (red-before / green-after); `A` (Added / untracked)
  = single-pane hiển thị nội dung file mới, không màu. Cùng một list widget + cùng viewer cho cả
  hai vùng (Changes ở trên, commit history ở dưới, kiểu VS Code SCM). Chỉ hai trạng thái M và A.

## Bước kỹ thuật kế tiếp (gợi ý)

1. Thêm API git read-only mới theo khuôn artifacts: resolve `working_path` server-side từ `runId`
   - `realpath`, reject `..`, `execFileAsync` args do server kiểm soát. Endpoints tối thiểu:
     status (Now M/A), log (history), show/diff (M: `parent..commit` và `HEAD..worktree`; A: nội dung).
2. Xử lý null `working_path` + env `active|destroyed` + thư mục thiếu → trả trạng thái
   "worktree gone/không có worktree" thay vì lỗi.
3. Chiến lược mở file lớn + binary: M gửi diff hunks + context; A/large text stream theo chunk
   ("Load more"); metadata-first skeleton + Cancel; binary render ảnh hoặc offer download/hex-peek.
   Không block, mọi file đều mở được.
4. UI: tab thứ tư **Source Control** cạnh Graph / Logs / Chat; vùng Changes trên + commit history
   dưới; click file ở vùng nào cũng mở cùng viewer; nút **Reload** thủ công (không polling).
5. (SHOULD) Sinh git-snapshot artifact tại checkpoint (run end / mỗi commit) dưới `output_root`
   để có lịch sử bền sau cleanup và đọc nhanh; live worktree là fallback khi còn tồn tại.

## Ưu tiên v1 (top-3)

1. **Pin:** resolve `working_path` server-side từ `runId` + realpath — nối "1 run = 1 worktree"
   với rule bảo mật no-UI-path; sai chỗ này thì mọi view sai hoặc mất an toàn.
2. **Minimal read surface:** git-from-worktree + diff-only + viewer M/A + manual Reload — bề mặt
   tối thiểu vẫn trả lời trọn JTBD.
3. **Graceful vanishing:** empty state worktree-gone/null để tin cậy được trên run remote sống.

Git-snapshot artifact (SHOULD) là nâng cấp biến "gone" thành "vẫn còn", giải quyết đồng thời
slow + vanished + durable-history, nhưng KHÔNG phải là hạng mục v1-critical.
