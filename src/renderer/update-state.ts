import type { UpdateStatus } from '../shared/types';

export function updateStatusLabel(update: UpdateStatus | null): string {
  if (!update) return '尚未检查更新。';
  if (update.error) return `检查失败：${update.error}`;
  if (update.available) return `发现新版本 ${update.version}`;
  if (update.reason === 'no_package') return '更新服务器尚未发布安装包。';
  if (update.reason === 'incompatible') return `服务器安装包为 ${update.packageArch} 架构，与本机不匹配。`;
  return `服务器安装包版本 ${update.version}，当前版本 ${update.currentVersion}，暂无更新。`;
}
