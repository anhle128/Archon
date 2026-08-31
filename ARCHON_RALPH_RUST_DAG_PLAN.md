# Ralph loop on Rust repos — project-aware validation (NO fork)

## Quyết định (đã đổi hướng)

Bản kế hoạch cũ định **fork** `archon-ralph-dag` → `archon-ralph-rust-dag` và hardcode lệnh cargo
xuyên suốt loop. **Đã bỏ.** Lý do (kiểm chứng trong repo):

- **Hệ thống ĐÃ validate project-aware bằng delegation.** Loop native
  (`speckit-ralph-native-feature.yaml:618`) chạy `loop.command: archon-speckit-ralph-iteration`, uỷ
  quyền validate cho `<repo>/.specify/extensions/ralph-loop/AGENTS.md`. Quy tắc của repo
  (`agentic-os-plan/harness-service/.specify/extensions/ralph-loop/AGENTS.md:50`): _"Run quality checks
  (typecheck, lint, test — whatever the project requires)."_ → KHÔNG hardcode bun; agent đọc repo và
  chạy cargo.
- **Fork chỉ đổi một hardcode (bun) lấy một hardcode khác (cargo)** trong bản copy 789 dòng — đúng thứ
  phức tạp cần tránh.
- **Xung đột policy publish.** `speckit-ralph-native-feature.yaml:815-827` chạy `cargo clean` trước PR
  cho repo Rust (policy do PROJECT sở hữu). Fork lại hardcode "NEVER cargo clean" cho tốc độ loop → một
  fork "Rust-global" của Archon sẽ ĐÈ policy của project. Validation/publish policy phải do project giữ.
- **Redundant.** Loop đã có bước `### 3.4 Verify Acceptance Criteria`, và acceptance criteria của PRD
  (do `ak-implement` → `build-ralph-prd` sinh từ plan) đã mang lệnh validate thật (cargo, với plan Rust).
  Các dòng `bun run …` hardcode chỉ là gate generic thừa.

**Hướng đã chọn: làm loop validate project-aware, KHÔNG fork.** `ak-implement` + loop project-aware chạy
đúng cho Rust và JS bằng MỘT workflow.

## Đã làm

### 1. `archon-ralph-dag.yaml` — loop validate project-aware (shared)

- Thêm khối **"Toolchain detection (do this once)"** ở đầu `## Phase 2: IMPLEMENT`: dò toolchain từ
  CLAUDE.md/AGENTS.md + manifest (`Cargo.toml`→cargo, `package.json`→bun/npm, `go.mod`→go,
  `pyproject.toml`→python), ưu tiên lệnh nêu trong `acceptanceCriteria`/`technicalNotes`, và **theo
  policy build/publish của project (vd clean-before-PR) — KHÔNG override**.
- `### 2.3` "Verify Types After Each File" → "Verify Build After Each File": chạy build/type check của
  project (theo Toolchain detection), thay `bun run type-check`.
- `### 3.1` Static Analysis: chạy lint+typecheck của project, thay `bun run type-check && bun run lint`
  và khối `bun run lint:fix`.
- `### 3.2` Tests: chạy test suite của project, thay `bun run test`.
- `### 3.3` Format Check: chạy format check + formatter của project, thay `bun run format:check` /
  `bun run format`.
- `PHASE_2_CHECKPOINT` / `PHASE_3_CHECKPOINT` bullets + success-criteria `VALIDATED` + các edge
  ("Validation fails", "Dependency setup fails") → dùng ngôn ngữ project-aware, bỏ nhắc bun cụ thể.
- Hai event-emit `bun run cli workflow event emit … || true` → `archon workflow event emit … || true`
  (chạy khi có `archon` trên PATH, no-op nếu không; `bun run cli` cũ chỉ chạy trong repo Archon).
- `validate-prd` giữ nguyên: khối cài dep JS đã có guard theo lockfile (`bun.lock`/`package-lock`/…),
  no-op trên repo Rust — không cần đổi.

### 2. Bug `resolve-plan` trong `ak-implement.yaml` (Codex F3) — đã sửa + test

- Nguồn cũ `ls -dt plans/*/ | head -1` RỒI mới test `plan.md` → một dir mới hơn không có `plan.md` che
  mất plan hợp lệ cũ hơn. Sửa: `while IFS= read -r … done < <(ls -dt plans/*/ …)` chọn dir đầu tiên chứa
  `plan.md` (spaces-safe), fail chỉ khi duyệt hết.
- Regression test trong `packages/workflows/src/defaults/bundled-defaults.test.ts` (3 test: chọn qua dir
  mới-hơn-không-plan, exit 1 khi không có, tên dir có dấu cách) chạy bash SHIP thật qua `Bun.YAML.parse`.

### 3. Đã bỏ (fork bị loại)

- XOÁ `archon-ralph-rust-dag.yaml` và `ak-implement-rust.yaml` (chưa từng vào bundle vì untracked).
- Các sửa F1 (nhánh loại trừ generate/validate) và F2 (final-cargo-gate, child-no-PR) là fork-specific →
  moot với hướng project-aware. Nếu muốn siết `ak-implement` (PR gate, mutually-exclusive detect) cho MỌI
  stack thì làm riêng trên workflow shared, ngoài phạm vi lần đổi hướng này.

## `ak-implement` chạy Rust thế nào (không cần gì thêm)

`ak-implement <plan-dir>` (từ cwd = repo Rust): `build-ralph-prd` đọc plan → PRD với acceptance criteria
cargo → `ralph-implement` (`archon-ralph-dag`) loop project-aware tự dò `Cargo.toml` và chạy
cargo check/clippy/test/fmt → `verify-and-complete` audit → PR. Policy clean-before-PR (nếu có) do project
giữ, loop không đè.

## Verification (repo Archon)

1. `bun run check:bundled` → up to date (67 commands, 37 workflows).
2. `bun run cli workflow list` → `errorCount:0`; có `archon-ralph-dag`; KHÔNG có `*-rust-dag` /
   `ak-implement-rust`.
3. `grep -n 'bun run' .archon/workflows/defaults/archon-ralph-dag.yaml` → chỉ còn 1 dòng: ví dụ JS trong
   khối Toolchain detection (không phải hardcode).
4. `bun test packages/workflows/src/defaults/bundled-defaults.test.ts` → pass (gồm 3 test resolve-plan).

## Assumptions

- Agent trong loop tự dò đúng toolchain từ manifest/CLAUDE.md/AGENTS.md. Repo Rust có `Cargo.toml` ở root
  hoặc crate → cargo. Nếu mơ hồ, ưu tiên lệnh trong `acceptanceCriteria` của story (do plan cấp).
- `archon` trên PATH cho event-emit (nếu không, `|| true` no-op — không regress).
- Toolchain Rust có `clippy`+`rustfmt`; nếu thiếu, agent báo blocker ở progress.txt (edge-case sẵn có).
