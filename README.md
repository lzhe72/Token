# Token

Token 是一个 macOS 桌面应用，用于汇总本机 Codex 与 Claude Code 的 Token 消耗，并按用户、工具、模型和时间查看报表。

项目文档：

- [文档总览与维护顺序](docs/README.md)
- [需求、开发任务与测试追溯工作簿](outputs/20261002-token-docs/Token-需求开发测试追溯.xlsx)
- [Codex 项目技术指南](docs/agent.md)
- [产品与技术设计](docs/design.md)
- [开发计划与验收标准](docs/development-plan.md)
- [M0 本机数据可行性验证](docs/feasibility.md)
- [验收记录（首版、M5 与 M6）](docs/validation.md)
- [项目变更日志](docs/CHANGELOG.md)

第一版定位为本机离线应用。M5 增加独立服务，用于更新包和已归属用量的聚合快照；默认在本机 `127.0.0.1:47839` 通信，监听与连接地址可配置。跨设备同步与云端账户管理仍不在当前验收范围内。

## 当前版本

- 仓库当前版本为 **0.3.12**。GitHub [v0.3.12 预发布页](https://github.com/lzhe72/Token/releases/tag/v0.3.12)提供未签名 x64 DMG：`Token-0.3.12-x64.dmg`，SHA-256：`01b25b0b9fda31fd28862e612e0125c6743b84b182af0c4c2eea6fa6b34bb21a`。发布页与[验收记录](docs/validation.md)可核对制品状态。
- Apple Silicon（arm64）DMG 已发布：[Token-0.3.12-arm64.dmg](https://github.com/lzhe72/Token/releases/download/v0.3.12/Token-0.3.12-arm64.dmg)，大小 138,722,813 字节，SHA-256 `78c99d9c3bc81519899f630a7358f25745dbe12b4db9dc4faf4c00dc5036e0f7`。DMG `hdiutil verify` 有效，包内主程序与 Electron Framework 均为 arm64，Info.plist 版本 0.3.12，`app.asar` SHA-256 为 `3f02efcef6be261165869d38445c6658199b53a97bbd4b8ddbb45a32d007390b`。这些制品核验不代表 M 系列目标机安装和使用验收通过。
- 自动更新服务当前仅覆盖 x64。Apple Silicon 用户请以发布页上确认的 arm64 安装包为准；不要假定应用内“检查更新”已提供 arm64 更新。
- 0.3.12 的隔离自动测试和 x64 候选验收见[版本与测试记录](docs/validation.md)。生产用户手动验收及完整交付状态以追溯工作簿和该记录为准；GitHub 预发布不等于签名公证或 arm64 已验收。

## 使用流程

1. 首次启动创建固定用户名 `admin` 的本地超级管理员账户；登录时可主动勾选“信任此设备”，手动退出会撤销信任。旧库的普通管理员继续保留原权限。
2. 应用启动时扫描当前 macOS 账户可读取的 `~/.codex/sessions` 与 `~/.claude/projects`，之后每 10 分钟扫描；管理员可在“数据来源”页立即扫描、查看采集/上报状态并把来源绑定到应用用户。完整扫描后向配置的独立服务上传聚合快照。
3. 在“用量报表”页选择日期、日/周/月/年、工具、项目、模型、用户和统计时区。点击趋势柱、项目或模型可追溯分页明细；页面按 1024 逐级使用 K→M→P 显示，并提供可用键盘操作的原始 Token 整数复制按钮；CSV 保留原始整数。项目键与展示名留在本机，完整工作目录不进入服务端聚合或反馈。
4. 在“系统设置”查看服务器、更新与文件访问指引，在“采集诊断”定位漏采；用户可预览并提交脱敏问题反馈，管理员在“管理中心”查看反馈、账号和采集状态。管理员仍可备份 SQLite 数据库或从备份恢复；恢复会先保存当前数据库副本，再重启应用。

## 下载与安装

1. 优先在“关于本机”确认 Mac 架构；也可在原生终端运行 `uname -m`：`x86_64` 对应 x64；`arm64` 对应 Apple Silicon。若终端通过 Rosetta 运行，命令可能显示 `x86_64`，此时以“关于本机”为准。下载与架构匹配的 DMG，只从上方链接的 GitHub Release 获取。
2. 对已发布 x64 附件可先核对摘要：

   ```sh
   shasum -a 256 ~/Downloads/Token-0.3.12-x64.dmg
   hdiutil verify ~/Downloads/Token-0.3.12-x64.dmg
   ```

   SHA-256 应为 `01b25b0b9fda31fd28862e612e0125c6743b84b182af0c4c2eea6fa6b34bb21a`，`hdiutil verify` 应报告有效。Apple Silicon 可运行以下命令核对 [arm64 DMG](https://github.com/lzhe72/Token/releases/download/v0.3.12/Token-0.3.12-arm64.dmg)：

   ```sh
   shasum -a 256 ~/Downloads/Token-0.3.12-arm64.dmg
   hdiutil verify ~/Downloads/Token-0.3.12-arm64.dmg
   ```

   arm64 SHA-256 应为 `78c99d9c3bc81519899f630a7358f25745dbe12b4db9dc4faf4c00dc5036e0f7`；不得用 x64 的值核对 arm64 包。
3. 双击 DMG，将 `Token.app` 拖入“应用程序”文件夹，推出已挂载的磁盘映像，再从“应用程序”打开 Token。首次运行按引导创建固定用户名 `admin` 的本地管理员账户并登录；请自行设置并保管密码。
4. 本候选未签名，macOS 可能显示无法验证开发者或无法检查恶意软件的提示。只对来源、架构和 SHA-256 均已核实且获准本机验收的候选按项目验收安排处理系统提示；不要关闭 Gatekeeper、降低全局安全设置或对未知文件移除隔离属性。若系统仍阻止打开或签名状态与预期不符，停止安装并反馈提示内容，等待已确认的处理指引。
5. 管理员登录后检查“数据来源”/“采集诊断”，运行来源扫描并确认 Codex、Claude Code 各自显示的状态；在“用量报表”核对时间范围、工具来源、已确认小计/待核对状态，并尝试导出 CSV。来源无法读取时按页面提示检查 macOS“隐私与安全性”中的文件访问权限，授权后重开应用并重新扫描。不要为验收把真实会话正文、数据库、凭证或包含正文的日志发到仓库。
6. 在“系统设置 → 应用更新”可以查看当前版本和检查更新。当前本机更新服务只覆盖 x64；Apple Silicon 用户如没有对应 arm64 更新，应从 Release 选择已确认的 arm64 DMG，不要安装不同架构包替代。

### Apple Silicon 人工验收清单

arm64 制品本身已核验；M 系列目标 Mac 的安装和使用仍**待目标用户执行，不代表已通过**。Intel host 无法运行 arm64 包，不得将 x64 测试结果记作 arm64 通过：

- 确认机器为 Apple Silicon、下载上述 Release arm64 附件，并记录 DMG SHA-256、macOS 版本和时间；运行 `hdiutil verify`。
- 安装至“应用程序”，记录系统安全提示及处理过程；首次启动、创建/登录 `admin`，关闭并重新打开后检查登录状态。
- 检查 Codex/Claude 来源状态并执行扫描；在 macOS 拒绝目录读取时检查权限指引、授权、重开应用，再次扫描并记录变化。
- 检查报表日期/时区、工具和模型筛选、明细与待核对状态；导出 CSV 并确认列和数值可读取。只留脱敏截图/摘要，不保存会话正文。
- 检查“系统设置”中的版本、更新检查和更新入口。当前更新服务仅 x64；记录 arm64 客户端实际显示，不将 x64 服务结果记作 arm64 更新通过。
- 将启动、登录、扫描、报表/导出、权限及更新结果和失败提示保存到仓库外的脱敏证据文件；由目标用户实际执行后，才可按相应用例登记人工结果。

## 可选官方遥测

“系统设置”页提供 Codex 与 Claude Code 的本机遥测配置片段，并只读检查现有用户设置，发现已有遥测配置时提示核对。接收器只监听 `127.0.0.1:43188`，要求每次请求带安装时生成的随机密钥，并只保存用量字段。配置片段含密钥，只在管理员登录后显示；不要共享。应用不会修改现有工具设置或组织管理配置。

- Codex：将页面中的 `[otel]` 配置合并到 `~/.codex/config.toml`。若已有 `[otel]` 段或其他导出目标，先人工核对，不要重复添加。
- Claude Code：在启动 Claude Code 的终端设置页面列出的环境变量。若已有 OTLP 指标目标或受管理设置，请先人工核对。
- 当前报表、明细、CSV 与聚合上报按授权用户和会话保留可证独立事实；疑似重叠标为待核对，完整总量不可确认。REQ-048/TC-092–094 的隔离自动子范围已验证，真实生产库迁移和共同事件身份的正向精确去重仍待验；未观察到来源记录不能解释为已确认零或完整覆盖。

配置依据：[Codex OpenTelemetry](https://learn.chatgpt.com/docs/config-file/config-advanced)、[Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)。

## 测试与开发

开发环境要求 macOS、Node.js 24 和 npm。以下命令在仓库根目录执行；自动测试应使用测试运行器创建的一次性数据库、合成样本和隔离 `userData`。自动测试不得安装、写入或迁移真实 `/Applications/Token.app` 的用户数据。真实安装、权限与目标架构验收必须由目标用户按人工清单执行。

```sh
npm ci
npm run test:cases:check
npm run test:case -- TC-###
npm run test:gate
```

- `npm ci`：按锁文件安装开发依赖。
- `npm run test:cases:check`：检查所有 `TC-###` 编号均注册并具有可执行入口。
- `npm run test:case -- TC-###`：按唯一编号运行一条测试；将占位编号换成追溯工作簿中本轮涉及的编号。人工用例会给出操作清单，必须实际完成并提供脱敏证据才能登记通过。
- `npm run test:gate`：依次执行类型检查、编号检查、全部单元测试及 Electron Playwright 测试。

涉及目录包行为时，先构建再运行打包应用 E2E：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
npm run test:e2e:packaged
```

第一条生成 `release/mac/Token.app`；第二条对该目录包运行 Playwright。目录包测试不等于 DMG 安装或目标 Mac 人工验收。新增/变更功能先更新对应 REQ/DEV/TC，再按[SOP-004](docs/sop/04-test-acceptance.md)逐项验证并记录提交、架构、命令、退出码和脱敏证据。测试命令、单项覆盖及数据隔离细节见[测试执行说明](docs/testing.md)；项目开发与发布行为遵守[项目 SOP](docs/sop/README.md)及[技术指南](docs/agent.md)。
