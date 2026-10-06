# 0.3.11 页面性能原始测量

最终补充提交：`aa3c510ce6ec691c8d95b803f99c822859542f19`，基于通过完整门禁的 `b8bba1dcf9cb0492641c9de821ecd6f52d11c47b`。开发会话于 2026-10-06 在当前 Mac（macOS 15.7.4 x86_64，Node v24.15.0）运行 `scripts/measure-navigation.mjs`，使用独立临时 `userData`、空库与 35,000 条无正文合成事实。文档会话保存并只读核算以下脱敏 JSON；没有独立重跑耗时基准。

| 文件 | 命令/范围 | 有效样本 |
| --- | --- | --- |
| `performance-cold-0.3.11.json` | `TOKEN_PERF_SKIP_BUILD=1 node scripts/measure-navigation.mjs 20 20 --cold-only`；两种数据量、1180/700px、概览与报表/来源/管理中心六个方向 | 24 组，每组 20 次；最高反馈 P95 22.1ms，最高内容 P95 934.5ms |
| `performance-warm-0.3.11.json` | `node scripts/measure-navigation.mjs 20 20 --warm-only`；同两种数据量和窗口、双向切换、长报表滚动 | 24 组导航，每组 20 次；最高反馈 P95 18.7ms，最高内容 P95 897.0ms；4 组 10 秒滚动，帧间隔 P95 最高 18.5ms，最大 18.8ms，≥200ms 长任务 0 |
| `performance-scroll-0.3.11.json` | `node scripts/measure-navigation.mjs --scroll-only`；35,000 条事实、1180/700px | 两组 10 秒滚动，各 601 帧；帧间隔 P95 最高 18.6ms，最大 18.8ms，≥200ms 长任务 0 |

上述数值为开发侧隔离合成环境结果，不证明真实生产数据、系统目录实际安装、签名或异机表现。`aa3c510` 修正冷切换返回概览的三条路径标签与采集。旧基线脚本的“返回概览”标签有误，故未把旧基线 JSON 作为完整可比证据。查询阻塞与首次滚动早测失败保留在 [`docs/validation.md`](../../docs/validation.md) 和 [`docs/CHANGELOG.md`](../../docs/CHANGELOG.md)。
