# Token 测试用例逐项验收

本文逐条说明追溯工作簿中已分配 TC-001 至 TC-094 的目标、实际绑定和证据边界。TC-001–076 已注册；TC-077–091 三批产品打磨和 TC-092–094 本地/遥测误排除修复目前仅有计划，尚未注册或执行。TC-076 的 0.3.5 合成旧版自动升级成功链路已通过，但不等于真实历史旧版一键升级。TC-050 至 TC-071 已有 M6 自动入口和逐编号结果，TC-072 仅有人工作业清单，尚无目标 Mac 通过证据；TC-073 是独立 Codex 回归，TC-074 是设备与用户归属授权回归。已注册用例的命令均从仓库根目录执行，先用 `npm ci` 安装锁定依赖。用例注册以 `scripts/test-cases.mjs` 为准，执行入口为 `scripts/run-test-case.mjs`。工作簿 H/I 列保留对应版本的验收状态和证据，不代表后续版本已经复验。

2026-10-03 曾规划 `TC-073`，关联既有 `REQ-006` 与新增 `DEV-047`；`aa6d91b` 已注册并执行。下方先保留开发前验收设计，再记录实际绑定与结果。

## 执行与证据边界

- 已分配 94 条，其中注册 76 条、待注册 18 条（TC-077–094）。TC-001–049 中 44 条有自动入口、5 条为人工入口；M6 的 TC-050–071 另有 22 条自动入口、TC-072 为人工入口；TC-073 现绑定原归并测试及 0.3.4 大会话性能回归两项；TC-074 绑定三项服务/客户端凭据测试和一项客户端同步测试；TC-076 已绑定实际打包应用隔离自动升级成功链路。多条旧编号可能运行同一测试函数；M6 每个自动编号绑定自己以 `TC-###` 开头的测试函数。TC-021、TC-030、TC-038 各有额外绑定；TC-021 现同时运行共享测试、独立分页单元和分页界面测试。
- 自动入口在缺少 `TOKEN_E2E_EXECUTABLE` 时会先构建应用；Vitest 以 `-t`、Playwright 以 `--grep` 精确选择注册的测试名称。任一绑定函数失败，`npm run test:case -- TC-###` 非零退出。
- 单元和端到端造数由 `tests/support/test-workspace.ts` 在系统临时目录 `token-test-db-<label>-*` 创建：`token.sqlite`、`codex/`、`claude/` 均在其中。端到端将该目录作为 `--token-user-data`；测试结束清理。不要使用真实用户数据库或真实会话正文。
- 自动入口不会自动保存证据文件。可先执行 `mkdir -p test-results/acceptance`，再将单用例输出重定向到 `test-results/acceptance/TC-###.log`，紧接着记录退出码、提交、macOS 和测试日期。`test-results/` 已被 Git 忽略；日志只保留脱敏断言与环境信息。

例如记录 TC-020 的自动运行输出和退出码：

```bash
mkdir -p test-results/acceptance
npm run test:case -- TC-020 > test-results/acceptance/TC-020.log 2>&1
echo $?
```

- 人工入口只打印操作清单并以退出码 2 结束，不代表通过。先在 `test-results/manual/evidence/` 写入脱敏证据文件，再执行 `npm run test:case -- TC-### pass "$PWD/test-results/manual/evidence/TC-###.md"`；失败时把 `pass` 改为 `fail`。运行器会写入 `test-results/manual/TC-###.json`；缺文件或证据路径不是绝对路径时退出码 2，`fail` 的退出码为 1。
- TC-029 已绑定 CSV 列结构单元断言；旧版关于“禁止通过”的说明仅对应修复前提交。历史 A1–A10 或代码中的断言不能代替当前版本、当前环境的逐项结果。

## 本次命令核对

2026-10-02，以 `origin/main` 的 `6fd695e` 代码为基线：`npm run test:cases:check` 核对了 29 个入口；`TC-003`、`TC-020` 的 Vitest 命令和 `TC-002` 的 Playwright 命令均以退出码 0 结束；对 `TC-029` 尝试登记 `pass` 得到预期的退出码 2。本次只抽跑这些命令，其余用例的本轮结果仍需各自执行并留证。

## 逐项验收

### TC-001 本机来源字段抽样

- **历史状态**：已验证（人工）；docs/feasibility.md；2026-10-02。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-001`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：当前 Mac 上可读取的 Codex 与 Claude Code 本地会话；记录工具版本、入口和样本时间段。只读检查，不复制正文到仓库。
- **验收断言或人工操作**：列出两家工具的用量字段、模型、时间、请求标识、文件覆盖数与未知项；明确可观察范围，不把缺失当零。
- **脱敏证据**：脱敏字段映射与计数、工具版本、日期；历史证据为 docs/feasibility.md，当前验收须另存新证据。
- **失败或未验证条件**：任一工具没有可核对样本或字段口径未定时保持待验证；无证据时人工入口退出码 2。
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-001 pass "$PWD/test-results/manual/evidence/TC-001.md"`，失败执行 `npm run test:case -- TC-001 fail "$PWD/test-results/manual/evidence/TC-001.md"`。

### TC-002 首次创建与重启登录

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A1。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-002`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-004、TC-005、TC-010、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：tests/e2e/app.spec.ts 使用 token-test-db-app-* 下的 token.sqlite 与人工构造 JSONL，作为 --token-user-data 启动 Electron。
- **验收断言或人工操作**：首次显示管理员创建；创建后登录进入概览；关闭重启后 owner 再登录，既有 26 Token 保留。
- **脱敏证据**：保存命令、退出码和 Playwright 脱敏日志；记录提交及 macOS 环境。
- **失败或未验证条件**：任一界面断言、重启登录或用量持久化失败时 Playwright 非零退出。

### TC-003 重复初始化和登录限速

- **历史状态**：已验证（自动）；tests/auth.test.ts；docs/validation.md A1。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-003`。
- **实际绑定**：`tests/auth.test.ts` 中 `test('首次管理员、重启后的登录和失败尝试限速')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/auth.test.ts 在 token-test-db-auth-* 建立独立 token.sqlite。
- **验收断言或人工操作**：第二次 setupAdmin 被拒绝；重新打开数据库可登录；连续五次错误密码后正确密码仍被限速拒绝。
- **脱敏证据**：保存该 Vitest 测试的命令、退出码和脱敏日志。
- **失败或未验证条件**：重复初始化未拒绝、重开不能登录或限速断言失败即非零退出。

### TC-004 用户创建与权限隔离

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A2。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-004`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-002、TC-005、TC-010、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002 共用 tests/e2e/app.spec.ts 的 token-test-db-app-* 和完整端到端函数。
- **验收断言或人工操作**：管理员创建 viewer，绑定 Codex 来源；viewer 登录后只见 12 Token 和 gpt-test，管理入口隐藏。
- **脱敏证据**：保存共享 Playwright 函数的命令与退出码；说明本编号没有独立测试函数。
- **失败或未验证条件**：用户创建、归属筛选或管理入口断言失败即非零退出。

### TC-005 管理 IPC 拒绝越权

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A2。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-005`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-002、TC-004、TC-010、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002/004 共用 tests/e2e/app.spec.ts；以 viewer 登录临时 Electron 应用。
- **验收断言或人工操作**：listUsers、getTelemetryConfiguration、backupDatabase 三项预加载 API 均返回 rejected。
- **脱敏证据**：保存共享 Playwright 函数的命令与退出码；标注三项 IPC 结果。
- **失败或未验证条件**：任一管理 IPC 对 viewer 成功或测试非零退出即失败。

### TC-006 Codex 真实样本逐条核对

- **历史状态**：已验证（人工）；docs/validation.md A3；样本已删除。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-006`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：当前 Codex 版本的两段可读取、多模型真实会话只读样本；人工按来源字段独立核算脱敏用量。仓库目前没有专用自动核算脚本。
- **验收断言或人工操作**：逐条对齐 UTC 时间、实际/未知模型、输入、输出、缓存子集及来源总量；摘要数量和值一致。
- **脱敏证据**：版本、样本数、脱敏摘要和差异为零的核对记录；2026-10-02 的 A3 样本已删除，不能复用作本轮证据。
- **失败或未验证条件**：样本缺失、任一字段不一致或无法证明模型归属时待验证或 fail；无证据时入口退出码 2。
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-006 pass "$PWD/test-results/manual/evidence/TC-006.md"`，失败执行 `npm run test:case -- TC-006 fail "$PWD/test-results/manual/evidence/TC-006.md"`。

### TC-007 Codex 模型切换

- **历史状态**：已验证（自动）；tests/collector.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-007`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('模型切换与 Claude 子代理记录按实际模型归档')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/collector.test.ts 在 token-test-db-model-switch-* 写入两轮 Codex 与 Claude 子代理的人工 JSONL。
- **验收断言或人工操作**：Codex gpt-a=12、gpt-b=8；Claude claude-a=10、claude-b=14，均为各自事实。
- **脱敏证据**：保存该 Vitest 函数的命令、退出码与四行脱敏结果。
- **失败或未验证条件**：任一模型或总量映射错误即非零退出。

### TC-008 Claude 真实样本逐条核对

- **历史状态**：已验证（人工）；docs/validation.md A4；样本已删除。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-008`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；仅有历史证据。
- **前置与造数**：当前 Claude Code 版本的两段多模型及子代理真实会话只读样本；记录版本和请求标识。
- **验收断言或人工操作**：逐条核对时间、模型、输入、输出、缓存读写与总量；同请求记录不重复计数。
- **脱敏证据**：脱敏逐条摘要和差异为零的核对记录；历史 A4 样本已删除，当前验收须新取样。
- **失败或未验证条件**：没有当前样本、请求归并不明或任一字段不一致时不得通过。
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-008 pass "$PWD/test-results/manual/evidence/TC-008.md"`，失败执行 `npm run test:case -- TC-008 fail "$PWD/test-results/manual/evidence/TC-008.md"`。

### TC-009 Claude 请求重复归并

- **历史状态**：已验证（自动）；tests/collector.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-009`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-010、TC-012、TC-013 共用至少一个测试函数。
- **前置与造数**：与 TC-010/012/013 共用 tests/collector.test.ts 首个函数，token-test-db-collector-* 中写入重复 Claude 消息。
- **验收断言或人工操作**：同请求 output=3/4/4 归并为一条 30 Token 事实；新 output=6 覆盖后为 32，不新增事实。
- **脱敏证据**：保存共享 Vitest 函数的命令、退出码和 1 条 Claude 事实结果。
- **失败或未验证条件**：同请求被累计为多条或未采用更新值时非零退出。

### TC-010 重复扫描和重启幂等

- **历史状态**：已验证（自动）；tests/collector.test.ts；tests/e2e/app.spec.ts；A5。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-010`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`；`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-009、TC-012、TC-013、TC-002、TC-004、TC-005、TC-019、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：先跑 collector 单元函数，再跑共享的 app 端到端函数；两者各自使用 token-test-db-* 临时目录。
- **验收断言或人工操作**：重扫后事实总数仍为 2；应用重启再次扫描后页面总量仍为 26。
- **脱敏证据**：保留同一 TC 命令的两段测试日志及退出码；说明两个绑定函数均通过。
- **失败或未验证条件**：任一绑定测试非零、事实增加或重启总量改变时整条命令非零。

### TC-011 末行、截断与轮转

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/validation.md A5。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-011`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('未写完的末行等待补齐，截断重写后不重复统计')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/collector.test.ts 在 token-test-db-rotation-* 写入未完成 JSONL、截断重写与新路径文件。
- **验收断言或人工操作**：事实数按 1→1→2→3→4 变化，未完行不入库，旧响应不重复。
- **脱敏证据**：保存该 Vitest 函数命令、退出码和事实数序列。
- **失败或未验证条件**：任一步计数不符即非零退出。

### TC-012 Codex 缓存子集不重加

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/feasibility.md。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-012`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-009、TC-010、TC-013 共用至少一个测试函数。
- **前置与造数**：与 TC-009/010/013 共用 collector 首个函数；Codex 人工事实为输入 10、缓存子集 4、输出 2。
- **验收断言或人工操作**：Codex total_tokens=12、cache_read_tokens=4；不把缓存再加成 16。
- **脱敏证据**：保存共享 Vitest 函数命令和关键字段断言；无专属函数。
- **失败或未验证条件**：总量不是 12 或缓存子集不是 4 时非零退出。

### TC-013 Claude 四类 Token 合计

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/feasibility.md。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-013`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('两个采集器按请求去重，重扫和增量扫描不重复计数')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-009、TC-010、TC-012 共用至少一个测试函数。
- **前置与造数**：与 TC-009/010/012 共用 collector 首个函数；Claude 人工事实含输入 1、输出 4、缓存读 20、缓存写 5。
- **验收断言或人工操作**：Claude total_tokens=30，缓存读=20、缓存写=5；后续 output=6 时总量=32。
- **脱敏证据**：保存共享 Vitest 函数命令和分类/总量断言；无专属函数。
- **失败或未验证条件**：任一分类或总量不符时非零退出。

### TC-014 遥测密钥和监听范围

- **历史状态**：已验证（自动）；tests/telemetry.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-014`。
- **实际绑定**：`tests/telemetry.test.ts` 中 `test('本机遥测只接受密钥，Codex 去重，Claude 累计点计算增量，报表避免双来源相加')`。
- **自动化覆盖**：共享测试；非独立断言；回环地址未单独断言；与 TC-016 共用至少一个测试函数。
- **前置与造数**：与 TC-016 共用 tests/telemetry.test.ts 首个函数；token-test-db-otel-* 内启动随机端口接收器。
- **验收断言或人工操作**：错误 Bearer 返回 401；正确密钥的 /v1/logs 返回 200；配置含可用端点。
- **脱敏证据**：保存共享 Vitest 函数日志与 HTTP 状态；现有测试未单独断言绑定地址为 127.0.0.1。
- **失败或未验证条件**：密钥拒绝或有效请求断言失败即非零；回环监听尚需独立断言才算完整覆盖。

### TC-015 现有配置只读检查

- **历史状态**：已验证（自动）；tests/telemetry.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-015`。
- **实际绑定**：`tests/telemetry.test.ts` 中 `test('遥测配置提示现有用户设置而不修改文件')`。
- **自动化覆盖**：单函数绑定；按源码断言；原配置未字节比对。
- **前置与造数**：tests/telemetry.test.ts 在 token-test-db-settings-* 写入临时 config.toml 与 settings.json。
- **验收断言或人工操作**：inspectConfig 对两种已有配置返回“已发现”，缺失文件返回 null。
- **脱敏证据**：保存该 Vitest 函数日志；当前测试未逐字节断言原配置内容未变化。
- **失败或未验证条件**：冲突提示或缺失文件断言失败即非零；只读不改写仍需更直接的断言。

### TC-016 遥测幂等和重叠优先级

- **历史状态**：已验证（自动）；tests/telemetry.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-016`。
- **实际绑定**：`tests/telemetry.test.ts` 中 `test('本机遥测只接受密钥，Codex 去重，Claude 累计点计算增量，报表避免双来源相加')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-014 共用至少一个测试函数。
- **前置与造数**：与 TC-014 共用 telemetry 首个函数；构造 Codex 重复日志、Claude cumulative 和 delta 批次。
- **验收断言或人工操作**：重复 Codex 后合计 12；Claude 累计 5→8 得 8，重复点不增加；加入本地 Codex 后报表仍 20，delta=7 后为 27。
- **脱敏证据**：保存共享 Vitest 函数命令、退出码和 12/8/20/27 断言。
- **失败或未验证条件**：任一重复、增量或重叠报表断言失败时非零退出。

### TC-017 缺失和不可读来源状态

- **历史状态**：已验证（自动）；tests/collector.test.ts；tests/e2e/source-status.spec.ts；A6。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-017`。
- **实际绑定**：`tests/e2e/source-status.spec.ts` 中 `test('工具目录缺失、无权限和空目录有清晰状态')`；`tests/collector.test.ts` 中 `test('空目录、错误字段及不可读文件显示可辨认的状态')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-018 共用至少一个测试函数。
- **前置与造数**：运行 source-status 端到端及 collector 错误单元函数；各自在 token-test-db-status-* / errors-* 造数。
- **验收断言或人工操作**：缺失 Codex 显示“未找到”，不可读 Claude 显示“需要检查/文件读取失败”；建立空目录后显示“暂无记录”。
- **脱敏证据**：保存同一 TC 命令的 Playwright 与 Vitest 日志和退出码；错误单元函数也被 TC-018 共用。
- **失败或未验证条件**：任一状态文本或错误原因不符、任一绑定测试非零即失败。

### TC-018 无效 Token 字段持续报错

- **历史状态**：已验证（自动）；tests/collector.test.ts；docs/validation.md A6。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-018`。
- **实际绑定**：`tests/collector.test.ts` 中 `test('空目录、错误字段及不可读文件显示可辨认的状态')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-017 共用至少一个测试函数。
- **前置与造数**：与 TC-017 共用 collector 错误函数，token-test-db-errors-* 中写入 input_tokens="unknown"。
- **验收断言或人工操作**：扫描后 Codex status=error、factCount=0、detail 含“无法解析”；再次扫描后错误仍显示。
- **脱敏证据**：保存共享 Vitest 函数命令、退出码和错误状态字段。
- **失败或未验证条件**：错误变成正常零用量或后续扫描丢失状态时非零退出。

### TC-019 绑定后权限和报表更新

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A7。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-019`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-002、TC-004、TC-005、TC-010、TC-021、TC-022、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002/004/005 等共用 app 端到端函数，token-test-db-app-* 含 Codex 12 和 Claude 14。
- **验收断言或人工操作**：绑定 Codex 给 viewer 后普通用户见 12 Token、gpt-test，Claude 与其模型不可见。
- **脱敏证据**：保存共享 Playwright 函数命令、退出码和 12/14 权限对比。
- **失败或未验证条件**：绑定未生效或普通用户见未授权来源时非零退出。

### TC-020 时区和 ISO 跨年周

- **历史状态**：已验证（自动）；tests/report.test.ts；docs/validation.md A8。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-020`。
- **实际绑定**：`tests/report.test.ts` 中 `test('报表按本地时区与 ISO 周汇总，并限制普通用户归属')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-021、TC-023 共用至少一个测试函数。
- **前置与造数**：与 TC-021/023 共用 tests/report.test.ts；token-test-db-report-* 直接写入两条合计 26 的事实。
- **验收断言或人工操作**：Asia/Shanghai 的 2021-01-01 对应 ISO 2020-W53；日/月/年分别为 2021-01-01、2021-01、2021，总量 26。
- **脱敏证据**：保存共享 Vitest 函数命令、退出码和周期值。
- **失败或未验证条件**：任一时区或周期边界、合计断言失败时非零退出。

### TC-021 筛选与分页明细

- **历史状态**：已验证（自动）；原证据为 `tests/report.test.ts`、`tests/e2e/app.spec.ts` 和 A8，只覆盖共享断言；`f7fcdee` 前未构造超过 50 条记录，第二页未测试。
- **执行命令**：`npm run test:case -- TC-021`。
- **实际绑定**：保留 `tests/report.test.ts` 的 `test('报表按本地时区与 ISO 周汇总，并限制普通用户归属')` 和 `tests/e2e/app.spec.ts` 的 `test('管理员创建、用户管理与普通用户权限')`；新增 `tests/report-pagination.test.ts` 的 `test('TC-021 明细翻页不漏记录且筛选和用户权限贯穿每页')`、`tests/e2e/report-pagination.spec.ts` 的 `test('TC-021 报表明细可翻到第二页且切换模型重置页码')`。
- **自动化覆盖**：`f7fcdee` 的独立分页单元和 Electron 测试覆盖第二页；旧两项仍为共享测试，与 TC-020、TC-023、TC-002、TC-004、TC-005、TC-010、TC-019、TC-022、TC-026 共用至少一个函数。
- **前置与造数**：四个绑定各用隔离临时目录。新增单元测试直接在临时 `token.sqlite` 写 123 条人工事实，其中普通用户拥有 61 条；新增界面测试写 61 条无正文 Codex JSONL，以 `turn_context` 标注两种模型，再用 `--token-user-data` 启动 Electron。
- **验收断言或人工操作**：历史共享断言保留；新增单元断言管理员三页 50/50/23、ID 无重复、明细总量与报表一致，普通用户两页 50/11 且仅见授权 Codex/项目，用户筛选不可越权，提供方/模型/项目筛选在第二页仍有效；新增界面断言 50/11 两页和切换第二种模型后回首页、显示 10 条。
- **脱敏证据**：开发会话报告 `f7fcdee` 的单编号与门禁通过；文档会话在同提交独立复跑 `npm run test:case -- TC-021`，两单元、两 Electron 函数均通过，退出码 0。门禁报告为 73 个编号入口、42 个单元、18 个 Electron；详见[验收记录](validation.md)。
- **后续清理补证**：`961c96c` 仅补测试启动失败时的临时目录清理；开发会话报告该提交上类型检查与 TC-021 单编号通过。上条完整门禁只属于 `f7fcdee`，不作为 `961c96c` 门禁复跑证据。
- **最终脚本补证**：`8234dcc` 又保证样本写入或数据库关闭失败时清理目录；开发会话报告该提交上类型检查、TC-021 单编号和完整门禁均通过（73 入口/42 单元/18 Electron），文档会话独立复跑单编号四个绑定退出码 0。产品行为和断言未变。
- **失败或未验证条件**：任一绑定失败则单编号命令非零。当前样本和临时库不能替代真实生产数据、打包安装或 TC-047 的跨用户服务授权；TC-028/TC-072 目标环境仍待验。

### TC-022 CSV 与页面结果一致

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A9。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-022`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；CSV 列结构未测试；与 TC-002、TC-004、TC-005、TC-010、TC-019、TC-021、TC-026 共用至少一个测试函数。
- **前置与造数**：与 TC-002 等共用 app 端到端函数；导出到 token-test-db-app-*/usage.csv。
- **验收断言或人工操作**：CSV 含 gpt-test、claude-test 与 12、14 Token 两行，页面汇总为 26。
- **脱敏证据**：保存共享 Playwright 日志和脱敏 CSV 数值；当前测试没有检查表头 8/9 列错位，见 TC-029。
- **失败或未验证条件**：数值或模型不符时自动非零；表头结构缺陷不能据此判通过。

### TC-023 CSV 公式注入转义

- **历史状态**：已验证（自动）；tests/report.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-023`。
- **实际绑定**：`tests/report.test.ts` 中 `test('报表按本地时区与 ISO 周汇总，并限制普通用户归属')`。
- **自动化覆盖**：共享测试；非独立断言；与 TC-020、TC-021 共用至少一个测试函数。
- **前置与造数**：与 TC-020/021 共用 report 单元函数；临时库中模型名设置为 =2+2。
- **验收断言或人工操作**：CSV 出现带前置单引号的模型文本，不出现原样可执行公式文本。
- **脱敏证据**：保存共享 Vitest 函数日志及脱敏 CSV 字段断言。
- **失败或未验证条件**：公式样文本未转义时非零退出。

### TC-024 备份完整性

- **历史状态**：已验证（自动）；tests/backup.test.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-024`。
- **实际绑定**：`tests/backup.test.ts` 中 `test('数据库备份完整性校验并保留账户与用量')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/backup.test.ts 在 token-test-db-backup-* 建库，写入管理员和 6 Token 事实，生成 backup.sqlite。
- **验收断言或人工操作**：备份通过完整性检查，打开后事实 total_tokens=6；破损 broken.sqlite 被拒绝。
- **脱敏证据**：保存该 Vitest 函数命令、退出码和备份校验断言；不保留数据库文件。
- **失败或未验证条件**：完整备份不可读、事实丢失或破损文件未被拒绝时非零退出。

### TC-025 恢复前副本和状态回退

- **历史状态**：已验证（自动）；tests/e2e/restore.spec.ts。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-025`。
- **实际绑定**：`tests/e2e/restore.spec.ts` 中 `test('管理员备份、恢复后账户回到备份状态')`。
- **自动化覆盖**：单函数绑定；按源码断言。
- **前置与造数**：tests/e2e/restore.spec.ts 在 token-test-db-restore-* 启动 Electron，备份到 snapshot.sqlite。
- **验收断言或人工操作**：备份后新建 temporary；恢复触发关闭并留下 token.sqlite.before-restore；重启后 temporary 消失，owner 可登录。
- **脱敏证据**：保存 Playwright 日志和脱敏账户状态；不提交 snapshot.sqlite 或数据库副本。
- **失败或未验证条件**：副本缺失、恢复未回退账户或重启登录失败时非零退出。

### TC-026 跨进程权限和数据边界

- **历史状态**：已验证（自动）；tests/e2e/app.spec.ts；docs/validation.md A2。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-026`。
- **实际绑定**：`tests/e2e/app.spec.ts` 中 `test('管理员创建、用户管理与普通用户权限')`。
- **自动化覆盖**：共享测试；非独立断言；磁盘隐私未测试；与 TC-002、TC-004、TC-005、TC-010、TC-019、TC-021、TC-022 共用至少一个测试函数。
- **前置与造数**：与 TC-002 等共用 app 端到端函数；人工 JSONL 仅含用量和模型，无正文。
- **验收断言或人工操作**：viewer 的用户管理、遥测配置、备份 IPC 调用全部 rejected。
- **脱敏证据**：保存共享 Playwright 日志；现有测试未断言磁盘/导出中不存在正文或密钥。
- **失败或未验证条件**：任一越权 IPC 成功时非零；隐私存储边界需另设断言才算完整覆盖。

### TC-027 未签名 DMG 本机验收

- **状态**：0.3.0 历史本机人工通过；0.3.4 当前 Mac 隔离安装子范围另登记人工 `pass`。各版本只按自己的命令与证据判定。
- **执行命令**：`npm run test:case -- TC-027`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；0.3.0 以复制版主流程 Playwright 1/1 和独立界面核对辅助验收。0.3.4 以隔离升级脚本辅助人工验收，范围见下方对应版本结果。
- **前置与造数**：本次构建的未签名 DMG、当前 Mac 图形会话与独立用户数据目录；确认包版本和架构。
- **验收断言或人工操作**：先执行 hdiutil verify，再挂载 DMG 并复制 Token.app；从复制的应用启动、登录、扫描并核对脱敏用量。
- **脱敏证据**：DMG 校验输出、包哈希/版本、当前 Mac 信息、复制后应用的脱敏流程记录；历史 A10 不能替代本轮。
- **失败或未验证条件**：DMG 不完整、复制后无法启动或主流程失败时 fail；未安装/未操作保持待验证。
- **人工操作命令**：下列命令构建、校验并复制本机 DMG；Playwright 只对复制出的应用运行现有主流程，仍需人工核对安装与界面。子 shell 在结束或失败时清理临时目录；若挂载在中断时残留，先手工执行 `hdiutil detach "$TOKEN_TC_MOUNT"` 再清理。
```bash
(
set -e
npm run pack:dmg
TOKEN_TC_DMG="Token-$(node -p 'require("./package.json").version').dmg"
hdiutil verify "$TOKEN_TC_DMG"
TOKEN_TC_MOUNT=$(mktemp -d /tmp/token-tc027-mount.XXXXXX)
TOKEN_TC_COPY=$(mktemp -d /tmp/token-tc027-copy.XXXXXX)
TOKEN_TC_ATTACHED=0
trap 'if [ "$TOKEN_TC_ATTACHED" = 1 ]; then hdiutil detach "$TOKEN_TC_MOUNT" || true; fi; rm -R "$TOKEN_TC_COPY"; rmdir "$TOKEN_TC_MOUNT"' EXIT
hdiutil attach "$TOKEN_TC_DMG" -nobrowse -mountpoint "$TOKEN_TC_MOUNT"
TOKEN_TC_ATTACHED=1
ditto "$TOKEN_TC_MOUNT/Token.app" "$TOKEN_TC_COPY/Token.app"
hdiutil detach "$TOKEN_TC_MOUNT"
TOKEN_TC_ATTACHED=0
TOKEN_E2E_EXECUTABLE="$TOKEN_TC_COPY/Token.app/Contents/MacOS/Token" ./node_modules/.bin/playwright test tests/e2e/app.spec.ts
)
```
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-027 pass "$PWD/test-results/manual/evidence/TC-027.md"`，失败执行 `npm run test:case -- TC-027 fail "$PWD/test-results/manual/evidence/TC-027.md"`。
- **0.3.0 本次结果（2026-10-02）**：本机人工登记 `pass`，记录为 `test-results/manual/TC-027.json`，操作证据为 `test-results/manual/evidence/TC-027.md`，界面截图为同目录 `TC-027-report.png`；代码 `6223c30`，macOS 15.7.4 x86_64。`Token-0.3.0.dmg` SHA-256 为 `64917685d073d0c631ef492df58eb3a3bec96657f15372177af466c68a34fec8`，`hdiutil verify` VALID，挂载、`ditto` 复制、卸载成功；复制版主流程 1/1 通过，第二次独立复制及合成数据界面核对通过。完整脱敏摘要见[本次验收记录](validation.md#tc-027-v030-本机未签名-dmg-人工验收2026-10-02)。本机证据文件被 Git 忽略；历史 A10 保留。Finder 拖拽安装、真实更新替换、签名公证和另一台 Mac 未验证。

- **0.3.4 当前结果（2026-10-03）**：代码 `7abd640`、文档基线 `8b64552`；macOS 15.7.4 x86_64。本机 `Token-0.3.4.dmg` 的 SHA-256 为 `7b4d8ad523c5afe71f5004fc7d7b4e690144e1f1119af2ab7bb86635888bf588`，`hdiutil verify` 为 VALID。开发会话重跑 `npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.3.3.dmg /Users/lz/文档/Token/Token-0.3.4.dmg`，退出码 0；脚本以一次性数据库、人工 Codex JSONL、DMG 挂载和 `ditto` 复制检查打包 App 启动、受信登录、扫描及 1280 Token 报表，取消安装后旧版与替换后新版均通过。文档会话在 `7abd640` 曾独立复跑同一升级命令并核对 DMG；当前人工登记 `test-results/manual/TC-027.json` 为 `pass`，时间 2026-10-02T20:46:08.228Z，指向本机 Git 忽略的 `evidence/TC-027-0.3.4.md`，脱敏日志为同目录 `TC-027-0.3.4-upgrade.log`。旧 0.3.0 登记已备份为 `evidence/TC-027-0.3.0-result.json`。这只证明 0.3.4 在当前 Mac 的隔离挂载、复制和主流程子范围；Finder 拖拽到 `/Applications`、真实生产账户/库、异机、签名公证、TC-072 文件权限仍待验，见[0.3.4 验收补记](validation.md)。

### TC-028 签名公证及目标 Mac 验收

- **历史状态**：待验证；尚无签名、公证及其他目标设备证据。本轮结果以本次命令和证据为准。
- **执行命令**：`npm run test:case -- TC-028`。
- **实际绑定**：无自动测试函数；`scripts/test-cases.mjs` 仅给出人工清单。
- **自动化覆盖**：人工入口；待验证。
- **前置与造数**：Apple 开发者证书、签名和公证构建环境，以及另一台目标 Mac；当前仓库没有这项通过证据。
- **验收断言或人工操作**：验证签名、公证票据和 Gatekeeper；在目标 Mac 安装、启动、登录并采集。
- **脱敏证据**：证书身份脱敏信息、签名验证、公证状态、目标 Mac 版本/架构和脱敏流程记录。
- **失败或未验证条件**：缺证书或目标设备时待验证；签名、公证或目标设备主流程失败时 fail。
- **发布环境核验命令**：在具备证书、公证凭据和目标 Mac 的环境运行 `npm run pack:signed`；只从该次 `release/signed/<候选目录>/release-evidence.json` 取得同一候选的 App/DMG 路径，分别设为 `SIGNED_APP`、`SIGNED_DMG` 后核验。x64 App 位于候选目录的 `mac/`，arm64 位于 `mac-arm64/`。下列命令只核验制品，不能代替 Apple 公证提交或另一台 Mac 的人工验收。
```bash
codesign --verify --deep --strict --verbose=2 "$SIGNED_APP"
spctl --assess --type execute --verbose "$SIGNED_APP"
xcrun stapler validate "$SIGNED_APP"
hdiutil verify "$SIGNED_DMG"
shasum -a 256 "$SIGNED_DMG"
```
- **人工结果登记**：先建立证据文件；通过执行 `npm run test:case -- TC-028 pass "$PWD/test-results/manual/evidence/TC-028.md"`，失败执行 `npm run test:case -- TC-028 fail "$PWD/test-results/manual/evidence/TC-028.md"`。
- **本轮边界**：DEV-018 在 `dc37b8b` 已有 `npm run pack:signed`；TC-075 只检验脚本预检与命令构造子范围。预检通过、模拟自动测试通过或本机 DMG 结构检查都不等于真实 Apple 签名、公证、票据或目标 Mac 验收。缺少有效身份、公证凭据或另一台目标 Mac 时，本用例继续待验证。

### TC-029 CSV 表头与数据列对齐

- **历史状态**：修复前版本表头 8 列、数据行 9 列；该历史缺陷不代表当前实现。本轮结果以固定提交的命令和证据为准。
- **执行命令**：`npm run test:case -- TC-029`。
- **实际绑定**：`tests/next-report.test.ts` 中 `test('TC-029 CSV 表头和数据列对齐')`，由 Vitest 按名称运行。
- **自动化覆盖**：人工构造一行用量，检查 CSV 表头及数据行为 9 列，`总 Token` 列名与数值 `12` 对齐，末列记录数为 `1`。测试以逗号拆分固定造数，不覆盖所有引号、换行与公式转义组合；CSV 公式注入另见 TC-023。
- **前置与造数**：`tests/support/test-workspace.ts` 创建独立临时库，插入 12 Token 的 `gpt-test` 记录。
- **脱敏证据**：保存该编号命令、退出码、测试日志、代码提交和环境；无需人工 `pass` 登记。
- **失败或未验证条件**：列数、列名或列值不符时 Vitest 非零退出；未运行固定提交时不把“有测试代码”当作已验证。
- **本轮结果**：提交 `96e99be` 的 `npm run test:acceptance -- 29 49` 中该编号退出码 0；本机日志在被 Git 忽略的 `test-results/acceptance/TC-029.log`。

## M5 用例绑定与覆盖（TC-030–TC-049）

`TC-030` 至 `TC-049` 已在 `scripts/test-cases.mjs` 注册。执行单条用例用 `npm run test:case -- TC-###`；除标明额外端到端绑定的编号外，入口运行下表对应的一个 Vitest 或 Playwright 函数。下表描述**当前断言实际覆盖**，与上面的验收目标仍有差距的地方写在“限制”列。证据须含固定代码提交、日期、环境、命令、退出码与脱敏结果。未执行或缺目标环境时，不因入口存在而写成通过。

本轮固定提交 `96e99be` 执行 `npm run test:acceptance -- 29 49`，`summary.json` 记录 TC-029–049 **21/21 退出码 0**；逐编号日志位于本机 `test-results/acceptance/`（Git 忽略）。这证明下表列出的自动断言通过，未覆盖的人工和环境边界仍保持待验证。

| 用例 | 关联 | 前置与操作 | 通过标准与证据重点 |
| --- | --- | --- | --- |
| TC-030 信任设备恢复登录 | REQ-019 / DEV-020 | 临时账户登录时勾选信任，关闭并重启；对照未勾选登录 | 仅勾选者恢复同一用户；存储无明文密码；保存重启日志和安全存储检查 |
| TC-031 撤销与账户失效 | REQ-020 / DEV-021 | 受信后分别手动退出、停用账户、重置密码再重启；注入损坏凭证 | 无固定过期时间且未退出时可持续登录；上述三种撤销后立即失效并回登录页；保存凭证状态与权限检查 |
| TC-032 服务地址配置与连接 | REQ-021 / DEV-022 | 独立启停服务；验证默认监听/连接地址，显式配置其他监听与 App 连接地址，并测试错误地址；补证时用临时 CA 与含本机测试地址 SAN 的证书建立严格 TLS 连接 | 默认双方使用 `127.0.0.1`；配置地址匹配且测试 CA 受信时 HTTPS 健康检查成功，不受信 CA 或主机名不匹配时连接失败；停服后本机报表仍可用；保存配置、监听和脱敏连接结果，不要求仅回环可连 |
| TC-033 清单与包 | REQ-021 / DEV-022 | 发布人工测试包，请求清单与下载，尝试路径穿越 | 版本、架构、大小、SHA-256 与包一致；任意路径不可读；保存清单和哈希 |
| TC-034 版本与摘要 | REQ-022 / DEV-024 | 模拟新/同/旧版本、架构不匹配、错误大小/SHA-256 | 只提示匹配的新版本；坏包绝不交给安装辅助进程；保存提示与下载校验日志 |
| TC-035 服务/下载故障 | REQ-022 / DEV-024 | 模拟停服、超时、中断、磁盘空间不足后重试 | 错误阶段可见且可重试；无损坏临时包，旧版与本机报表仍可用；保存错误和恢复记录 |
| TC-036 自动安装控制与回退 | REQ-023 / DEV-025 | 注入辅助进程、退出、安装、重启与健康检查成功/失败；测试取消和不可写目标路径 | 成功时旧进程退出、新版替换并启动；失败恢复旧版，取消无损，权限不足明确提示，临时包/挂载清理；保存状态与文件证据 |
| TC-037 三种扫描触发 | REQ-024 / DEV-026 | 假时钟验证启动、10 分钟、手动扫描；注入并发与扫描失败 | 每次完整扫描后恰好一次上传；无并发重复，失败不发完整零快照；保存时间线和请求数 |
| TC-038 聚合隐私 | REQ-025 / DEV-027 | 含正文、路径、密钥样式字符串的合成样本，截获上传体及服务日志 | 只有白名单字段；Token 分类和总量同本机聚合；保存脱敏字段比较 |
| TC-039 幂等和修订 | REQ-026 / DEV-028 | 重发同键快照、发送修订快照并重启客户端 | 服务 upsert 后重复不累加，修订替换旧值；保存键、修订和汇总比较 |
| TC-040 离线补传 | REQ-026 / DEV-028 | 停服完成扫描、观察待传队列，恢复服务 | 有限退避补传；积压、最近失败/成功可见；保存重试时间线和最终汇总 |
| TC-041 单位和原值 | REQ-027 / DEV-029 | 测 1023、1024、1024²、1024³ 边界、未知及大整数 | 只按 K→M→P 逐级 1024 进位，`1024M=1P`，不出现 G/T；精确原值在明细/CSV 保留；保存边界断言 |
| TC-042 概览比较 | REQ-028 / DEV-030 | 两个等长区间的人造记录切换用户、工具、日期 | 总 Token、请求数同明细；基期缺失显示未知；保存页面/查询对账 |
| TC-043 趋势下钻 | REQ-028 / DEV-031 | 按日/周/月切换筛选并点击趋势点 | 趋势与明细求和一致，沿用用户、来源、时区；保存点击前后筛选与值 |
| TC-044 模型排行 | REQ-029 / DEV-031 | 多模型、同值和未知模型样本下切换筛选并点击排行 | 按 Token 降序，同值稳定，明细一致；保存排行与明细对账 |
| TC-045 零和未知 | REQ-029 / DEV-032 | 分别模拟扫描成功无记录、未检测、权限失败 | 只前者显示零；后两者分别显示未覆盖/错误；保存状态和最后成功时间 |
| TC-046 来源状态 | REQ-029 / DEV-032 | 模拟正常、等待、权限不足、格式不支持 | 概览显示状态、覆盖时间和可操作诊断；保存卡片和来源状态对账 |
| TC-047 接口鉴权 | REQ-021 / DEV-023 | 在默认及非回环配置下，以缺失/错误/正确凭证请求清单、包和上报接口，并尝试跨用户覆盖；补证时复用指定测试 CA 且严格校验证书与主机名的 HTTPS 客户端 | 未授权请求不返回受保护制品或写库，合法凭证仅能访问授权范围；非回环连接在严格 TLS 校验下仍执行清单、包、管理及上报鉴权；保存响应和数据库计数 |
| TC-048 趋势图窗口缩放 | REQ-030 / DEV-033 | Electron 在窄/宽多个窗口尺寸下显示长日期、大 Token 数值并连续缩放 | 图随容器重排，柱顶数值和横轴日期的边界框不相交、不被裁切；保存截图和布局断言 |
| TC-049 周月日期标签 | REQ-030 / DEV-033 | 构造 ISO 跨年周和跨月样本，切换周/月并点击柱 | 周显示该 ISO 周周一 `YYYY-MM-DD`，月显示 `YYYY-MM`；悬浮和下钻区间一致；保存标签与桶起点断言 |

### 实际绑定与剩余验证

下表文件中以 `TC-###` 开头的 `test(...)` 函数就是该编号的实际绑定。每条命令可单独运行；TC-030、TC-038 的命令会先运行单元测试，再运行额外的 Electron 测试。表内 TC-034–036 记录现有代码的历史断言，尚未证明上表 2026-10-03 新目标；`44a96e8` 新增的本机隔离更新链路结果见表后补充记录。`TC-028` 的签名、公证和另一台 Mac 验收依旧独立待办。

| 编号 | 实际绑定文件 | 当前断言与限制 |
| --- | --- | --- |
| TC-030 | `tests/next-auth.test.ts`；`tests/e2e/trust.spec.ts` | 单元验证凭证跨数据库重开与未勾选存储为空；Electron 验证勾选后重启自动登录及退出后回登录页。未覆盖另一 macOS 账户。 |
| TC-031 | `tests/next-auth.test.ts` | 单元验证无固定到期、退出撤销、重置密码/停用失效及损坏凭证；管理员界面操作路径未单独验收。 |
| TC-032 | `tests/next-server.test.ts` | 原函数验证默认回环、`localhost` 配置、无 TLS 的 `0.0.0.0` 被拒；临时自签证书下实际绑定 `0.0.0.0` 并经 HTTPS 健康检查成功，旧客户端关闭证书校验。`57fd884` 新增第二项：临时 CA 与本机非回环 IPv4 SAN 下严格 TLS 健康检查成功；无 CA、主机名不匹配均拒绝，真实 `ServerConnection` 通过 `NODE_EXTRA_CA_CERTS` 连通。单编号 2/2；异机和生产证书仍待验。 |
| TC-033 | `tests/next-server.test.ts` | 合成包的清单、大小、SHA-256 与路径穿越拒绝；未用真实发布 DMG 验证。 |
| TC-034 | `tests/next-update.test.ts` | 同版、旧版、架构不符、坏摘要与较新版提示；版本差异及下载由合成包验证。 |
| TC-035 | `tests/next-update.test.ts` | 停服后下载失败、清理临时文件和重启服务重试；未单独注入超时、磁盘不足。 |
| TC-036 | `tests/next-update.test.ts` | 校验后调用注入的打开回调且旧文件不变；未在真实 macOS 打开 DMG、取消安装或验证安装失败回退。 |
| TC-037 | `tests/next-sync.test.ts` | 假时钟检查启动、10 分钟及手动调用扫描；扫描函数被 mock，未单独断言并发串行、失败扫描不上传。上传主流程另见 TC-038。 |
| TC-038 | `tests/next-sync.test.ts`；`tests/e2e/upload.spec.ts` | 单元检查聚合入库无会话/路径标识，Electron 验证手动扫描后服务器入库及上报成功；敏感字段白名单另见 TC-047。 |
| TC-039 | `tests/next-sync.test.ts` | 同快照重复发送不增行、修订后总量替换；未在多设备并发下验证。 |
| TC-040 | `tests/next-sync.test.ts` | 停服积压、数据库重开和恢复补传；退避时间通过手动调整元数据推进，未长时间运行验证。 |
| TC-041 | `tests/next-report.test.ts` | 检查 1023、K/M/P 边界及 CSV 原值；未覆盖超过 JavaScript 安全整数的精确表示。 |
| TC-042 | `tests/next-report.test.ts` | 检查等长区间数值和比较文案；未用 Electron 验证所有界面筛选联动。 |
| TC-043 | `tests/next-report.test.ts` | 日/周/月点与明细求和，周/月界面点击另见 TC-049；未覆盖全部时区。 |
| TC-044 | `tests/next-report.test.ts` | 按总量降序、同值稳定和模型明细；未知模型及界面点击未单独断言。 |
| TC-045 | `tests/next-report.test.ts` | `no_records`、错误状态与比较文案分离；未单独验证所有缺失/权限状态在界面的呈现。 |
| TC-046 | `tests/next-report.test.ts` | 来源事实数、最近扫描时间、未找到目录文案；未覆盖格式不支持等全部状态卡片。 |
| TC-047 | `tests/next-server.test.ts` | 旧版覆盖错误凭证、非法字段、Origin 和 HTTPS 配置；0.3.2 增加本机 `0.0.0.0` 自签 TLS 下的清单、包、管理和上报鉴权，历史客户端关闭证书验证。`57fd884` 新增第三项：指定临时 CA 的严格 TLS 下，清单/包缺失或错误凭据被拒、正确凭据可取；管理员登记须管理密钥，设备令牌可上传，越权 owner 得 403 且原聚合不变。单编号 3/3；异机与生产证书仍待验。服务切换竞态另见 TC-074。 |
| TC-048 | `tests/e2e/trend.spec.ts` | 在 1180、860 两种窗口宽度截屏并断言数值/日期边界框不重叠；未覆盖更窄窗口、所有本地化字体及裁切边界。 |
| TC-049 | `tests/e2e/trend.spec.ts` | ISO 跨年周周一标签、月标签及点击明细行数；其他时区和长期跨度需另验。 |

上述限制是后续补测清单，不把未覆盖部分写成已通过。`TC-027` 的本机安装验收和 `TC-028` 的外部分发验收仍按各自人工证据独立判定。

**TC-032 / TC-047 严格 TLS 原补证计划（2026-10-03）**：两个编号已注册，独立执行命令分别为 `npm run test:case -- TC-032` 与 `npm run test:case -- TC-047`。计划在 `tests/next-server.test.ts` 用一次性 CA、带本机连接地址 SAN 的服务端证书和隔离服务库构造严格 TLS 客户端；TC-032 验证可信 CA 的 HTTPS 健康检查与不受信 CA、主机名不匹配的拒绝，TC-047 在同类连接上核对受保护接口的凭据范围。测试结束清理证书、服务目录和监听资源，不修改系统信任设置。本段保留实施前计划，当前绑定和结果见下段。

**`57fd884` 实施与验收**：`scripts/test-cases.mjs` 为 TC-032 追加 `TC-032 临时 CA 严格验证非回环服务与证书失败路径`，为 TC-047 追加 `TC-047 严格 TLS 下保护接口维持鉴权`；原函数和历史结果保留。两项都在 `tests/next-server.test.ts` 用一次性 OpenSSL CA、带本机非回环 IPv4 SAN 的证书和隔离服务库，`https.request` 指定 CA 且保持 `rejectUnauthorized: true`。TC-032 还在子进程通过 `NODE_EXTRA_CA_CERTS` 验证真实 `ServerConnection`；TC-047 检查 401/403、合法响应和越权前后聚合行。开发会话报告 TC-032 2/2、TC-047 3/3、门禁 74 个编号入口、50 个单元和 18 个 Electron 用例通过。文档会话在该提交独立复跑 `npm run test:cases:check`、TC-032 2/2 与 TC-047 3/3，均退出码 0。测试只证明当前 Mac 的临时 CA 链、SAN 地址匹配与接口鉴权；未改系统信任设置，未使用生产证书，尚无另一台 Mac 的实际连接证据。详细边界见[验收记录](validation.md)。

**TC-036 新增本机链路记录（2026-10-02，代码 `44a96e8`）**：`npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.2.0.dmg /Users/lz/文档/Token/Token-0.3.0.dmg` 使用 `scripts/verify-local-upgrade.mjs`，在本机隔离目录复制旧版应用、启动并勾选信任设备；旧版连接临时本机更新服务，发现 0.3.0、下载并打开安装包；下载 SHA-256 与发布包一致。脚本关闭旧版后以 `ditto` 在同一临时安装路径替换为新版，沿用同一临时用户数据目录启动，新版受信登录与合成报表 1280 Token 均通过。日志在开发工作树 `test-results/manual/evidence/TC-036-upgrade.log`（Git 忽略），脱敏摘要见[验收记录](validation.md)。此结果标记为**部分验证：本机隔离更新交接与替换通过**；取消安装、安装失败回退、Finder 人工拖拽至 `/Applications`、生产数据迁移、签名公证及目标 Mac 仍待验证。脚本是独立复验入口，`npm run test:case -- TC-036` 仍只运行表内单元断言。

**TC-036 取消与打开失败补验（2026-10-03，代码 `b224dde`）**：同一本机脚本现在先在旧版扫描合成 1280 Token，下载打开 0.3.0 后不替换应用，关闭映像并重启旧版；0.2.0、`admin` 受信登录和已采集 1280 Token 均保留，随后成功升级路径仍通过。`npm run test:case -- TC-036` 的单元函数新增注入 `openPackage` 失败，断言报错且旧应用文件不变。开发会话记录两次升级脚本通过、单编号 1/1 通过；脱敏日志在开发工作树 `test-results/manual/evidence/TC-036-cancel.log`（Git 忽略），摘要见[验收记录](validation.md)。**当前状态仍为部分验证**：本机隔离取消操作和注入式打开失败已验；Finder 实际安装失败回退、手动拖拽 `/Applications`、生产数据库迁移、签名公证和目标 Mac 未验。上段 10-02 记录为当时事实，不代表本轮结论。

**自动安装新目标与独立制品验收（2026-10-03 实施前原计划；REQ-022/023、DEV-024/025、TC-034–036/076）**：用户确认新版后，实际 App 应自行校验、退出旧版、替换并重启；成功路径无需 Finder 拖拽。TC-034/035 计划补大小、SHA-256、服务/下载与安装前故障状态，坏包绝不进入安装，失败后旧版可用。TC-036 原计划将“只打开安装包”单元函数改为安装辅助进程控制及取消、权限不足、挂载/替换/重启失败回滚；当时 `npm run test:case -- TC-036` 的 1/1 旧行为通过只作历史证据。TC-076 原计划命令为 `npm run test:case -- TC-076`，**此段写作时**尚未在 `scripts/test-cases.mjs` 注册或运行。目标要求在一次性可写安装路径与独立用户数据目录中启动实际旧版/新版打包 App，经旧版检查与下载已校验 DMG 后，由应用自动退出、替换、重启，核对新版版本、受信登录和无正文合成 1280 Token 报表；再分别注入取消、磁盘/挂载/替换/重启失败，核对旧版和数据保留、备份恢复、挂载及临时文件清理。从只读 DMG 启动时还须验证目标选择：当前用户可写 `/Applications` 则自动复制到 `/Applications/Token.app` 并重启，否则自动复制到用户可写 `~/Applications/Token.app` 并重启；已有不可写系统安装的授权/报错边界与未签名 `safeStorage` 连续性也须留证，不能静默迁址或要求拖拽。若不能延续登录，验证明确重新登录恢复。按提交、macOS/架构、包哈希、命令、退出码、脱敏日志留证；不使用生产账户或数据库。TC-028 仍承担真实签名、公证和目标 Mac 验收，旧 TC-036 记录保留为版本历史。

**0.3.5 自动安装实施与当前覆盖（代码 `86a4b5b`）**：上段是实施前目标，不能把所有待验条件改写成已通过。`scripts/test-cases.mjs` 已将 TC-036 绑定到 `tests/next-update.test.ts` 的“校验后只交自动安装器且启动失败时旧版不退出”及 `tests/update-install.test.ts` 的“目标选择、退出后替换和失败回滚”两项；后者以合成 App/命令覆盖 `/Applications` 或 `~/Applications` 的目标选择，以及挂载、复制、替换、重启、健康超时和包篡改的注入失败。TC-076 已绑定 `scripts/verify-auto-upgrade.mjs`。文档会话在 `86a4b5b` 独立运行 `npm run test:case -- TC-034` 1/1、TC-035 1/1、TC-036 2/2、TC-059 1/1、TC-076 1/1、`npm run test:cases:check` 76 个入口，均退出码 0；开发会话报告 `test:gate` 52 单元/18 Electron 通过。TC-076 用当前 0.3.5 打包 App 复制并改 `app.asar` 和 Info.plist 的版本元数据为 0.3.4 来模拟旧版，使用临时库/无正文合成 1280 Token 检查了新更新器自动退出、替换、重启、健康标记、helper 退出、受信登录与用量延续；**不是历史 0.3.4 或 0.3.0 二进制的真实升级测试**。实际只读 DMG 路径、系统不可写安装、打包版故障回滚、取消和旧版 UI 首次过渡仍缺证据。原 0.3.0/0.3.4 按钮仍是下载打开 DMG，不能自动调用 0.3.5 helper。0.3.5 本机未签名 x64 DMG SHA-256 `ae1b8e80ec69c43f76e93d1e2312694cb4faab3521115fdaeec9e304d6e697fd`，文档会话核对 `hdiutil verify` 为 VALID；TC-028 仍待真实签名、公证及目标 Mac。

## M6 目标与实际覆盖（TC-050–TC-072）

下表保留原定目标，实际覆盖以其后的绑定表为准。`scripts/test-cases.mjs` 已注册 TC-050–072，每条命令为 `npm run test:case -- TC-###`。自动用例通过 `tests/support/test-workspace.ts` 为每个编号创建独立的 `token-test-db-tc###-*` 临时目录及 `token.sqlite`；Electron 的 `--token-user-data` 指向该目录，服务端使用目录内文件和随机端口，结束清理。**每个编号有自己的数据库，即使测试文件共用，也不共享状态**。TC-072 用独立测试用户数据目录和真实目标 Mac 操作，尚未取得人工证据。所有反馈/诊断样本均为人工合成数据。

| 用例／关联 | 目标前置与操作 | 目标与证据重点 | 实际测试文件 |
| --- | --- | --- | --- |
| TC-050／REQ-031 DEV-034 | 专用库中放有 cwd 与缺 cwd 的 Codex 合成会话并扫描 | 正确项目归属，缺 cwd 为未知；不读取目录内容 | `tests/m6-project.test.ts` |
| TC-051／REQ-031 DEV-034 | 专用库中放有 cwd、缺 cwd 与子代理的 Claude 合成会话 | 同会话归属一致，子代理不误归其他项目 | `tests/m6-project.test.ts` |
| TC-052／REQ-031 DEV-035 | 两个绝对路径同名项目，截取聚合、反馈、诊断外发 | 项目区分；外发无完整路径、项目 ID/别名；旧事实保持未知 | `tests/m6-project.test.ts` |
| TC-053／REQ-032 DEV-036 | 多用户、项目、模型、时区及未知项目事实 | 授权聚合与事实求和一致；无越权；未知单列 | `tests/m6-report.test.ts` |
| TC-054／REQ-032 DEV-037 | Electron 在专用用户数据中切换项目、模型、趋势和下钻 | 筛选继承且排行/明细相符，无跨项目串数 | `tests/e2e/m6-analysis.spec.ts` |
| TC-055／REQ-032 DEV-036 | 同一筛选导出 CSV，含未知项目和跨年周 | 页面/CSV 分类及总量一致，防公式注入且无路径 | `tests/m6-report.test.ts` |
| TC-056／REQ-033 DEV-038 | Electron 打开长报表，只滚动右侧内容 | 侧栏不移动，焦点及操作可见 | `tests/e2e/m6-shell.spec.ts` |
| TC-057／REQ-033 DEV-038 | 宽窄窗口切换页面和下钻路径 | 无遮挡/不可达控件；面包屑与状态一致且可回退 | `tests/e2e/m6-shell.spec.ts` |
| TC-058／REQ-034 DEV-039 | 登录后不滚动概览查找更新入口 | 在明显导航/设置位置可发现 | `tests/e2e/m6-update.spec.ts` |
| TC-059／REQ-034 DEV-039 | 模拟同版、新版、中断、摘要错误与重试 | 状态准确；坏包不打开；旧版可用 | `tests/e2e/m6-update.spec.ts` |
| TC-060／REQ-035 DEV-040 | 用超管、管理员、查看者进入集中设置并调用 IPC | 分组完整；无权修改在主进程拒绝 | `tests/e2e/m6-settings.spec.ts` |
| TC-061／REQ-035 DEV-040 | 合成无权限目录，再恢复可读 | 指向具体来源与手动授权/重试；不自动提权 | `tests/e2e/m6-settings.spec.ts` |
| TC-062／REQ-036 DEV-041 | 构造目录缺失、解析错、游标停滞、未归属和重复 | 指出漏采环节与最后成功；未知不当零 | `tests/m6-diagnostics.test.ts` |
| TC-063／REQ-036 DEV-041 | 合成路径、正文和密钥样式字段，按角色索取摘要 | 外发/日志脱敏；普通用户仅看授权来源 | `tests/m6-diagnostics.test.ts` |
| TC-064／REQ-037 DEV-042 | 反馈预览后显式提交，输入含敏感样式 | 仅白名单上传；未经确认不上传；敏感字段不外传 | `tests/m6-feedback.test.ts` |
| TC-065／REQ-037 DEV-043 | 临时服务随机端口，测试无凭证、停服及重复提交 | 未授权拒绝；恢复后幂等入库且状态可见 | `tests/m6-feedback.test.ts` |
| TC-066／REQ-038 DEV-044 | 多用户反馈以三类角色进入管理界面/IPC | 管理员按授权查看；查看者无管理读取 | `tests/e2e/m6-admin.spec.ts` |
| TC-067／REQ-038 DEV-044 | 专用库有启停账号及正常/异常来源 | 账号角色、启停、来源状态准确且不越权 | `tests/e2e/m6-admin.spec.ts` |
| TC-068／REQ-039 DEV-045 | 空库初始化并重新初始化 | 首建固定 `admin`，库角色 `admin`、对外 `superadmin`；重复拒绝 | `tests/m6-roles.test.ts` |
| TC-069／REQ-039 DEV-046 | 固定账号、普通管理员、查看者分别操作账号 | 仅固定账号派生超管；其他管理员保留旧创建权限但不能停用/重置固定账号 | `tests/m6-roles.test.ts` |
| TC-070／REQ-039 DEV-045 | 复制合成旧库：已有 admin 管理员、无 admin、admin 为 viewer、迁移失败 | 正确兼容；冲突不静默升权；ID/哈希/归属不变；失败可回退 | `tests/m6-roles.test.ts` |
| TC-071／REQ-039 DEV-046 | 固定账号创建管理员/查看者，其他角色试超管操作 | 角色和管理边界正确；如提供审计查看则仅超管可见 | `tests/e2e/m6-admin.spec.ts` |
| TC-072／REQ-035 DEV-040 | 目标 Mac 的独立测试账户先拒绝再手动授予文件访问权限 | 指引可执行、重试后恢复；无权限时未知且不越权 | 人工清单，需目标 Mac 脱敏证据 |

实际绑定以 `scripts/test-cases.mjs` 为准。最终提交 `6223c30` 的 `test-results/acceptance/summary.json` 记录 2026-10-02 14:56–14:57 UTC、`darwin-x64`、Node v24.15.0、TC-050–071 **22/22 退出码 0**；逐编号日志位于开发工作树被 Git 忽略的 `test-results/acceptance/`。该结果仅证明以下实际断言通过，目标表中超出断言的内容仍待补证。TC-072 的 `npm run test:case -- TC-072` 只显示人工清单，不能自动判通过；只有目标 Mac 脱敏证据及人工 `pass` 登记才算完成。

| 用例 | 实际绑定测试函数 | 当前断言与剩余边界 |
| --- | --- | --- |
| TC-050 | `tests/m6-project.test.ts`：`TC-050 Codex cwd 归属与缺失项目保持未知` | 合成 Codex 会话的 cwd 哈希归属、缺失为未知；未覆盖真实版本格式变化。 |
| TC-051 | `tests/m6-project.test.ts`：`TC-051 Claude cwd 和子代理文件独立归属` | 合成主会话、子代理各归项目，缺 cwd 未知；未覆盖所有真实子代理格式。 |
| TC-052 | `tests/m6-project.test.ts`：`TC-052 同名路径不合并且外发摘要无项目标识` | 同名不同路径键/标签分开，诊断摘要无路径/键，历史无 cwd 保持未知；其他外发通道另见 TC-064。 |
| TC-053 | `tests/m6-report.test.ts`：`TC-053 项目模型聚合沿用授权范围和未知项目` | 合成 25 Token、多用户权限、项目/模型与未知分组；只用 UTC 示例，更多时区待测。 |
| TC-054 | `tests/e2e/m6-analysis.spec.ts`：`TC-054 项目模型筛选及趋势下钻保持同一用量范围` | Electron 对账 42→12 Token、项目/模型筛选和一次日下钻；其他时间粒度组合待测。 |
| TC-055 | `tests/m6-report.test.ts`：`TC-055 项目筛选 CSV 与页面同口径且文本安全` | 单个项目跨年周 CSV、明细 10 Token 与公式文本转义；更大数据量及全部字段组合待测。 |
| TC-056 | `tests/e2e/m6-shell.spec.ts`：`TC-056 长报表右侧滚动时左侧导航保持固定` | 长页右侧滚动时侧栏位置不变；键盘焦点与更多窗口尺寸待测。 |
| TC-057 | `tests/e2e/m6-shell.spec.ts`：`TC-057 窄窗口路径可见且下钻可从面包屑返回` | 760×700 窗口、面包屑回退和无横向溢出；更窄窗口及辅助功能待测。 |
| TC-058 | `tests/e2e/m6-update.spec.ts`：`TC-058 登录后可直接发现检查更新入口` | 登录后设置中可找到更新入口；未验证真实用户发现率。 |
| TC-059 | `tests/e2e/m6-update.spec.ts`：`TC-059 新版坏包提示错误且重试后可重新检查` | 合成新版坏摘要被拒、重查旧版显示最新；未验证真实 DMG 打开/安装与网络中断。 |
| TC-060 | `tests/e2e/m6-settings.spec.ts`：`TC-060 设置分组完整且普通用户修改接口被拒绝` | 设置分组可见、viewer 修改 IPC 被拒；普通管理员的所有设置权限组合待测。 |
| TC-061 | `tests/e2e/m6-settings.spec.ts`：`TC-061 缺少目录时诊断引导权限设置和重新扫描` | 缺目录时显示权限指引和重扫入口；真实 macOS 授权/撤销留给 TC-072。 |
| TC-062 | `tests/m6-diagnostics.test.ts`：`TC-062 缺目录解析错待写完记录及未归属有独立诊断` | 缺目录、错误记录、待写尾行、未归属和最后成功状态；长时间游标停滞待测。 |
| TC-063 | `tests/m6-diagnostics.test.ts`：`TC-063 诊断摘要不包含原始路径正文与项目标识` | 合成路径与项目键不进入诊断摘要；所有日志/外发渠道的系统级审计待补。 |
| TC-064 | `tests/m6-feedback.test.ts`：`TC-064 反馈仅显式提交且阻止路径密钥进入服务` | 未提交前服务为空、路径/密钥样式被拒；预生成编号与服务入库编号一致，界面预览另见 TC-066。 |
| TC-065 | `tests/m6-feedback.test.ts`：`TC-065 反馈离线持久化重试幂等且管理读取需独立密钥` | 离线排队、恢复后一次入库、重复 POST 幂等及管理密钥；长期退避与跨设备冲突待测。 |
| TC-066 | `tests/e2e/m6-admin.spec.ts`：`TC-066 管理员可看反馈列表而普通用户接口拒绝` | 超管预览显示实际用户名及预生成编号，提交成功提示编号一致；反馈列表可见，viewer 管理入口和 IPC 被拒；普通管理员反馈视图待单测。 |
| TC-067 | `tests/e2e/m6-admin.spec.ts`：`TC-067 账号启停归属和采集状态随操作更新` | 一名 viewer 的来源绑定、采集状态及停启变化；多来源异常状态待测。 |
| TC-068 | `tests/m6-roles.test.ts`：`TC-068 首建固定 admin 且库内角色兼容旧约束` | 非固定首建拒绝、库角色 admin/对外 superadmin、重复首建拒绝。 |
| TC-069 | `tests/m6-roles.test.ts`：`TC-069 普通管理员保留建户权限但不能改动固定 admin` | 普通管理员可建 admin/viewer，不能停用或重置固定账号；其他管理 IPC 待单测。 |
| TC-070 | `tests/m6-roles.test.ts`：`TC-070 旧库 admin 冲突显式处理且保留账号 ID 和哈希` | 旧库 viewer 占用 admin 时显式改名，失败改名不改变原账户；已有 admin 自动派生超管，无 admin 时原管理员可创建固定账号，ID/哈希保留。真实生产库迁移回滚未演练。 |
| TC-071 | `tests/e2e/m6-admin.spec.ts`：`TC-071 固定 admin 创建管理员与普通用户且角色边界生效` | 超管界面创建两类账号；普通管理员不能停用/重置固定账号；完整审计功能未纳入本轮。 |
| TC-072 | `scripts/test-cases.mjs` 人工清单 | **待验证**：目标 Mac 拒绝、授予、撤销文件访问权限后的状态与重扫均无人工证据。 |

## TC-073 Codex fallback 跨扫描归并（2026-10-03 规划记录）

- **关联**：REQ-006 / DEV-047；现有 TC-010 的历史通过只覆盖同批记录与一般重扫，不覆盖此缺陷。
- **计划独立命令**：`npm run test:case -- TC-073`；待开发会话将 `tests/collector-fallback.test.ts` 中以 `TC-073` 开头的独立测试函数注册到 `scripts/test-cases.mjs` 后才可执行。
- **前置与隔离**：所有 Codex JSONL 均为人工合成、无正文；各子场景分别使用 `tests/support/test-workspace.ts` 创建 `token-test-db-tc073-*` 专用临时目录与 `token.sqlite`，不读写真实会话、用户库或服务库，结束清理。
- **跨扫描断言**：首扫只有 `event_msg:token_count`，先确认 fallback 可见；随后向同一会话文件追加 `token_usage_record` 并增量扫描，核对该会话只剩正式事实，明细、汇总和导出总量只取正式值，旧 fallback 不再累计。
- **旧库与幂等断言**：合成旧库预置同会话 fallback 和正式事实，另置不同 Codex 会话、Claude 来源及不同项目事实；应用启动修复后只回收目标 fallback，其他事实、归属与项目不变。重复扫描、关闭重开数据库及再次启动修复后，事实数和报表总量不变；异常中断不得造成仅删除 fallback 的半成品。
- **状态与证据**：**待注册、待验证**。保存单编号命令、提交、环境、退出码、各阶段事实键/数量和报表合计的脱敏日志；完成后再写回工作簿与[验收记录](validation.md)，不得沿用 TC-010 的 A5 历史结果。

### TC-073 当前实现与验收（2026-10-03）

- **执行与绑定**：`npm run test:case -- TC-073` 已由 `scripts/test-cases.mjs` 注册到 `tests/collector-fallback.test.ts` 的 `test('TC-073 Codex fallback 跨扫描替换与旧库修复保持幂等')`；在 `aa6d91b` 上单编号 1/1 通过，不能用 TC-010 的共享测试替代。
- **实际覆盖**：独立临时 `token.sqlite` 场景先以 fallback 12 Token 入库，再追加同会话正式 12 Token；注入游标写入失败时回滚，复跑后仅正式事实保留，报表汇总/明细/CSV 为 12 Token。另一个文件后到 fallback 不再新增；重扫和重开库稳定。第二个独立库预置同会话 fallback/正式、另一 Codex 会话 fallback 和 Claude 事实；注入旧库清理失败时事实与项目关联全数回滚，成功修复后只删目标 fallback 及其项目关联，其他事实、项目关联、两类来源身份保持，Codex `fact_count` 为 2；再重扫、重启仍稳定。
- **证据与边界**：开发工作树的 `test-results/acceptance/TC-073.log`、`TC-010-fallback-regression.log` 为本机 Git 忽略日志；开发会话报告先见到两条各 12 Token 的失败复现，再在修复后通过。文档会话复跑 `npm run test:cases:check`、TC-073 1/1 与 TC-010 的单元加 Electron，均退出码 0，环境 macOS 15.7.4 x86_64 / Node v24.15.0。此证据只覆盖合成样本和临时库；真实生产库迁移、更多未知 Codex 记录格式、打包应用及新 DMG 尚未验证。现有 0.3.0 DMG 不含该修复。详见[新增验收记录](validation.md)。

**TC-073 0.3.1 候选包补验（2026-10-03，代码 `867a03a`）**：上条是 `aa6d91b` 时的代码验收边界。0.3.1 未签名 x64 DMG 已生成，SHA-256 `7e56933298505f5d08def3811b891e187b6cefb264bfab3538e5accdb6235a7c`，本机 `hdiutil verify` VALID。`npm run test:upgrade:local -- /Users/lz/文档/Token/Token-0.3.0.dmg /Users/lz/文档/Token/Token-0.3.1.dmg --fallback-repair` 在隔离同库先以旧包复现 1280→2560 Token，再从新版包替换并回到 1280、受信登录保持；文档会话独立复跑该命令，退出码 0。开发工作树 `test-results/manual/evidence/TC-073-package-upgrade.log` 为被 Git 忽略的脱敏日志。开发会话报告新版目录包 Electron 17/17；本机更新服务目录的清单与发布包哈希也已对账。TC-073 的单编号命令和函数绑定不变；这是追加的候选包证据。生产库、实际生产账户 App 安装、Finder `/Applications`、签名公证和目标 Mac 未验，详见[验收记录](validation.md)。

**TC-073 0.3.4 大会话回归（2026-10-03，代码 `7abd640`）**：`scripts/test-cases.mjs` 为同一编号增加 `tests/collector-fallback.test.ts` 的 `TC-073 大会话无 fallback 时启动修复保持线性耗时`，与原归并幂等函数一起运行。新函数在独立 `tc073-large-session` 临时 `token.sqlite` 中造 6000 条同会话正式事实、没有 fallback；重新打开数据库并构造 `UsageScanner`，要求低于 5 秒、事实数仍为 6000。文档会话在 `7abd640` 独立执行 `npm run test:case -- TC-073`，两项绑定均通过、退出码 0；该阈值是单机样本回归，不证明所有硬件或数据规模的严格线性耗时。开发会话报告门禁 74 个编号入口、48 个单元、18 个 Electron 及目录包 18/18。另用 `npm run test:production-copy -- /绝对路径/token.sqlite /绝对路径/Token.app` 对生产库的只读临时副本启动打包 App、核对完整性和账户/事实/来源身份/游标数量；文档会话独立执行退出码 0。该副本检查不读取真实来源会话、不修改原库，也不等于生产账户真实安装与界面验收；见[验收记录](validation.md)。

## TC-074 聚合上报设备与用户归属授权回归（2026-10-03 原规划与实施）

以下五项是实施前的历史计划与状态；当前结果见本节末的 0.3.2、0.3.3 记录。

- **关联与状态**：REQ-021 / DEV-048；**待注册、待验证**。TC-047 的错误凭证等历史自动结果保留，但跨用户授权目标在当前代码已复现失败；不能以该历史通过替代本用例。
- **计划独立命令与绑定**：`npm run test:case -- TC-074`；拟将 `tests/server-ownership.test.ts` 的 `test('TC-074 聚合上报拒绝跨设备跨用户覆盖并保留原快照')` 注册至 `scripts/test-cases.mjs`，注册后方可执行。
- **前置与隔离**：使用 `tests/support/test-workspace.ts` 建一次性 `token.sqlite`、服务目录和随机端口；所有设备/用户 ID、快照和凭据均为人工测试数据，不读取生产服务密钥、真实数据库或会话正文，测试结束清理。
- **操作与预期**：管理凭据登记可信设备 A/owner A，并签发上报令牌；全局 bearer 单独上报应得 401。设备令牌先报 revision 1、12 Token；同一令牌伪装设备 B 或把 owner 改为 B、revision 提升并报 99 Token，均应返回 403，`aggregates`、`device_revisions`、`source_coverage` 原值保持。授权范围内的 revision 2 应正常替换，同修订重发幂等；显式授权的管理员多用户快照按用户隔离，撤销令牌后再上报应拒绝。
- **实施依赖与证据**：SOP-002 的令牌登记、撤销、旧数据保留及客户端待传方案见[设计第 12.2 节](design.md)；当前尚无修复代码、注册入口或通过日志。实施后保存提交、命令、环境、退出码以及拒绝前后脱敏数据库计数；同步复跑 TC-047 和门禁，详见[缺口记录](validation.md)。

**0.3.2 实施与验收**：`ca0f37f` 已注册 TC-074 的三项绑定：`tests/server-ownership.test.ts` 两项分别检查全局 bearer 401、错误设备或 owner 403 且三张状态表不变、合法修订与重传、管理员扩权轮换、撤销和显式重新登记、旧 owner 聚合保留；`tests/next-sync.test.ts` 一项检查管理员保存后立即重试待传快照。客户端凭据测试使用注入的加密接口模拟器，检查落盘密文、权限、加密不可用、撤销和换 URL 清除；它不等于真实 Electron `safeStorage` 集成验收。文档会话独立执行 `npm run test:case -- TC-074`，三项均通过、退出码 0，并复跑 TC-047、TC-038、TC-039、TC-040、TC-060 均退出码 0。开发会话在 `ca0f37f` 报告完整门禁 74 个入口、46 个单元、18 个 Electron 及目录包 18/18；`533992e` 仅改 TC-047 TLS 测试资源清理。随后发现服务切换竞态，0.3.2 只保留为阶段证据，不能据此判定最终交付；后续版本须补该竞态的回归及完整验证记录。

**0.3.3 竞态回归**：`3d60b5e` 为 `scripts/test-cases.mjs` 追加 `tests/server-ownership.test.ts` 的 `TC-074 切换服务器时不向新地址发送旧设备令牌`。测试在异步登记未返回时切换 URL，再模拟同 URL 重新保存配置；两次均要求旧请求报连接已切换、设备凭据文件不存在。代码在登记响应前后及上传前比较 URL 与配置代次。文档会话在 `3d60b5e` 独立复跑 `npm run test:case -- TC-074`，四项绑定均通过、退出码 0；开发会话报告同提交完整门禁 74 个入口、47 个单元、18 个 Electron，目录包 18/18。测试使用临时数据目录和注入的加密接口，尚未以生产服务或真实 macOS `safeStorage` 复验；同 URL 背后服务实例未触发配置保存的替换不在该竞态断言内。

## TC-075 签名发布脚本预检与命令构造（2026-10-03 原计划与实施）

以下五项保留 `04bfc48` 的实施前计划与当时状态；当前绑定与结果见本节末。

- **关联与状态**：REQ-018 / DEV-018；待注册、待验证。独立于人工 TC-028，不能由其历史结果或本机未签名 DMG 推断本项通过。
- **计划执行命令**：`npm run test:case -- TC-075`。开发会话须在 `scripts/test-cases.mjs` 注册以 `TC-075` 开头的独立测试函数；注册前命令不是有效通过入口。实施后同时运行 `npm run test:cases:check`。
- **造数与隔离**：用假的 Developer ID 身份、三组公证凭据的占位值和注入式命令执行器；不读取真实钥匙串、不调用 Apple 服务，不创建真实签名制品。命令日志仅检查参数类别与脱敏字段。
- **预期断言**：缺少或错误类型签名身份、完全缺少/部分缺少公证凭据、混用互相冲突的凭据组时，在构建前报可理解的错误并且构建执行器调用次数为零；完整凭据选择单一认证方式，生成带 `forceCodeSigning: true`、`mac.notarize: true` 的 electron-builder v26 命令，并安排 `codesign --verify`、`spctl --assess`、`xcrun stapler validate`、`hdiutil verify` 与 DMG 摘要核对；任一核验失败即停止发布，不把旧未签名 DMG 标成新制品。原 `pack:dmg` 的未签名路径仍可用且不被签名入口改变。
- **证据与边界**：保存测试提交、macOS/Node 版本、单编号命令、退出码和脱敏断言；任何失败须留失败分支。自动通过只证明预检、错误处理和命令构造，不证明真实证书有效、Apple 公证成功、票据已钉入、Gatekeeper 在目标机放行或另一台 Mac 的安装/启动/登录/采集。后者仍按 `npm run test:case -- TC-028` 人工登记。

**`dc37b8b` 实施与当前验收**：`scripts/test-cases.mjs` 已将 `tests/signed-release.test.ts` 的 `test('TC-075 签名发布预检与命令构造')` 绑定至 `npm run test:case -- TC-075`。测试以假身份和三类占位公证凭据检查无凭据、不完整/冲突、错误/多个 Developer ID 身份的预检结果；在一次性目录用 OpenSSL 生成**合成** p12，核对本地路径与 base64 两种读取；检查 electron-builder v26 的 `mac.forceCodeSigning`、`mac.notarize`、`mac.hardenedRuntime`、JIT entitlement 参数及后续 `codesign`、`spctl`、`stapler`、`hdiutil` 命令顺序。另以清除凭据的子进程证明实际脚本在构建前失败、无新发布目录且错误信息不含测试口令。文档会话在 `dc37b8b` 独立复跑单编号 1/1、编号检查 75 个入口均退出码 0；清除环境变量后独立运行 `npm run pack:signed` 返回 1，`release/signed` 无制品。开发会话报告完整 `npm run test:gate` 为 75 个入口、51 单元、18 Electron 通过；文档会话未独立复跑完整门禁。**当前标记为自动子范围通过，整体仍有覆盖缺口**：测试没有执行真实 Apple 签名/公证，也没有注入每个构建后核验步骤失败，未验证真实钥匙串身份、真实有效 p12、DMG 原子发布或现有 `pack:dmg` 的本次重跑；TC-028 继续待验证。合成 p12、临时目录在测试后清理。

**`2f43b00` 构建后失败补证**：原 TC-075 函数新增五处逐项注入：`codesign --verify`、`spctl --assess`、`xcrun stapler validate`、`hdiutil verify` 及 `codesign -dv` 的 Developer ID `Authority` 不匹配。`verifySignedCandidate` 与 `withTemporaryReleaseDirectory` 同时供测试注入和真实发布主流程使用；每次在一次性 `token-tc075-failed-build-*` 下建立合成 DMG，模拟失败后断言抛错、临时 `token-signed-*` 目录被清理、无 `signed` 发布目录。文档会话在代码 `2f43b00` 独立复跑 `npm run test:case -- TC-075` 1/1、`npm run test:cases:check` 75 个入口及 `npm run typecheck`，均退出码 0；开发会话报告完整门禁 75 编号、51 单元、18 Electron 通过。**TC-075 的模拟自动范围已验证。**测试没有真实签名身份、公证凭据、Apple 票据或其他目标 Mac，也未生成成功发布制品；TC-028 继续待验证，不能用模拟失败或单编号通过替代。上一段关于“未注入构建后失败”的描述是 `dc37b8b` 阶段事实。

## TC-077–TC-091 下一轮产品打磨计划

以下十五个编号已在[追溯工作簿](../outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)分配，**尚未在 `scripts/test-cases.mjs` 注册，也没有通过结果**。每条计划命令为 `npm run test:case -- TC-###`；实施时须给每个编号独立命名的函数和专用临时数据库、用户数据、无正文合成来源。TC-089 的 VoiceOver 观察另需目标 Mac 人工脱敏证据。旧 TC-017/019/021/023/029/042–046/056–057/061–062 的通过结果仅是原断言历史，不能替代下表的新目标。

| 编号与关联 | 前置和操作 | 通过标准与关键证据 |
| --- | --- | --- |
| TC-077 / REQ-040 DEV-049 | 两工具、两用户的独立来源设置历史缺口、权限拒绝、留存起点未知与成功空扫描；切换区间/时区 | 覆盖严格按所选范围与可证明时间窗计算；当前 `ready` 不推出完整历史；真零仅限完整证据，缺口显示部分或未知 |
| TC-078 / REQ-040 DEV-049 | 两个等长区间分别构造都完整、一方部分、范围变化、时区边界、今天进行中和扫描滞后；记录最近成功采集的 as-of | 仅同口径、同截止时刻且双方可证覆盖时显示增减；未结束的今天不能作为完整日与完整上期比较，否则“不可比较” |
| TC-079 / REQ-041 DEV-050 | 快速切换 A/B 筛选并让旧请求后返回；B 查询完成后再扫描入库；加载前后导出 CSV | 页面/CSV 使用相同授权查询键及 revision/快照身份，逐事实集合和合计一致；旧响应不覆盖 B，新增扫描不会产生旧页面/新文件错配 |
| TC-080 / REQ-042 DEV-051 | 分别选择 7/30/90 天、工具/用户/时区，点概览趋势桶并经面包屑返回 | 明细继承全部筛选及桶区间，返回后筛选与键盘焦点保留 |
| TC-081 / REQ-042 DEV-051 | Codex 与 Claude Code 构造同名模型但不同用量，按工具和模型下钻 | 排行与明细以提供方+模型分开，合计与事实不串数 |
| TC-082 / REQ-043 DEV-052 | 新管理员完成检测、扫描、归属、首笔用量；中途跳过并重开 | 四步只根据真实状态完成；跳过无副作用且可继续 |
| TC-083 / REQ-043 DEV-052 | 普通用户查看同一引导，尝试 UI/IPC 归属并处理未授权来源 | 只能查看授权用量和请求管理员指引；无权归属，跳过与首笔用量状态正确 |
| TC-084 / REQ-044 DEV-053 | 分别制造真零、未扫描、权限不足、格式不支持、筛选无匹配、部分覆盖 | 六类文案与下一步不同；真零有完整覆盖证据；操作确实到达相应功能 |
| TC-085 / REQ-044 DEV-053 | 慢扫描、阶段停顿、解析失败、修复后重试 | 持续展示真实阶段/最近进展，不伪造百分比；诊断原因和重试结果一致 |
| TC-086 / REQ-045 DEV-054 | 两用户、一来源有既存事实；预览数量与范围后取消或确认 | 取消无变更；确认后受影响事实范围与预览一致，普通用户不能越权确认 |
| TC-087 / REQ-045 DEV-054 | 注入业务拒绝、事务失败与数据库不可写；另核成功审计字段 | 成功绑定和审计同事务；失败归属/报表不变。业务拒绝可单列最小结果；数据库不可写不得宣称审计已持久化，且不得误报成功 |
| TC-088 / REQ-046 DEV-055 | 未配置服务、服务离线/积压、恢复补传时持续本机扫描 | 未配置不显示采集故障；离线不阻断本机报表，积压/重试单列并正确恢复 |
| TC-089 / REQ-047 DEV-056 | 窄宽窗口走 Tab/Shift+Tab、Enter/Escape 与面包屑；目标 Mac 用 VoiceOver 朗读主路径 | 无遮挡，焦点可见且顺序合理；名称/状态/动作可读；人工朗读证据不借用布局自动结果 |
| TC-090 / REQ-047 DEV-056 | 不使用鼠标悬浮查看概览、趋势、排行和明细的 Token 与覆盖状态 | 精确原值与覆盖有可见文本或可聚焦可读入口，不仅藏于 `title`/tooltip |
| TC-091 / REQ-047 DEV-056 | 逐项触发引导、六类空状态、诊断重试和自动升级失败 | 文案与真实状态、角色和可执行动作一致，不把未知、未配置服务或更新失败说成已确认零/成功 |

第三批保留三个独立环境门槛：TC-076 已注册并在合成旧版的成功链路通过，真实历史旧版、只读 DMG 和打包版故障回滚仍待验；TC-072 已注册人工清单，目标 Mac 必须拒绝→授予→撤销文件权限并每步重扫，保存系统版本、独立账户和脱敏截图/日志后才可登记；TC-028 已注册人工清单，真实 Developer ID 签名、公证、Gatekeeper 和另一台目标 Mac 安装/启动/登录/采集缺一不可。没有证书或目标设备时后两项继续待验证。

## TC-092–TC-094 本地/遥测身份去重缺陷回归

2026-10-03 文档会话只用内存 SQLite 按现有 `src/main/report.ts` 的 `selectFacts` 条件复现：同一 UTC 日 Codex 本地 owner A 12 Token、遥测 owner B 99 Token，查询只返回 A。它证明当前 provider+UTC 日排除规则会丢失不同用户的独立用量；尚无修复或新用例通过。旧 TC-016 的遥测去重通过仅对应旧规则。

| 编号与关联 | 计划前置和操作 | 通过标准与边界 |
| --- | --- | --- |
| TC-092 / REQ-048 DEV-057 | 专用临时库构造同日同提供方的本地 A 12、遥测 B 99；另造共同稳定事件 ID 的重复、仅同会话但无共同事件 ID 的候选、同用户不同会话 | A/B 独立事实按各自权限保留；可证同事件仅计主来源；仅同会话的候选标冲突，不能当作已证重复；整日存在本地事实不再屏蔽 B |
| TC-093 / REQ-048 DEV-057 | 构造无法可靠关联的本地/遥测重叠、多用户筛选和时区边界；逐项核汇总、分页明细、CSV | 仅可确认独立事实进入“已确认小计”，冲突来源/条数在当前授权范围可见，整体显示“总量不可确认”；页面/CSV 不把小计称作总 Token、不静默相加候选，三处语义与数值一致，普通用户不见其他用户及原始账号/会话 ID |
| TC-094 / REQ-048 DEV-057；并回归 REQ-046 DEV-055 TC-088 | 隔离客户端和服务库造同日跨 owner 本地/遥测、同 owner 疑似重叠；检查扫描后快照、服务端持久化/查询、旧 outbox、旧协议拒绝与重试、设备令牌范围 | 上报与页面/明细/CSV 共用调和版本及同一授权事实集；跨 owner 独立保留，冲突只上传白名单小计/待核对来源与条数/总量不可确认，不伪装完整总量；旧协议或旧待传快照不得静默降级，修复/重算后 revision 幂等；无原始账号、会话 ID、路径或正文泄露，越权 403 不改旧聚合。暂停上报须显示“待核对/未同步”原因，不能写成网络离线、零用量或扫描失败 |

三项计划入口分别为 `npm run test:case -- TC-092`、`npm run test:case -- TC-093`、`npm run test:case -- TC-094`，当前**未注册、不可当成通过命令**。实施时先以 TC-092 建立失败复现，再修复 DEV-057 并复验三个编号、TC-016、TC-021–023、TC-038–040、TC-047、TC-074、TC-088 及门禁。TC-094 的服务上报路径目前只有静态代码核对，没有动态失败复现。仅用独立临时库和无正文合成记录，不读取生产数据库或真实会话。
