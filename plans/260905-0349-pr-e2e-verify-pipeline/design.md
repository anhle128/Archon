# Design — PR E2E Verification Pipeline (feature-agnostic)

- **Ngày:** 2026-09-05
- **Trạng thái:** Design (chờ user review) → sau đó writing-plans
- **Nhánh:** dev
- **Ví dụ thử (guinea-pig):** PR #71 (`anhle128/Archon` — "Add workflow usage & cost tracking", đã merge). Chỉ là vật thử; workflow phải chạy với **mọi** PR.

---

## 1. Bối cảnh & mục tiêu

Hiện tại mỗi PR "ready", user phải tự đọc PR → tự nghĩ kịch bản manual test → tự click web UI verify → **user thành bottleneck**.

**Mục tiêu:** một quy trình **feature-agnostic** — mỗi PR ready → tự động kiểm tra các tính năng của PR hoạt động đúng (dựng web + DB, migrate, lái browser), thay thế việc test tay. Vehicle = một **Archon workflow**; công cụ = **Playwright + Playwright MCP**.

**Non-goals:** không thay thế unit test hiện có; không làm cổng CI cứng ngay (trigger thủ công trước); không tự viết third-party test (đó là việc của implement agent).

---

## 2. Nguyên tắc đã chốt (user-driven — không tự đảo ngược)

1. **Mode B — verify rồi kết tinh:** AI verify sống 1 lần → đẻ ra file Playwright `.spec.ts` commit vào repo (lưới an toàn regression, chạy lại miễn phí/tất định). KHÔNG "lái sống mỗi lần".
2. **Thủ công trước, workflow sau:** chứng minh từng mắt xích bằng tay trên PR #71 rồi mới mã hóa thành YAML.
3. **Hai lane test tách bạch:**
   - **Lane A — third-party contract/integration test** (gọi API thật, assert đúng _shape_). **Thuộc trách nhiệm implement agent, KHÔNG phải workflow này.** Chạy hiếm, cần key thật, ngoài đường chặn-merge.
   - **Lane B — E2E internal** (mock/seed, chạy mỗi PR, tất định, miễn phí).
   - **Anti-mock-drift:** mock chỉ đáng tin khi có Lane A neo lại; mock-hết = an toàn giả.
4. **Skill single-responsibility.**
5. **Bám khuôn `e2e/` của open-design** (`/Users/dale/Desktop/workspace/opensources/open-design/e2e/`) — không port skill `agent-browser` của họ (dính OpenDesign + là công cụ lái-sống, sai mục tiêu Mode B).

---

## 3. Kiến trúc tổng thể — 3 artifact

| #   | Artifact                           | Trách nhiệm                                                                                                    | Pha                  |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | **Skill `plan-e2e-test-pr`**       | Từ PR → xuất **danh sách test** + **danh sách e2e-requirement** (checklist)                                    | 1 (walking skeleton) |
| 2   | **Skill `verify-e2e-test-pr`**     | Đọc e2e-requirement → soi **source code** → tick cái đã có → `{allTicked, unticked[]}`. CHỈ gác cổng coverage. | 1                    |
| 3   | **Workflow YAML + package `e2e/`** | Vỏ quản trị (route_loop self-heal) + Lane B thực thi (boot/seed/browser/emit spec)                             | 2                    |

---

## 4. Luồng pipeline (route_loop self-heal)

```
plan-e2e-test-pr ──► verify-e2e-test-pr ──► e2e-coverage-gate (route_loop)
                          ▲                     │
                          │  one_success        ├─ positive  ──► lane-b-execute (Pha 2) / done (skeleton)
                          │                     ├─ negative  ──► supplement-tests ──┐
                          └─────────────────────┴─ exhausted ──► comment-on-pr      │
                                (verify chạy lại sau mỗi lần vá) ◄──────────────────┘
```

**Diễn giải:** `plan` sinh checklist → `verify` chấm coverage vs source → `route_loop`:

- **positive** (tất cả requirement tick) → thoát tiến tới Lane B thực thi.
- **negative** (còn thiếu) → `supplement-tests` viết test còn thiếu → `verify` chạy lại (vòng).
- **exhausted** (vá `max_iterations` lần vẫn thiếu) → `comment-on-pr` báo gap cho implement agent (đây là chỗ "comment vào PR").

### 4.1 YAML wiring đúng (theo contract route_loop đã verify)

```yaml
- id: plan-e2e-test-pr
  prompt: |
    /plan-e2e-test-pr $ARGUMENTS      # đọc PR diff → xuất 2 danh sách
  skills: [plan-e2e-test-pr]
  output_format:                       # để downstream đọc có cấu trúc
    type: object
    properties:
      tests: { type: array }
      e2e_requirements: { type: array }
    required: [tests, e2e_requirements]

- id: verify-e2e-test-pr
  depends_on: [plan-e2e-test-pr, supplement-tests]
  trigger_rule: one_success            # chạy lần đầu (từ plan) VÀ sau mỗi lần vá (từ supplement)
  skills: [verify-e2e-test-pr]
  prompt: |
    /verify-e2e-test-pr                 # đọc e2e_requirements → soi source → tick
  output_format:
    type: object
    properties:
      allTicked: { type: boolean }
      unticked:  { type: array }
    required: [allTicked, unticked]     # 'allTicked' BẮT BUỘC khai (condition đọc field này)

- id: e2e-coverage-gate
  depends_on: [verify-e2e-test-pr]
  route_loop:
    condition: "$verify-e2e-test-pr.output.allTicked == true"
    max_iterations: 3
    routes:
      positive:  lane-b-execute         # đường thoát — KHÔNG được trỏ ngược về verify
      negative:  supplement-tests       # đường DUY NHẤT được quay lại
      exhausted: comment-on-pr          # đường thoát

- id: supplement-tests                  # route target: không cần depends_on (bị gate tới khi route chọn)
  skills: [plan-e2e-test-pr]            # dùng 'tests' list để biết viết test gì
  prompt: |
    Viết các test còn thiếu cho: $verify-e2e-test-pr.output.unticked

- id: comment-on-pr
  command: <comment lên PR liệt kê unticked cho implement agent>

- id: lane-b-execute                    # Pha 2: boot/seed/browser verify/emit .spec.ts
  ...
```

**Ràng buộc bắt buộc (loader sẽ chặn nếu sai):**

- `verify` (nguồn điều kiện) **không được dùng `when:`** và **phải khai `output_format`** chứa `allTicked`.
- `e2e-coverage-gate` **không được** `when`/`trigger_rule`/`retry`.
- `positive` (`lane-b-execute`) và `exhausted` (`comment-on-pr`) **phải là đường thoát** — đi tiến từ chúng không được chạm lại `verify`.
- `supplement-tests` là thượng nguồn của `verify` (nhờ `verify.depends_on` chứa `supplement-tests`) — đây là điều khiến vòng lặp chạy được; chỉ `negative` được phép quay lại.
- `max_iterations: 3` = vá tối đa 3 lần, `exhausted` bắn ở lần false thứ 4.

_(Contract đầy đủ: memory `archon-route-loop-node`; nguồn `packages/workflows/src/schemas/route-loop.ts`, `route-loop-state.ts`, `loader.ts:783-859`.)_

---

## 5. Hợp đồng 2 skill

### 5.1 `plan-e2e-test-pr` (walking skeleton — thuần suy luận, build TRƯỚC)

- **Input:** PR (số / branch). Đọc `gh pr diff <n>`.
- **Output:**
  - `tests[]` — kịch bản test cụ thể (cả internal), làm đầu vào cho `supplement-tests`.
  - `e2e_requirements[]` — tập yêu cầu e2e **phải có**, mỗi cái tick/không-tick được; **đây là cái `verify` chấm**.
  - Phân biệt rõ **cái gì test internal (Lane B, mock/seed)** vs **cái gì là third-party phải mock + cần Lane A neo**.
- Chưa dựng app/browser → chứng minh nhanh bằng tay trên PR #71.

### 5.2 `verify-e2e-test-pr` (CHỈ gác cổng coverage — SRP)

- **Input:** `e2e_requirements[]` + source code của PR.
- **Việc:** với mỗi requirement, soi source (test files thực có) → tick nếu có test tương ứng (AI diễn giải, không regex).
- **Output:** `{ allTicked: boolean, unticked: [...] , ticked: [...] }`.
- **KHÔNG** boot / seed / browser / emit spec.

---

## 6. Lane A vs Lane B (chi tiết hermetic)

- **Lane A (implement agent lo):** 1 cú gọi AI provider thật, tí hon → assert `usage_ledger` mọc dòng đúng kiểu, cost > 0. Chứng minh integration thật + neo fixture cho Lane B. Cổng `verify`+route_loop chính là thứ đảm bảo Lane A tồn tại trước khi tin Lane B.
- **Lane B (workflow này):** seed dữ liệu usage GIẢ, cố định — 3 tầng:
  - (1) mock `/api/usage` ở browser — nông, mù server. _Tránh làm chính._
  - **(2) seed DB tạm** — full-stack thật (server tổng hợp + UI). **Default cho skeleton.**
  - (3) fake AI provider chạy cả đường ống — trung thực nhất (như `fake-agents.ts` của open-design). _Đích nâng cấp sau; cần scout "chỗ cắm" provider giả trong Archon._

---

## 7. Dựng Archon để test (từ scout codebase)

- **Boot 1 cổng, giống prod:** `ARCHON_HOME=/tmp/archon-e2e-<id> bun run build:web && PORT=<p> bun run start`.
- **DB sạch, cô lập:** `ARCHON_HOME` trỏ thư mục tạm → SQLite mới tinh tự tạo (`~/.archon/archon.db` dưới home tạm).
- **Readiness:** poll `GET /api/health` tới khi 200 (bypass auth gate). `until curl -sf ".../api/health"; do sleep 0.5; done`.
- **Seed qua REST API:** `POST /api/codebases`, `POST /api/workflows/{name}/run`, `GET /api/workflows/runs`, và cho PR #71: `GET /api/usage`.
- **Hạ tầng E2E hiện có:** KHÔNG có gì (không Playwright, không config, không `e2e/`) → tất cả là làm mới.

---

## 8. Package `e2e/` (bám open-design, mức KISS)

- Cấu trúc: `e2e/playwright.config.ts`, `e2e/ui/*.spec.ts` (test Playwright), `e2e/lib/` (fixture boot Archon + `timeouts.ts`), `e2e/package.json`.
- **Fixture boot** (tương tự `lib/playwright/suite.ts` của họ): worker-scoped, tạo `ARCHON_HOME` tạm + start server + poll `/api/health` + cấp `baseURL` động; teardown tắt + dọn, fail thì giữ log.
- **Config chép thẳng:** `trace:'on-first-retry'`, `screenshot:'only-on-failure'`, reporter `junit`+`json`+`html`, `retries: CI?1:0`, project `chromium`.
- **Quy ước:** `getByTestId`, thẻ `[P0]/[P1]/[P2]`, hằng timeout `T`, hermetic (không key AI thật ở Lane B).
- **KHÔNG bê:** visual-regression, lớp Vitest, sharding đa-lane, fake-agent CLI (thừa cho quy mô hiện tại).
- Chưng cất quy ước của họ thành `e2e/AGENTS.md` riêng cho Archon.

---

## 9. PR #71 — surfaces cần verify (ví dụ)

`GET /api/usage`; CLI `archon usage`; trang **Cost** trong console (`CostPage.tsx`, `UsageBreakdownTable.tsx`); usage theo node ở run-detail. Invariants: zero khác missing; estimate không đè USD thật; retry/loop không xóa usage đã ghi.

---

## 10. Phân pha triển khai

- **Pha 1 — Walking skeleton (làm trước):**
  1. Build + prove `plan-e2e-test-pr` bằng tay trên PR #71 (đọc diff → xuất 2 danh sách).
  2. Build + prove `verify-e2e-test-pr` (chấm coverage vs source).
  3. Dựng khung `route_loop` (plan → verify → gate → supplement → comment) chạy được end-to-end trên PR #71.
- **Pha 2 — Lane B thực thi + đóng gói workflow:** 4. Package `e2e/` + fixture boot Archon. 5. `lane-b-execute`: boot → seed(DB) → lái browser (Playwright MCP) verify PR #71 → emit `.spec.ts`. 6. Gộp thành workflow YAML hoàn chỉnh; trigger thủ công (`archon workflow run`), webhook tự động để sau.

---

## 11. Rủi ro / câu hỏi mở

- **Hermetic seeding tier cho Lane B skeleton:** default (2) seed DB; nâng (3) fake-provider — cần scout Archon có "chỗ cắm" provider giả không.
- **`plan-e2e-test-pr` chạy trước hay sau khi có source code PR?** (Với PR đã có code, plan + verify chạy trên cùng snapshot; với PR đang làm dở thì khác — cần chốt khi viết plan thực thi.)
- **Nơi đặt 2 skill:** `.claude/skills/` (dùng chung Claude Code + Archon node) — xác nhận cơ chế `skills:` của Archon nạp từ đâu.
- **`comment-on-pr`:** cần GitHub adapter/quyền; xác nhận đường comment (gh CLI vs adapter).
