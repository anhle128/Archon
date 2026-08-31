# archon-ralph-rust-dag + ak-implement-rust (Rust fork)

## Context

`ak-implement` → `archon-ralph-dag` nhét lệnh validate `bun run …` **inline** trong loop prompt →
sai trên repo Rust (validate vô nghĩa → có thể commit code hỏng). Chiến lược đã chọn: **hybrid fork
ngay**, đặt **bundled default trong repo Archon**
(`/Users/dale/Desktop/workspace/OceanLabs/workflow-engine/archon/.archon/workflows/defaults/`).
Tổng quát hoá stack-aware để sau (KHÔNG thuộc plan này).

Tạo 2 workflow bundled mới rồi regen bundle:

1. `archon-ralph-rust-dag.yaml` — fork `archon-ralph-dag.yaml`, đổi validate sang cargo **incremental**.
2. `ak-implement-rust.yaml` — fork `ak-implement.yaml`, gọi `archon-ralph-rust-dag`.

Người dùng chạy `ak-implement-rust <plan-dir>` từ **cwd = repo Rust đích** (vd
`agentic-os-plan/harness-service`), không phải repo Archon.

**KHÔNG đụng** 2 speckit-ralph-native workflow: chúng đã project-aware — validation uỷ quyền cho
`<repo>/.specify/extensions/ralph-loop/AGENTS.md` (qua command `archon-speckit-ralph-iteration`), phần
Rust duy nhất trong workflow là node `cargo clean` đã guard `if [ -f Cargo.toml ]`. Ngoài phạm vi.

## Nguyên tắc tốc độ cargo (cốt lõi — tránh rebuild chậm)

Loop chạy nhiều iteration; giữ cache incremental ấm:

- **KHÔNG BAO GIỜ `cargo clean`** trong loop hay trước PR. `target/` đã gitignore, không bao giờ bị
  commit (loop chỉ `git add` file đã sửa theo path); clean chỉ vứt cache → rebuild chậm iteration sau.
- **`cargo check`, KHÔNG `cargo build`** làm tín hiệu biên dịch (check nhanh hơn, không codegen; `cargo test`
  đã build crate cần chạy).
- **Scope `-p <crate>`**: mọi lệnh nhắm crate đang sửa (từ `technicalNotes`/đường dẫn file của story).
  Chỉ bỏ `-p` (cả workspace) khi thay đổi thực sự trải nhiều crate (vd sửa type dùng chung ở
  `gigo-harness-sqlite` bị crate khác consume).
- **Giữ cờ cargo ỔN ĐỊNH** giữa các iteration (cùng profile/feature); đổi qua lại `--release`/
  `--all-features`/`--all-targets` sẽ bust cache.
- **KHÔNG có bước install/`cargo fetch` riêng**: cargo tự fetch dep ở lần `cargo check` đầu.

## Bộ lệnh cargo chuẩn (thay cho các lệnh bun trong loop)

| Vai trò (JS gốc)                              | Lệnh Rust thay                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `bun run type-check` (check từng file)        | `cargo check -p <crate>`                                               |
| `bun run type-check && bun run lint` (static) | `cargo clippy -p <crate>`                                              |
| `bun run lint:fix`                            | (bỏ autofix) sửa warning thủ công → chạy lại `cargo clippy -p <crate>` |
| `bun run test`                                | `cargo test -p <crate>`                                                |
| `bun run format:check`                        | `cargo fmt --all -- --check`                                           |
| `bun run format`                              | `cargo fmt --all`                                                      |
| `bun run cli workflow event emit … \|\| true` | `archon workflow event emit … \|\| true`                               |

`<crate>` = package chứa file story sửa; nếu thay đổi trải nhiều crate thì bỏ `-p`. clippy để mặc định
repo (KHÔNG `-D warnings`) — khớp yêu cầu "focused clippy clean" của plan đích.

## Approach

### 1. Tạo `.archon/workflows/defaults/archon-ralph-rust-dag.yaml`

Sao chép nguyên `archon-ralph-dag.yaml` rồi sửa theo **anchor văn bản** (đọc lại file trước khi sửa;
không dùng số dòng — chúng trôi):

- **Trường `name:`** (dòng đầu): `archon-ralph-dag` → `archon-ralph-rust-dag`.
- **Khối `description:`**: đổi sang Rust; thêm trigger `"ralph rust"`, `"rust ralph dag"`; ghi
  "Validation dùng cargo incremental (check/clippy/test/fmt), không bun/npm. Chỉ nhận Ralph PRD đã sẵn
  sàng (prd.md+prd.json); input khác fail-fast — dùng ak-implement-rust cho plan."
- **Node `generate-prd`** (hiện `command: archon-ralph-generate`, `when: "$detect-input.output.input_type != 'ready'"`):
  thay CẢ node bằng một `bash:` fail-fast, GIỮ nguyên `depends_on` và `when`:
  ```
  - id: generate-prd
    depends_on: [detect-input]
    when: "$detect-input.output.input_type != 'ready'"
    bash: |
      echo "archon-ralph-rust-dag requires a READY Ralph PRD (prd.md + prd.json)." >&2
      echo "Its PRD generator emits bun/JS acceptance criteria, wrong for Rust." >&2
      echo "Use 'ak-implement-rust <plan-dir>' (builds a cargo-criteria PRD), or supply a ready PRD dir." >&2
      exit 1
  ```
  Lý do: command `archon-ralph-generate` hardcode `bun run type-check/lint/test/format:check`
  (`.archon/commands/defaults/archon-ralph-generate.md`, mục "Validation Requirements") → PRD sinh ra
  sẽ có tiêu chí bun sai cho Rust. Qua `ak-implement-rust`, PRD luôn "ready" nên `generate-prd` bị skip;
  node này chỉ chặn khi ai đó chạy trực tiếp với raw idea/external PRD.
- **Node `validate-prd`** (bash): XOÁ khối cài dep JS (chuỗi `if [ -f "bun.lock" ] … elif … pnpm … fi`).
  Không thay bằng gì (cargo tự fetch). Giữ nguyên phần git state + cat PRD + đếm story.
- **Node `implement` → `loop.prompt`** (đổi theo Bộ lệnh cargo chuẩn; tìm chuỗi gốc, thay tại chỗ):
  - Section `### 2.3 Verify Types After Each File`: đổi heading → `### 2.3 Verify Build After Each File`;
    thay `bun run type-check` → `cargo check -p <crate>`; "If types fail" → "If cargo check fails";
    "Re-run type-check" → "Re-run cargo check".
  - Section `### 3.1 Static Analysis`: thay `bun run type-check && bun run lint` → `cargo clippy -p <crate>`;
    khối "If lint fails: 1. Run `bun run lint:fix` …" → "If clippy warns: fix warnings manually, then
    re-run `cargo clippy -p <crate>`"; "Re-run lint" → "Re-run cargo clippy".
  - Section `### 3.2 Tests`: thay `bun run test` → `cargo test -p <crate>`.
  - Section `### 3.3 Format Check`: thay `bun run format:check` → `cargo fmt --all -- --check`;
    `bun run format` → `cargo fmt --all`.
  - `PHASE_3_CHECKPOINT` bullets ("Type-check passes / Lint passes / All tests pass / Format is clean")
    → "cargo check passes / cargo clippy clean / cargo test passes / cargo fmt clean".
  - Hai chỗ `bun run cli workflow event emit …` (Phase 1 started, Phase 5 completed) → `archon workflow
event emit …` (giữ `|| true`).
  - Edge "Validation fails repeatedly": "If type-check or tests fail 3+ times" → "If cargo check/clippy
    or tests fail 3+ times".
  - Edge "Dependency install fails" (nhắc `bun.lock`/`bun install`) → "cargo tự fetch dep ở `cargo check`
    đầu; nếu fetch lỗi, kiểm tra mạng/registry".
  - Success criteria `VALIDATED` line ("Type-check + lint + tests + format all pass") → "cargo check +
    clippy + tests + fmt all pass".
  - Thêm 1 dòng vào `## Phase 2: IMPLEMENT` (đầu section): "Speed: run all cargo checks scoped `-p <crate>`
    for the crate you edited; drop `-p` only when the change spans crates. NEVER `cargo clean`."
- **KHÔNG đổi**: `detect-input`, node PR (`verify-pr-base`), `report`, `until: COMPLETE`,
  `max_iterations: 15`, `fresh_context: true`, `model: large`, `idle_timeout`. Không thêm `cargo clean`.

### 2. Tạo `.archon/workflows/defaults/ak-implement-rust.yaml`

Sao chép nguyên `ak-implement.yaml` rồi sửa (anchor văn bản):

- **`name:`**: `ak-implement` → `ak-implement-rust`.
- **`description:`**: đổi sang Rust; thêm trigger `"ak implement rust"`, `"implement rust plan"`,
  `"ralph implement rust plan"`.
- **Node `build-ralph-prd` (`prompt`)**: chèn ngay trước câu "Report the ABSOLUTE path…" đoạn:

  ```
  ## Rust target — cargo, incremental, atomic

  This is a Rust/cargo workspace. EVERY build/lint/test acceptance criterion MUST use cargo —
  `cargo check`, `cargo clippy`, `cargo test`, `cargo fmt --all -- --check` — NEVER bun/npm, and NEVER
  `cargo clean`. Prefer crate-scoped `-p <crate>` for speed. Preserve any atomicity the plan declares
  (a phase pairing a migration with its adapter/producer change stays ONE story so the tree builds and
  existing suites pass after each). Do not split such phases.
  ```

  Giữ `provider: codex`, `effort`, `model`, `output_format`.

- **Node `ralph-implement`**: `workflow: archon-ralph-dag` → `workflow: archon-ralph-rust-dag`.
- **Node `verify-and-complete` (`prompt`)**: ở bước "Run the project's relevant typecheck / lint / tests
  for the touched area" thêm "(Rust: `cargo check`/`cargo clippy`/`cargo test`, scoped `-p <crate>`; format
  `cargo fmt --all -- --check`)"; và thêm một dòng ở cuối "Mandatory procedure": "Final global gate: run
  `cargo test` (whole workspace) ONCE and `cargo fmt --all -- --check` before writing the audit; record
  the result as evidence."
- **KHÔNG đổi**: `setup`, `resolve-plan`, `create-pr`, `verify-pr-base`, hooks, các output_format khác.

### 3. Regen bundle

Chạy trong repo Archon (phải stage trước — generator từ chối file untracked):

```
git add .archon/workflows/defaults/archon-ralph-rust-dag.yaml \
        .archon/workflows/defaults/ak-implement-rust.yaml
bun run generate:bundled
```

Ghi lại `packages/workflows/src/defaults/bundled-defaults.generated.ts`.

## Critical files & anchors

- `.archon/workflows/defaults/archon-ralph-dag.yaml` — nguồn copy (file 1). Điểm sửa: node `generate-prd`,
  `validate-prd` (bỏ install), `implement.loop.prompt` (validate cargo).
- `.archon/workflows/defaults/ak-implement.yaml` — nguồn copy (file 2). Điểm sửa: node `ralph-implement`
  (`workflow:`), `build-ralph-prd`, `verify-and-complete`.
- `.archon/commands/defaults/archon-ralph-generate.md` — mục "Validation Requirements" hardcode `bun run …`;
  KHÔNG sửa file này (dùng chung JS), chỉ là lý do rust-dag fail-fast ở `generate-prd`.
- `scripts/generate-bundled-defaults.ts` — `bun run generate:bundled` / `--check`.
- `packages/workflows/src/defaults/bundled-defaults.generated.ts` — sản phẩm generated, KHÔNG sửa tay.

## Verification

Trong repo Archon:

1. **Bundle khớp**: `bun run check:bundled` → exit 0.
2. **Load không lỗi**: `bun run cli workflow list` → có `archon-ralph-rust-dag` và `ak-implement-rust`,
   không entry lỗi cho 2 tên này.
3. **Cargo thay hết bun (scoped theo file nguồn, không grep toàn bundle)**:
   ```
   grep -c 'bun run type-check\|bun run lint\|bun run test\|bun run format' \
     .archon/workflows/defaults/archon-ralph-rust-dag.yaml    # = 0
   grep -c 'cargo check\|cargo clippy\|cargo test\|cargo fmt' \
     .archon/workflows/defaults/archon-ralph-rust-dag.yaml    # > 0
   grep -c 'cargo clean' .archon/workflows/defaults/archon-ralph-rust-dag.yaml   # = 0
   ```
4. **Link đúng**: `grep 'workflow: archon-ralph-rust-dag' .archon/workflows/defaults/ak-implement-rust.yaml` → khớp.
5. **Fail-fast đúng**: `grep -A6 'id: generate-prd' .archon/workflows/defaults/archon-ralph-rust-dag.yaml`
   cho thấy `bash:` `exit 1`, không còn `command: archon-ralph-generate`.

Không chạy full loop ở verify (tốn agent/tiền) — đó là lúc SỬ DỤNG deliverable.

## Assumptions & contingencies

- **`archon` có trên PATH khi loop chạy** (cho `archon workflow event emit … || true`). Nếu không →
  `|| true` no-op, không regress (bản gốc `bun run cli` cũng no-op trên repo Rust).
- **Toolchain Rust có `clippy` + `rustfmt`** (qua rustup): plan đích yêu cầu; nếu thiếu, agent báo blocker
  ở progress.txt (edge-case sẵn có của loop).
- **Agent xác định đúng `<crate>`** từ file story sửa. Nếu không chắc: bỏ `-p` chạy cả workspace (chậm hơn
  nhưng đúng) — đã ghi rõ trong prompt.
- **`max_iterations: 15`** đủ cho plan datetime (9 story). Giữ 15.
