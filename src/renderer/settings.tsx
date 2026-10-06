import React, { useEffect, useState } from 'react';
import type { CollectionDiagnostic, ManagedStatus, Provider, PublicUser, ServerStatus, TelemetryConfiguration, UpdateStatus, UploadStatus } from '../shared/types';
import { localLabels, serviceLabels, syncLabels } from './service-state';
import { updateStatusLabel } from './update-state';

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
  useBuiltInServer(): void;
  retryUpload(): void;
  checkUpdate(): void;
  downloadUpdate(): void;
  backupDatabase(): void;
  restoreDatabase(): void;
  openFilePermissions(): void;
}

export function SettingsPanel(props: Props) {
  const [managed, setManaged] = useState<ManagedStatus | null>(null);
  const [managedProvider, setManagedProvider] = useState<Provider>('codex');
  const [managedDirectory, setManagedDirectory] = useState('');
  const [managedDirectoryToken, setManagedDirectoryToken] = useState('');
  const [managedPrompt, setManagedPrompt] = useState('');
  const [managedError, setManagedError] = useState('');
  const [managedBusy, setManagedBusy] = useState(false);
  useEffect(() => {
    if (props.user.role === 'viewer') return;
    let active = true;
    const refresh = () => window.tokenApi.getManagedStatus().then(value => { if (active) setManaged(value); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [props.user.id, props.user.role]);
  async function toggleManaged(provider: Provider) {
    try { setManagedBusy(true); setManagedError(''); setManaged(await window.tokenApi.setManagedEnabled(provider, !managed?.enabled[provider])); }
    catch (error) { setManagedError(String(error)); }
    finally { setManagedBusy(false); }
  }
  async function launchManaged(event: React.FormEvent) {
    event.preventDefault();
    try {
      setManagedBusy(true); setManagedError('');
      await window.tokenApi.launchManagedRun(managedProvider, managedPrompt, managedDirectoryToken);
      setManagedPrompt('');
      setManaged(await window.tokenApi.getManagedStatus());
    } catch (error) { setManagedError(String(error)); }
    finally { setManagedBusy(false); }
  }
  async function chooseManagedDirectory() {
    try {
      setManagedError('');
      const selected = await window.tokenApi.chooseManagedDirectory();
      if (selected) { setManagedDirectory(selected.directory); setManagedDirectoryToken(selected.token); }
    } catch (error) { setManagedError(String(error)); }
  }
  const admin = props.user.role !== 'viewer';
  const permissionIssue = props.diagnostics.some(item => item.reason === 'permission_denied');
  const service = serviceLabels(props.server);
  const sync = syncLabels(props.upload);
  const local = localLabels(props.diagnostics);
  return <div className="settings-page">
    <p className="page-lead">应用更新、服务连接、数据管理和系统权限集中在这里。</p>
    <div className="settings-grid">
      <section className="panel"><div className="panel-head"><h2>应用更新</h2><span>当前版本 {props.update?.currentVersion || '检测中'}</span></div>
        <p className="hint">从配置的更新服务器检查新版本。下载并校验后，应用会退出、自动安装并启动新版。</p>
        <div className="source-actions"><button className="primary" disabled={props.checking} onClick={props.checkUpdate}>{props.checking ? '检查中…' : '检查更新'}</button>
          {props.update?.available && admin && <button className="export-button" disabled={props.busy} onClick={props.downloadUpdate}>下载并更新到 {props.update.version}</button>}</div>
        <p className="hint" role="status">{updateStatusLabel(props.update)}</p>
      </section>
      <section className="panel"><div className="panel-head"><h2>文件访问权限</h2><span>{permissionIssue ? '需要检查' : '按需授权'}</span></div>
        <p className="hint">Token 只读扫描 Codex 与 Claude Code 的本机会话目录。正常可读取时无需额外授权；遇到“权限不足”时，在 macOS 系统设置中手动检查“隐私与安全性 → 完全磁盘访问权限”，授权后重开应用并扫描。</p>
        <button className="export-button" onClick={props.openFilePermissions}>打开系统权限设置</button>
        <p className="hint">应用无法替你授予 macOS 权限。采集诊断会显示实际读取结果。</p>
      </section>
    </div>
    {admin && <section className="panel managed-panel"><div className="panel-head"><h2>受管命令（试运行）</h2><span>覆盖证明：未知</span></div>
      <p className="hint">主动启用后，可通过 Token 启动只读 Codex 或计划模式 Claude Code 命令。应用只保存运行状态、版本和计量字段；任务内容与回复仅在当前窗口临时显示、不写入 Token 数据库。登录者是启动者，尚未验证 CLI 账户归属；账本未进入报表，完整性与其他入口的使用量均为未知。</p>
      <div className="source-actions">
        {(['codex', 'claude'] as Provider[]).map(provider => <button type="button" key={provider}
          className="export-button" disabled={managedBusy} onClick={() => toggleManaged(provider)}>
          {provider === 'codex' ? 'Codex' : 'Claude Code'}：{managed?.enabled[provider] ? '已启用 · 点击关闭' : '未启用 · 点击开启'}
        </button>)}
      </div>
      <form className="managed-form" onSubmit={launchManaged}>
        <label>工具<select aria-label="受管工具" value={managedProvider} onChange={event => setManagedProvider(event.target.value as Provider)}>
          <option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
        <label>工作目录<input aria-label="受管工作目录" value={managedDirectory} readOnly placeholder="请先选择真实目录" /></label>
        <button type="button" className="export-button" onClick={chooseManagedDirectory}>选择工作目录</button>
        <label>只读任务<textarea aria-label="受管任务" value={managedPrompt} onChange={event => setManagedPrompt(event.target.value)} rows={3} placeholder="输入要运行的任务；Token 不保存正文" /></label>
        <button className="primary" disabled={managedBusy || !managed?.enabled[managedProvider] || !managedDirectoryToken || !managedPrompt.trim()}>启动受管命令</button>
      </form>
      {managedError && <p className="error" role="alert">{managedError}</p>}
      <div aria-label="最近受管运行" className="managed-runs">{managed?.runs.map(run => <div key={run.id}>
        <p>{run.provider === 'codex' ? 'Codex' : 'Claude Code'} · {run.status === 'running' ? '运行中' : run.status === 'completed' ? '命令已结束' : '未完成'} · {new Date(run.startedAt).toLocaleString('zh-CN')} · 已记录事件 {run.eventCount}，计量事件 {run.usageEventCount}{run.error ? ` · ${run.error}` : ''}</p>
        {run.result && <details><summary>查看本次结果（仅当前应用会话）</summary><pre>{run.result}</pre></details>}
      </div>)}</div>
    </section>}
    {admin && <>
      <section className="panel"><div className="panel-head"><h2>服务器与自动上报</h2><span>{service.type}</span></div>
        <p className="hint">内置服务默认运行在本机；也可显式连接指定服务器，地址允许 127.0.0.1。每次扫描后上报已归属的聚合用量，定时扫描间隔为 10 分钟；上报内容不含会话正文、文件路径或配置密钥。首次登记或调整设备授权范围需服务管理密钥。</p>
        <div className="service-state-grid" role="group" aria-label="服务连接与同步状态"><span><strong>服务连接</strong>{service.connection} · {props.server?.url || '地址核对中'}</span><span><strong>访问授权</strong>{service.authorization}</span><span><strong>计量协议</strong>{service.protocol}</span><span><strong>用量同步</strong>{sync.delivery}</span><span><strong>待核对</strong>{sync.review}</span><span><strong>本机采集与覆盖</strong>{local}</span></div>
        <div className="source-actions"><button type="button" className="export-button" disabled={props.busy} onClick={props.useBuiltInServer}>使用内置本机服务</button>{Boolean(props.upload?.pending) && <button type="button" className="export-button" disabled={props.busy} onClick={props.retryUpload}>立即重试上报</button>}<span>保存下方地址会切换为显式配置；即使地址相同，配置来源仍会区分。</span></div>
        <form className="server-form" onSubmit={props.saveServer}>
          <label>服务器地址<input aria-label="服务器地址" value={props.serverUrl} onChange={e => props.setServerUrl(e.target.value)} placeholder="http://127.0.0.1:47839" /></label>
          <label>访问密钥<input aria-label="服务器访问密钥" type="password" value={props.serverToken} onChange={e => props.setServerToken(e.target.value)} placeholder="更换时填写" /></label>
          <label>管理密钥<input aria-label="服务器管理密钥" type="password" value={props.adminToken} onChange={e => props.setAdminToken(e.target.value)} placeholder="远端管理时填写" /></label>
          <button className="primary" disabled={props.busy}>保存连接</button>
        </form>
        <p className="hint">最近成功上报 {props.upload?.lastSuccess ? new Date(props.upload.lastSuccess).toLocaleString('zh-CN') : '尚无'}。{props.upload?.lastError ? `最近失败：${props.upload.lastError}` : ''}{props.server?.error ? `服务提示：${props.server.error}` : ''}</p>
      </section>
      <section className="panel telemetry-panel"><div className="panel-head"><h2>可选遥测接入</h2><span>{props.telemetry?.running ? '本机接收器已就绪' : '接收器未启动'}</span></div>
        <p className="hint">本地记录会自动扫描。需要持续接收官方遥测时，手动核对并合并以下配置；应用不会覆盖已有设置。</p>
        {props.telemetry?.error && <div className="error">接收器启动失败：{props.telemetry.error}</div>}
        <details><summary>Codex 配置（~/.codex/config.toml）</summary>{props.telemetry?.codexWarning && <p className="config-warning">{props.telemetry.codexWarning}</p>}<pre>{props.telemetry?.codex}</pre></details>
        <details><summary>Claude Code 配置（启动前的终端环境）</summary>{props.telemetry?.claudeWarning && <p className="config-warning">{props.telemetry.claudeWarning}</p>}<pre>{props.telemetry?.claude}</pre></details>
        <p className="hint">遥测接收器仅监听 127.0.0.1。报表按授权用户与会话保留可证独立事实；疑似重叠的记录标为待核对，完整总量不可确认。可在用量报表查看明细与来源后处理。</p>
      </section>
      <section className="panel data-panel"><div className="panel-head"><h2>数据备份与恢复</h2></div>
        <p className="hint">备份包含本机账户和用量统计数据。恢复前会保存当前数据库副本并重启应用。</p>
        <div className="source-actions"><button className="primary" onClick={props.backupDatabase}>保存备份</button><button className="text-button" onClick={props.restoreDatabase}>从备份恢复</button></div>
      </section>
    </>}
  </div>;
}
