import type { CollectionDiagnostic, PublicUser, ReportQuery, UsageReport } from '../shared/types';

export interface ReportEmptyState {
  message: string;
  action: 'clear-filters' | 'diagnostics' | 'permissions' | null;
  actionLabel: string | null;
}

export function reportEmptyState(report: UsageReport, query: ReportQuery, user: PublicUser,
  diagnostics: CollectionDiagnostic[]): ReportEmptyState {
  if (report.accounting?.status === 'uncertain') return {
    message: '此范围仅有待核对记录，完整趋势不可确认。请在明细中查看来源和计量状态。',
    action: null, actionLabel: null
  };
  if (report.coverage.length > 0 && report.coverage.every(source => source.windowCoverage?.state === 'complete')) {
    return { message: '该授权筛选范围有完整覆盖证据，已确认没有匹配的用量记录。', action: null, actionLabel: null };
  }
  if (user.role === 'viewer') return {
    message: query.model || query.projectKey
      ? '当前模型或项目筛选没有已观测记录；本人范围覆盖未知，清除筛选后可继续核对。'
      : '当前授权范围没有已观测记录，覆盖未知。请联系管理员检查来源归属和采集诊断。',
    action: query.model || query.projectKey ? 'clear-filters' : 'diagnostics',
    actionLabel: query.model || query.projectKey ? '清除模型与项目筛选' : '查看采集诊断'
  };
  const relevant = diagnostics.filter(item => query.provider === 'all' || item.provider === query.provider);
  if (relevant.some(item => item.reason === 'permission_denied')) return {
    message: '来源诊断显示文件权限不足；当前范围覆盖未知。授权后请重新扫描。',
    action: 'permissions', actionLabel: '打开系统权限设置'
  };
  if (relevant.some(item => item.reason === 'scan_cancelled')) return {
    message: '上次扫描已取消；已观测记录保留，当前范围覆盖未知。重新扫描可从已保存的进度继续。',
    action: 'diagnostics', actionLabel: '查看采集诊断'
  };
  if (relevant.some(item => ['invalid_record', 'oversized_record', 'unrecognized_usage'].includes(item.reason))) return {
    message: '来源诊断显示部分格式无法识别；当前范围覆盖未知。请查看异常记录并重试扫描。',
    action: 'diagnostics', actionLabel: '查看采集诊断'
  };
  if (relevant.some(item => item.status === 'idle' || item.reason === 'not_scanned')) return {
    message: '来源尚未扫描；当前范围覆盖未知。请先执行扫描并检查来源归属。',
    action: 'diagnostics', actionLabel: '前往扫描诊断'
  };
  if (query.model || query.projectKey) return {
    message: '当前模型或项目筛选没有已观测记录；范围覆盖仍未知，不能据此认定零用量。',
    action: 'clear-filters', actionLabel: '清除模型与项目筛选'
  };
  return {
    message: '此范围没有已观测记录；来源历史留存和连续采集尚未得到证明，完整覆盖未知。请检查来源归属或调整日期。',
    action: 'diagnostics', actionLabel: '查看采集诊断'
  };
}
