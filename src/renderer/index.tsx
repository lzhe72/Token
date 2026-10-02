import React from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, PublicUser, Role, ServerStatus, SourceIdentity, SourceStatus, TelemetryConfiguration, UpdateStatus, UploadStatus } from '../shared/types';
import { ReportPanel } from './report';
import { OverviewPanel } from './overview';
import './style.css';

function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function sourceStatusLabel(status?: SourceStatus): string {
  switch (status?.status) {
    case 'ready': return '已采集';
    case 'scanning': return '扫描中';
    case 'no_records': return '暂无记录';
    case 'not_found': return '未找到';
    case 'error': return '需要检查';
    default: return '等待扫描';
  }
}

function App() {
  const [state, setState] = React.useState<AppState | null>(null);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [tab, setTab] = React.useState<'overview' | 'report' | 'sources' | 'users'>('overview');
  const [users, setUsers] = React.useState<PublicUser[]>([]);
  const [sourceStatuses, setSourceStatuses] = React.useState<SourceStatus[]>([]);
  const [sourceIdentities, setSourceIdentities] = React.useState<SourceIdentity[]>([]);
  const [telemetry, setTelemetry] = React.useState<TelemetryConfiguration | null>(null);
  const [server, setServer] = React.useState<ServerStatus | null>(null);
  const [upload, setUpload] = React.useState<UploadStatus | null>(null);
  const [update, setUpdate] = React.useState<UpdateStatus | null>(null);
  const [serverUrl, setServerUrl] = React.useState('');
  const [serverToken, setServerToken] = React.useState('');
  const [newUsername, setNewUsername] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newRole, setNewRole] = React.useState<Role>('viewer');
  const [resetUser, setResetUser] = React.useState<PublicUser | null>(null);
  const [resetPassword, setResetPassword] = React.useState('');

  React.useEffect(() => {
    window.tokenApi.getState().then(setState).catch(e => setError(errorMessage(e)));
  }, []);

  React.useEffect(() => {
    if (!state?.user) return;
    const refresh = () => {
      void window.tokenApi.getSourceStatuses().then(setSourceStatuses).catch(() => {});
      void window.tokenApi.getServerStatus().then(value => { setServer(value); setServerUrl(current => current || value.url); }).catch(() => {});
      void window.tokenApi.getUploadStatus().then(setUpload).catch(() => {});
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [state?.user?.id]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      const user = state.needsSetup
        ? await window.tokenApi.setupAdmin(username, password, trustDevice)
        : await window.tokenApi.login(username, password, trustDevice);
      setState({ needsSetup: false, user });
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await window.tokenApi.logout();
    setState({ needsSetup: false, user: null });
    setUsers([]);
    setTab('overview');
  }

  async function showUsers() {
    setError('');
    try {
      setUsers(await window.tokenApi.listUsers());
      setTab('users');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function showSources() {
    setError('');
    try {
      const [identities, allUsers, configuration] = await Promise.all([
        window.tokenApi.getSourceIdentities(), window.tokenApi.listUsers(), window.tokenApi.getTelemetryConfiguration()
      ]);
      setSourceIdentities(identities);
      setUsers(allUsers);
      setTelemetry(configuration);
      setTab('sources');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function saveServer(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await window.tokenApi.configureServer(serverUrl, serverToken);
      setServer(result);
      setServerToken('');
      setNotice(result.online ? '服务器连接已更新。' : '服务器地址已保存，当前无法连接。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function checkUpdate() {
    setError('');
    try { setUpdate(await window.tokenApi.checkUpdate()); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  async function downloadUpdate() {
    setBusy(true);
    setError('');
    try {
      await window.tokenApi.downloadUpdate();
      setNotice('安装包已校验并打开，请按 macOS 提示完成安装。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function showReport() {
    setError('');
    try {
      if (state?.user?.role === 'admin') setUsers(await window.tokenApi.listUsers());
      setTab('report');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function scanSources() {
    setBusy(true);
    setError('');
    try {
      setSourceStatuses(await window.tokenApi.scanSources());
      setSourceIdentities(await window.tokenApi.getSourceIdentities());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function bindSource(key: string, userId: string | null) {
    setError('');
    try {
      await window.tokenApi.bindSourceIdentity(key, userId);
      setSourceIdentities(await window.tokenApi.getSourceIdentities());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function backupDatabase() {
    setError('');
    setNotice('');
    try { if (await window.tokenApi.backupDatabase()) setNotice('数据库备份已保存。'); }
    catch (e) { setError(errorMessage(e)); }
  }

  async function restoreDatabase() {
    setError('');
    setNotice('');
    try { await window.tokenApi.restoreDatabase(); }
    catch (e) { setError(errorMessage(e)); }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await window.tokenApi.createUser(newUsername, newPassword, newRole);
      setUsers(await window.tokenApi.listUsers());
      setNewUsername('');
      setNewPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: PublicUser) {
    setError('');
    try {
      await window.tokenApi.setUserActive(user.id, !user.active);
      setUsers(await window.tokenApi.listUsers());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetUser) return;
    setBusy(true);
    setError('');
    try {
      await window.tokenApi.changePassword(resetUser.id, resetPassword);
      setResetUser(null);
      setResetPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <div className="loading">正在打开 Token…</div>;

  if (!state.user) return (
    <div className="auth-shell">
      <div className="brand-block"><div className="brand-mark">T</div><h1>看清每一个 Token</h1><p>在一处查看本机 Codex 与 Claude Code 的使用情况。</p><div className="brand-foot">PRIVATE BY DESIGN · LOCAL FIRST</div></div>
      <form className="auth-card" onSubmit={submitAuth}>
        <span className="eyebrow">TOKEN MONITOR</span>
        <h2>{state.needsSetup ? '创建管理员账户' : '欢迎回来'}</h2>
        <p>{state.needsSetup ? '先设置本机管理员，即可开始连接用量来源。' : '登录后查看属于你的用量报表。'}</p>
        <label>用户名<input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="例如 lzhe72" /></label>
        <label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={state.needsSetup ? 'new-password' : 'current-password'} placeholder={state.needsSetup ? '至少 10 位' : '输入密码'} /></label>
        <label className="trust-option"><input type="checkbox" checked={trustDevice} onChange={e => setTrustDevice(e.target.checked)} />信任此设备，保持登录直到手动退出</label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? '请稍候…' : state.needsSetup ? '创建并进入' : '登录'}</button>
        <small>登录凭证由本机安全存储保护。</small>
      </form>
    </div>
  );

  const codexStatus = sourceStatuses.find(source => source.provider === 'codex');
  const claudeStatus = sourceStatuses.find(source => source.provider === 'claude');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="app-logo"><span>T</span><strong>Token</strong></div>
        <div className="nav-group"><div className="nav-label">工作台</div>
          <button className={tab === 'overview' ? 'nav active' : 'nav'} onClick={() => setTab('overview')}><span>◫</span> 概览</button>
          <button className={tab === 'report' ? 'nav active' : 'nav'} onClick={showReport}><span>▤</span> 用量报表</button>
          {state.user.role === 'admin' && <button className={tab === 'sources' ? 'nav active' : 'nav'} onClick={showSources}><span>◇</span> 数据来源</button>}
          {state.user.role === 'admin' && <button className={tab === 'users' ? 'nav active' : 'nav'} onClick={showUsers}><span>♙</span> 用户管理</button>}
        </div>
        <div className="sidebar-bottom"><div className="avatar">{state.user.username.slice(0, 1).toUpperCase()}</div><div><strong>{state.user.username}</strong><small>{state.user.role === 'admin' ? '管理员' : '普通用户'}</small></div><button className="logout" onClick={logout} aria-label="退出登录" title="退出登录">↪</button></div>
      </aside>
      <main className="main-content">
        <header><div><span className="eyebrow">TOKEN MONITOR</span><h1>{tab === 'users' ? '用户管理' : tab === 'sources' ? '数据来源' : tab === 'report' ? '用量报表' : '用量概览'}</h1></div><div className="date-chip">{server?.online ? '服务已连接' : '本机运行'}</div></header>
        {error && <div className="error banner" role="alert">{error}</div>}
        {notice && <div className="notice banner" role="status">{notice}</div>}
        {tab === 'overview' ? <OverviewPanel sources={sourceStatuses} server={server} upload={upload} update={update}
          onCheckUpdate={checkUpdate} onDownloadUpdate={downloadUpdate} onReport={showReport} />
        : tab === 'report' ? <ReportPanel user={state.user} users={users} /> : tab === 'sources' ? <>
          <p className="page-lead">只读取当前 macOS 账户可访问的本机会话记录。采集器不会保存提示词、回复正文或源码。</p>
          <div className="source-grid"><div className="source-card"><div className="source-icon codex">◈</div><div><h3>Codex</h3><p>{codexStatus?.detail || `${codexStatus?.fileCount ?? 0} 个会话文件 · ${codexStatus?.factCount ?? 0} 条本地 · ${codexStatus?.telemetryFactCount ?? 0} 条遥测`}</p></div><span className="status-pill">{sourceStatusLabel(codexStatus)}</span></div><div className="source-card"><div className="source-icon claude">✳</div><div><h3>Claude Code</h3><p>{claudeStatus?.detail || `${claudeStatus?.fileCount ?? 0} 个会话文件 · ${claudeStatus?.factCount ?? 0} 条本地 · ${claudeStatus?.telemetryFactCount ?? 0} 条遥测`}</p></div><span className="status-pill">{sourceStatusLabel(claudeStatus)}</span></div></div>
          <div className="source-actions"><button className="primary" disabled={busy} onClick={scanSources}>{busy ? '扫描中…' : '立即扫描'}</button><span>首次导入大量历史记录可能需要几分钟。</span></div>
          <section className="panel"><div className="panel-head"><h2>本机服务与自动上报</h2><span>{server?.online ? '已连接' : '未连接'}</span></div>
            <p className="hint">默认连接 127.0.0.1；可改为其他服务器地址。扫描后每 10 分钟自动上报已归属的聚合用量，不上传会话正文、文件路径或密钥。</p>
            <form className="server-form" onSubmit={saveServer}><label>服务器地址<input aria-label="服务器地址" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="http://127.0.0.1:47839" /></label><label>访问密钥（更换时填写）<input aria-label="服务器访问密钥" type="password" value={serverToken} onChange={e => setServerToken(e.target.value)} placeholder="本机服务自动读取" /></label><button className="primary" disabled={busy}>保存连接</button></form>
            <p className="hint">{server?.online ? `已连接 ${server.url}` : server?.error || '检查中'} · {upload?.pending ? `${upload.pending} 批待补传` : '无待补传'} · 最近上报 {upload?.lastSuccess ? new Date(upload.lastSuccess).toLocaleString('zh-CN') : '尚无'}{upload?.lastError ? ` · ${upload.lastError}` : ''}</p>
          </section>
          <section className="panel telemetry-panel"><div className="panel-head"><h2>可选遥测接入</h2><span>{telemetry?.running ? '本机接收器已就绪' : '接收器未启动'}</span></div>
            <p className="hint">本地记录会自动扫描。需要持续接收官方遥测时，将下方配置手动加入对应工具的用户设置。已有遥测目标或组织设置请先核对，应用不会替你覆盖。配置含本机密钥，请勿分享。</p>
            {telemetry?.error && <div className="error">接收器启动失败：{telemetry.error}</div>}
            <details><summary>Codex 配置（~/.codex/config.toml）</summary>{telemetry?.codexWarning && <p className="config-warning">{telemetry.codexWarning}</p>}<p className="hint">检查现有 [otel] 段后，将以下内容合并到用户配置。</p><pre>{telemetry?.codex}</pre></details>
            <details><summary>Claude Code 配置（启动前的终端环境）</summary>{telemetry?.claudeWarning && <p className="config-warning">{telemetry.claudeWarning}</p>}<p className="hint">在启动 Claude Code 的终端中设置以下变量，再启动新会话。</p><pre>{telemetry?.claude}</pre></details>
            <p className="hint">接收器仅监听 127.0.0.1，验证密钥后只保存 Token 计数。与本地记录同一天的遥测不加入报表，以避免重复统计。</p>
          </section>
          <section className="panel data-panel"><div className="panel-head"><h2>数据备份与恢复</h2></div><p className="hint">备份包含本机账户和用量统计数据，请妥善保管。恢复前会自动保留当前数据库副本，并重启应用。</p><div className="source-actions"><button className="primary" onClick={backupDatabase}>保存备份</button><button className="text-button" onClick={restoreDatabase}>从备份恢复</button></div></section>
          <section className="panel"><div className="panel-head"><h2>来源归属</h2><span>{sourceIdentities.length} 个来源</span></div><p className="hint">为来源指定应用用户后，普通用户才能在报表中看到对应记录。无法确认的来源可保留为未归属。</p><div className="table-wrap"><table><thead><tr><th>来源</th><th>工具</th><th>记录</th><th>归属用户</th></tr></thead><tbody>{sourceIdentities.map(identity => <tr key={identity.key}><td><strong>{identity.label}</strong></td><td>{identity.provider === 'codex' ? 'Codex' : 'Claude Code'}</td><td>{identity.factCount.toLocaleString()}</td><td><select className="owner-select" value={identity.ownerUserId ?? ''} onChange={e => bindSource(identity.key, e.target.value || null)}><option value="">未归属</option>{users.filter(user => user.active).map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select></td></tr>)}</tbody></table>{sourceIdentities.length === 0 && <div className="empty-row">扫描完成后会在这里显示可识别的来源。</div>}</div></section>
        </> : <>
          <p className="page-lead">管理可以登录此应用的账户，并在“数据来源”中指定用量归属。</p>
          <section className="panel"><div className="panel-head"><h2>账户列表</h2><span>{users.length} 位用户</span></div><div className="table-wrap"><table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{user.role === 'admin' ? '管理员' : '普通用户'}</td><td><span className={user.active ? 'dot good' : 'dot'} />{user.active ? '启用' : '停用'}</td><td>{new Date(user.createdAt).toLocaleDateString('zh-CN')}</td><td><button className="text-button" disabled={user.id === state.user?.id} onClick={() => toggleUser(user)}>{user.active ? '停用' : '启用'}</button><button className="text-button" onClick={() => { setResetUser(user); setResetPassword(''); }}>重设密码</button></td></tr>)}</tbody></table></div>{resetUser && <form className="reset-form" onSubmit={savePassword}><strong>为 {resetUser.username} 设置新密码</strong><input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="新密码至少 10 位" autoFocus /><button className="primary" disabled={busy}>保存密码</button><button type="button" className="text-button" onClick={() => setResetUser(null)}>取消</button></form>}</section>
          <section className="panel add-user"><h2>新增账户</h2><form onSubmit={createUser}><label>用户名<input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="3–32 位" /></label><label>初始密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 10 位" /></label><label>角色<select value={newRole} onChange={e => setNewRole(e.target.value as Role)}><option value="viewer">普通用户</option><option value="admin">管理员</option></select></label><button className="primary" disabled={busy}>创建用户</button></form></section>
        </>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
