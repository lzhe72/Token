import type { ServerStatus, SourceStatus, UploadStatus } from '../shared/types';

export function serviceLabels(server: ServerStatus | null) {
  return {
    type: !server ? '服务类型核对中' : server.serviceType === 'built_in'
      ? `内置本地服务 · ${server.configurationSource === 'explicit' ? '已显式选择' : server.configurationSource === 'legacy' ? '旧配置' : '默认'}`
      : `已配置服务器 · ${server.configurationSource === 'legacy' ? '旧配置' : '显式配置'}`,
    connection: !server ? '连接核对中' : server.reachable ? '服务可达' : '服务离线',
    authorization: !server ? '授权核对中' : server.authorization === 'authorized' ? '访问授权正常'
      : server.authorization === 'missing' ? '尚未配置访问密钥'
      : server.authorization === 'rejected' ? '访问密钥被拒绝' : '授权状态未知',
    protocol: !server ? '协议核对中' : server.protocol === 'compatible' ? '计量协议兼容'
      : server.protocol === 'incompatible' ? '计量协议不兼容' : '协议状态未知'
  };
}

export function syncLabels(upload: UploadStatus | null) {
  return {
    delivery: !upload ? '同步状态核对中' : upload.pending === null ? '同步状态请联系管理员查看' : upload.pending
      ? `${upload.pending} 批待传 · 当前修订版未同步`
      : upload.currentConfirmed ? `当前修订版 ${upload.localRevision} 已由当前服务确认`
      : upload.localRevision === null ? '尚未生成用量快照' : '当前修订版尚未由当前服务确认',
    review: !upload ? '待核对状态核对中' : upload.uncertainRows === null ? '待核对状态请联系管理员查看' : upload.uncertainRows
      ? `${upload.uncertainRows} 个聚合范围待核对 · 完整总量未知` : '无待核对聚合范围'
  };
}

export function localLabels(sources: Array<Pick<SourceStatus, 'provider' | 'status'> & { lastScan?: string | null }>) {
  if (!sources.length) return '来源采集核对中 · 当前筛选覆盖未知';
  return sources.map(source => `${source.provider === 'codex' ? 'Codex' : 'Claude Code'}：${
    source.status === 'ready' ? source.lastScan ? '最近扫描成功' : '已观测到本人记录' :
      source.status === 'cancelled' ? '扫描已取消' :
      source.status === 'error' ? '扫描异常' : source.status === 'not_found' ? '目录未找到' :
        source.status === 'scanning' ? '扫描中' : source.status === 'no_records' ? '未识别用量' : '尚未扫描'
  }`).join('；') + ' · 不证明当前筛选完整覆盖';
}
