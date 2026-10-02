// Keep these IDs aligned with the canonical traceability workbook in outputs/.
const app = ['e2e', 'tests/e2e/app.spec.ts', '管理员创建、用户管理与普通用户权限'];
const collector = ['unit', 'tests/collector.test.ts'];
const report = ['unit', 'tests/report.test.ts', '报表按本地时区与 ISO 周汇总，并限制普通用户归属'];
const telemetry = ['unit', 'tests/telemetry.test.ts', '本机遥测只接受密钥，Codex 去重，Claude 累计点计算增量，报表避免双来源相加'];
const cases = [
  ['TC-001', 'manual', '本机来源字段抽样', '在当前版本检查可读取的 Codex 与 Claude Code 文件；只记录结构、字段口径、脱敏统计和未知项。'],
  ['TC-002', ...app, '首次创建与重启登录'],
  ['TC-003', 'unit', 'tests/auth.test.ts', '首次管理员、重启后的登录和失败尝试限速', '重复初始化和登录限速'],
  ['TC-004', ...app, '用户创建与权限隔离'],
  ['TC-005', ...app, '管理 IPC 拒绝越权'],
  ['TC-006', 'manual', 'Codex 真实样本逐条核对', '用两段当前版本的只读 Codex 多模型样本独立计算，并与采集结果逐条比对；不复制真实正文到仓库。'],
  ['TC-007', ...collector, '模型切换与 Claude 子代理记录按实际模型归档', 'Codex 模型切换'],
  ['TC-008', 'manual', 'Claude 真实样本逐条核对', '用两段当前版本的只读 Claude 多模型和子代理样本独立计算，并与采集结果逐条比对；不复制真实正文到仓库。'],
  ['TC-009', ...collector, '两个采集器按请求去重，重扫和增量扫描不重复计数', 'Claude 请求重复归并'],
  ['TC-010', ...collector, '两个采集器按请求去重，重扫和增量扫描不重复计数', '重复扫描和重启幂等'],
  ['TC-011', ...collector, '未写完的末行等待补齐，截断重写后不重复统计', '末行、截断与轮转'],
  ['TC-012', ...collector, '两个采集器按请求去重，重扫和增量扫描不重复计数', 'Codex 缓存子集不重加'],
  ['TC-013', ...collector, '两个采集器按请求去重，重扫和增量扫描不重复计数', 'Claude 四类 Token 合计'],
  ['TC-014', ...telemetry, '遥测密钥和监听范围'],
  ['TC-015', 'unit', 'tests/telemetry.test.ts', '遥测配置提示现有用户设置而不修改文件', '现有配置只读检查'],
  ['TC-016', ...telemetry, '遥测幂等和重叠优先级'],
  ['TC-017', 'e2e', 'tests/e2e/source-status.spec.ts', '工具目录缺失、无权限和空目录有清晰状态', '缺失和不可读来源状态'],
  ['TC-018', ...collector, '空目录、错误字段及不可读文件显示可辨认的状态', '无效 Token 字段持续报错'],
  ['TC-019', ...app, '绑定后权限和报表更新'],
  ['TC-020', ...report, '时区和 ISO 跨年周'],
  ['TC-021', ...report, '筛选与分页明细'],
  ['TC-022', ...app, 'CSV 与页面结果一致'],
  ['TC-023', ...report, 'CSV 公式注入转义'],
  ['TC-024', 'unit', 'tests/backup.test.ts', '数据库备份完整性校验并保留账户与用量', '备份完整性'],
  ['TC-025', 'e2e', 'tests/e2e/restore.spec.ts', '管理员备份、恢复后账户回到备份状态', '恢复前副本和状态回退'],
  ['TC-026', ...app, '跨进程权限和数据边界'],
  ['TC-027', 'manual', '未签名 DMG 本机验收', '对本次构建的 DMG 执行 hdiutil verify；挂载并复制 Token.app；在当前 Mac 启动、登录、采集并留存脱敏结果。'],
  ['TC-028', 'manual', '签名公证及目标 Mac 验收', '在发布环境签名、公证；在另一台目标 Mac 安装并完成启动、登录和采集。当前没有此项通过证据。'],
  ['TC-029', 'unit', 'tests/next-report.test.ts', 'TC-029 CSV 表头和数据列对齐', 'CSV 表头与数据列对齐'],
  ['TC-030', 'unit', 'tests/next-auth.test.ts', 'TC-030 勾选信任后重启恢复且未勾选不恢复', '信任设备恢复登录'],
  ['TC-031', 'unit', 'tests/next-auth.test.ts', 'TC-031 退出停用重置密码撤销受信凭证', '撤销与账户失效'],
  ['TC-032', 'unit', 'tests/next-server.test.ts', 'TC-032 服务默认地址可配置且停服不影响本机数据库', '服务地址与本机数据边界'],
  ['TC-033', 'unit', 'tests/next-server.test.ts', 'TC-033 更新清单与包哈希一致且拒绝路径穿越', '清单与包'],
  ['TC-034', 'unit', 'tests/next-update.test.ts', 'TC-034 只提示较新且架构匹配的版本并校验包摘要', '版本与摘要'],
  ['TC-035', 'unit', 'tests/next-update.test.ts', 'TC-035 停服和下载失败可重试且不留临时包', '服务与下载故障'],
  ['TC-036', 'unit', 'tests/next-update.test.ts', 'TC-036 校验后只打开安装包而不替换现有应用', '未签名安装包交接'],
  ['TC-037', 'unit', 'tests/next-sync.test.ts', 'TC-037 启动及十分钟定时扫描并串行执行', '三种扫描触发'],
  ['TC-038', 'unit', 'tests/next-sync.test.ts', 'TC-038 聚合上报只含授权用量字段不含正文路径密钥', '聚合隐私'],
  ['TC-039', 'unit', 'tests/next-sync.test.ts', 'TC-039 重复上报幂等且修订快照替换旧值', '幂等和修订'],
  ['TC-040', 'unit', 'tests/next-sync.test.ts', 'TC-040 停服后待传快照持久化并恢复补传', '离线补传'],
  ['TC-041', 'unit', 'tests/next-report.test.ts', 'TC-041 K M P 1024 进位且原值保留在 CSV', '单位和原值'],
  ['TC-042', 'unit', 'tests/next-report.test.ts', 'TC-042 概览等长区间比较与未知基期', '概览比较'],
  ['TC-043', 'unit', 'tests/next-report.test.ts', 'TC-043 日周月趋势点击下钻保持同一时间桶', '趋势下钻'],
  ['TC-044', 'unit', 'tests/next-report.test.ts', 'TC-044 模型排行总量降序且同值稳定', '模型排行'],
  ['TC-045', 'unit', 'tests/next-report.test.ts', 'TC-045 已覆盖零与未覆盖错误状态分开显示', '零和未知'],
  ['TC-046', 'unit', 'tests/next-report.test.ts', 'TC-046 来源状态和最近扫描时间一致', '来源状态'],
  ['TC-047', 'unit', 'tests/next-server.test.ts', 'TC-047 上报接口鉴权和字段白名单', '接口鉴权'],
  ['TC-048', 'e2e', 'tests/e2e/trend.spec.ts', 'TC-048 趋势图宽窄窗口自适应且数值日期不重叠', '趋势图窗口缩放'],
  ['TC-049', 'e2e', 'tests/e2e/trend.spec.ts', 'TC-049 周横轴显示周一日期月横轴显示年月且下钻一致', '周月日期标签']
];
const extraRuns = {
  'TC-030': [{ kind: 'e2e', file: 'tests/e2e/trust.spec.ts', testName: 'TC-030 应用重启自动登录并在退出后撤销' }],
  'TC-038': [{ kind: 'e2e', file: 'tests/e2e/upload.spec.ts', testName: 'TC-038 应用扫描后自动上报到独立本机服务' }],
  'TC-010': [{ kind: app[0], file: app[1], testName: app[2] }],
  'TC-017': [{ kind: collector[0], file: collector[1], testName: '空目录、错误字段及不可读文件显示可辨认的状态' }],
  'TC-021': [{ kind: app[0], file: app[1], testName: app[2] }]
};
export default cases.map(([id, kind, fileOrTitle, testNameOrSteps, title]) => kind === 'manual'
  ? { id, kind, title: fileOrTitle, steps: testNameOrSteps }
  : { id, kind, title, runs: [{ kind, file: fileOrTitle, testName: testNameOrSteps }, ...(extraRuns[id] || [])] });
