import React from 'react';
import type { CollectionDiagnostic, PublicUser, ServerStatus, TelemetryConfiguration, UpdateStatus, UploadStatus } from '../shared/types';

interface Props {
  user: PublicUser;
  server: ServerStatus | null;
  upload: UploadStatus | null;
  telemetry: TelemetryConfiguration | null;
  update: UpdateStatus | null;
  diagnostics: CollectionDiagnostic[];
  serverUrl: string;
  serverToken: string;
  adminToken: string;
  busy: boolean;
  checking: boolean;
  setServerUrl(value: string): void;
  setServerToken(value: string): void;
  setAdminToken(value: string): void;
  saveServer(event: React.FormEvent): void;
  checkUpdate(): void;
  downloadUpdate(): void;
  backupDatabase(): void;
  restoreDatabase(): void;
  openFilePermissions(): void;
}

export function SettingsPanel(props: Props) {
  const admin = props.user.role !== 'viewer';
  const permissionIssue = props.diagnostics.some(item => item.reason === 'permission_denied');
  return <div className="settings-page">
    <p className="page-lead">应用更新、服务连接、数据管理和系统权限集中在这里。</p>
    <div className="settings-grid">
      <section className="panel"><div className="panel-head"><h2>应用更新</h2><span>当前版本 {props.update?.currentVersion || '检测中'}</span></div>
        <p className="hint">从配置的更新服务器检查新版本。发现更新后先下载安装包并打开，由你完成安装。</p>
        <div className="source-actions"><button className="primary" disabled={props.checking} onClick={props.checkUpdate}>{props.checking ? '检查中…' : '检查更新'}</button>
          {props.update?.available && admin && <button className="export-button" disabled={props.busy} onClick={props.downloadUpdate}>下载并打开 {props.update.version}</button>}</div>
        <p className="hint" role="status">{props.update?.error ? `检查失败：${props.update.error}` : props.update?.available ? `发现新版本 ${props.update.version}` : props.update ? '当前已是最新版本，或服务器尚未发布安装包。' : '尚未检查更新。'}</p>
      </section>
      <section className="panel"><div className="panel-head"><h2>文件访问权限</h2><span>{permissionIssue ? '需要检查' : '按需授权'}</span></div>
        <p className="hint">Token 只读扫描 Codex 与 Claude Code 的本机会话目录。正常可读取时无需额外授权；遇到“权限不足”时，在 macOS 系统设置中手动检查“隐私与安全性 → 完全磁盘访问权限”，授权后重开应用并扫描。</p>
        <button className="export-button" onClick={props.openFilePermissions}>打开系统权限设置</button>
        <p className="hint">应用无法替你授予 macOS 权限。采集诊断会显示实际读取结果。</p>
      </section>
    </div>
    {admin && <>
      <section className="panel"><div className="panel-head"><h2>服务器与自动上报</h2><span>{props.server?.online ? '已连接' : '未连接'}</span></div>
        <p className="hint">默认连接 127.0.0.1，可改为其他服务器。每次扫描后上报已归属的聚合用量，定时扫描间隔为 10 分钟；上报内容不含会话正文、文件路径或配置密钥。连接远端服务时，首次登记或调整设备授权范围需填写服务管理密钥。</p>
        <form className="server-form" onSubmit={props.saveServer}>
          <label>服务器地址<input aria-label="服务器地址" value={props.serverUrl} onChange={e => props.setServerUrl(e.target.value)} placeholder="http://127.0.0.1:47839" /></label>
          <label>访问密钥<input aria-label="服务器访问密钥" type="password" value={props.serverToken} onChange={e => props.setServerToken(e.target.value)} placeholder="更换时填写" /></label>
          <label>管理密钥<input aria-label="服务器管理密钥" type="password" value={props.adminToken} onChange={e => props.setAdminToken(e.target.value)} placeholder="远端管理时填写" /></label>
          <button className="primary" disabled={props.busy}>保存连接</button>
        </form>
        <p className="hint">{props.server?.online ? `已连接 ${props.server.url}` : props.server?.error || '检查中'} · {props.upload?.pending ? `${props.upload.pending} 批待补传` : '无待补传'} · 最近上报 {props.upload?.lastSuccess ? new Date(props.upload.lastSuccess).toLocaleString('zh-CN') : '尚无'}{props.upload?.lastError ? ` · ${props.upload.lastError}` : ''}</p>
      </section>
      <section className="panel telemetry-panel"><div className="panel-head"><h2>可选遥测接入</h2><span>{props.telemetry?.running ? '本机接收器已就绪' : '接收器未启动'}</span></div>
        <p className="hint">本地记录会自动扫描。需要持续接收官方遥测时，手动核对并合并以下配置；应用不会覆盖已有设置。</p>
        {props.telemetry?.error && <div className="error">接收器启动失败：{props.telemetry.error}</div>}
        <details><summary>Codex 配置（~/.codex/config.toml）</summary>{props.telemetry?.codexWarning && <p className="config-warning">{props.telemetry.codexWarning}</p>}<pre>{props.telemetry?.codex}</pre></details>
        <details><summary>Claude Code 配置（启动前的终端环境）</summary>{props.telemetry?.claudeWarning && <p className="config-warning">{props.telemetry.claudeWarning}</p>}<pre>{props.telemetry?.claude}</pre></details>
        <p className="hint">遥测接收器仅监听 127.0.0.1；同一天有本地记录时，报表采用本地记录。</p>
      </section>
      <section className="panel data-panel"><div className="panel-head"><h2>数据备份与恢复</h2></div>
        <p className="hint">备份包含本机账户和用量统计数据。恢复前会保存当前数据库副本并重启应用。</p>
        <div className="source-actions"><button className="primary" onClick={props.backupDatabase}>保存备份</button><button className="text-button" onClick={props.restoreDatabase}>从备份恢复</button></div>
      </section>
    </>}
  </div>;
}
