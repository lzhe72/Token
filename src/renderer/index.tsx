import React from 'react';
import { createRoot } from 'react-dom/client';
import type { AccountCollectionStatus, AppState, CollectionDiagnostic, FeedbackItem, OnboardingStatus, Provider, PublicUser, Role, ServerStatus, SourceIdentity, SourceStatus, TelemetryConfiguration, UpdateStatus, UploadStatus } from '../shared/types';
import { ReportPanel } from './report';
import { OverviewPanel } from './overview';
import { SettingsPanel } from './settings';
import { DiagnosticsPanel } from './diagnostics';
import { FeedbackPanel } from './feedback';
import { OnboardingPanel } from './onboarding';
import type { ReportDestination } from './report-navigation';
import './style.css';

function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function sourceStatusLabel(status?: Pick<SourceStatus, 'status'>): string {
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
  const [tab, setTab] = React.useState<'overview' | 'report' | 'sources' | 'users' | 'settings' | 'diagnostics' | 'feedback' | 'onboarding'>('overview');
  const [onboarding, setOnboarding] = React.useState<{ userId: string; status: OnboardingStatus } | null>(null);
  const [onboardingPreference, setOnboardingPreference] = React.useState<{ userId: string; skipped: boolean } | null>(null);
  const onboardingRequest = React.useRef(0);
  const [users, setUsers] = React.useState<PublicUser[]>([]);
  const [accountStatuses, setAccountStatuses] = React.useState<AccountCollectionStatus[]>([]);
  const [diagnostics, setDiagnostics] = React.useState<CollectionDiagnostic[]>([]);
  const [feedbackItems, setFeedbackItems] = React.useState<FeedbackItem[]>([]);
  const [feedbackError, setFeedbackError] = React.useState('');
  const [sourceStatuses, setSourceStatuses] = React.useState<SourceStatus[]>([]);
  const [sourceIdentities, setSourceIdentities] = React.useState<SourceIdentity[]>([]);
  const [telemetry, setTelemetry] = React.useState<TelemetryConfiguration | null>(null);
  const [server, setServer] = React.useState<ServerStatus | null>(null);
  const [upload, setUpload] = React.useState<UploadStatus | null>(null);
  const [update, setUpdate] = React.useState<UpdateStatus | null>(null);
  const [serverUrl, setServerUrl] = React.useState('');
  const [serverToken, setServerToken] = React.useState('');
  const [serverAdminToken, setServerAdminToken] = React.useState('');
  const [checkingUpdate, setCheckingUpdate] = React.useState(false);
  const [newUsername, setNewUsername] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newRole, setNewRole] = React.useState<Role>('viewer');
  const [resetUser, setResetUser] = React.useState<PublicUser | null>(null);
  const [resetPassword, setResetPassword] = React.useState('');
  const [conflictUsername, setConflictUsername] = React.useState('');
  const [reportDrilldown, setReportDrilldown] = React.useState(false);
  const [reportDestination, setReportDestination] = React.useState<ReportDestination | null>(null);
  const [reportBackTick, setReportBackTick] = React.useState(0);
  const [overviewDays, setOverviewDays] = React.useState(30);
  const [overviewProvider, setOverviewProvider] = React.useState<Provider | 'all'>('all');
  const [overviewUserId, setOverviewUserId] = React.useState('all');
  const [overviewTimeZone, setOverviewTimeZone] = React.useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');
  const [returnFocusId, setReturnFocusId] = React.useState('');

  React.useEffect(() => {
    window.tokenApi.getState().then(setState).catch(e => setError(errorMessage(e)));
    void window.tokenApi.getAppInfo().then(info => {
      if (info.installResult?.status === 'rollback') setError(info.installResult.message);
      else if (info.installResult?.status === 'success') setNotice(info.installResult.message);
    }).catch(() => {});
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

  React.useEffect(() => {
    if (tab !== 'diagnostics' || !state?.user || state.user.role === 'viewer') return;
    let wasScanning = false;
    const timer = window.setInterval(() => {
      void window.tokenApi.getScanProgress().then(active => {
        const scanning = active.length > 0;
        setDiagnostics(current => current.map(item => {
          const progress = active.find(value => value.provider === item.provider)?.progress;
          return { ...item, status: progress ? 'scanning' : item.status, progress };
        }));
        if (wasScanning && !scanning) void window.tokenApi.getCollectionDiagnostics().then(setDiagnostics).catch(() => {});
        wasScanning = scanning;
      }).catch(() => {});
    }, 700);
    return () => window.clearInterval(timer);
  }, [tab, state?.user?.id]);

  React.useEffect(() => {
    const userId = state?.user?.id;
    if (!userId) return;
    setOnboardingPreference({ userId, skipped: localStorage.getItem(`token:onboarding:skipped:${userId}`) === '1' });
  }, [state?.user?.id]);

  function refreshOnboarding() {
    const userId = state?.user?.id;
    if (!userId) return;
    const request = ++onboardingRequest.current;
    void window.tokenApi.getOnboardingStatus().then(status => {
      if (request === onboardingRequest.current) setOnboarding({ userId, status });
    }).catch(reason => { if (request === onboardingRequest.current) setError(errorMessage(reason)); });
  }

  React.useEffect(() => {
    if (state?.user && (tab === 'overview' || tab === 'onboarding')) refreshOnboarding();
  }, [state?.user?.id, tab]);

  React.useEffect(() => {
    setOverviewUserId('all');
    if (!state?.user || state.user.role === 'viewer') { setUsers([]); return; }
    let active = true;
    void window.tokenApi.listUsers().then(value => { if (active) setUsers(value); }).catch(() => {});
    return () => { active = false; };
  }, [state?.user?.id]);

  React.useEffect(() => {
    if (!state?.user) return;
    void window.tokenApi.checkUpdate().then(setUpdate).catch(() => {});
  }, [state?.user?.id]);

  const contentRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [tab]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      state.needsSetup
        ? await window.tokenApi.setupAdmin('admin', password, trustDevice)
        : await window.tokenApi.login(username, password, trustDevice);
      setState(await window.tokenApi.getState());
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    onboardingRequest.current++;
    await window.tokenApi.logout();
    setState({ needsSetup: false, user: null });
    setUsers([]);
    setTab('overview');
  }

  function setOnboardingSkipped(skipped: boolean) {
    const userId = state?.user?.id;
    if (!userId) return;
    const key = `token:onboarding:skipped:${userId}`;
    if (skipped) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
    setOnboardingPreference({ userId, skipped });
  }

  function showOnboarding() {
    setOnboardingSkipped(false);
    setTab('onboarding');
  }

  async function showUsers() {
    setError('');
    try {
      const [allUsers, accountData] = await Promise.all([window.tokenApi.listUsers(), window.tokenApi.getAccountCollectionStatuses()]);
      setUsers(allUsers);
      setAccountStatuses(accountData);
      try { setFeedbackItems(await window.tokenApi.listFeedback()); setFeedbackError(''); }
      catch (reason) { setFeedbackError(errorMessage(reason)); }
      setTab('users');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function showSources() {
    setError('');
    try {
      const [identities, allUsers] = await Promise.all([
        window.tokenApi.getSourceIdentities(), window.tokenApi.listUsers()
      ]);
      setSourceIdentities(identities);
      setUsers(allUsers);
      setTab('sources');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function showSettings() {
    setError('');
    setTab('settings');
    const requests: Promise<unknown>[] = [window.tokenApi.getCollectionDiagnostics().then(setDiagnostics)];
    if (state?.user?.role !== 'viewer') requests.push(window.tokenApi.getTelemetryConfiguration().then(setTelemetry));
    await Promise.allSettled(requests);
  }

  async function showDiagnostics() {
    setError(''); setTab('diagnostics');
    try { setDiagnostics(await window.tokenApi.getCollectionDiagnostics()); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  async function saveServer(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await window.tokenApi.configureServer(serverUrl, serverToken, serverAdminToken);
      setServer(result);
      setServerToken('');
      setServerAdminToken('');
      setNotice(result.online ? '服务器连接已更新。' : '服务器地址已保存，当前无法连接。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function checkUpdate() {
    setError('');
    setCheckingUpdate(true);
    try { setUpdate(await window.tokenApi.checkUpdate()); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setCheckingUpdate(false); }
  }

  async function downloadUpdate() {
    setBusy(true);
    setError('');
    try {
      await window.tokenApi.downloadUpdate();
      setNotice('安装包已校验，应用即将退出、自动安装并启动新版。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function showReport(destination?: ReportDestination) {
    setError('');
    try {
      if (state?.user?.role !== 'viewer') setUsers(await window.tokenApi.listUsers());
      setReportDestination(destination || null);
      setReportDrilldown(false);
      setTab('report');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function returnToOverview() {
    setReturnFocusId(reportDestination?.originId || '');
    setTab('overview');
  }

  async function scanSources() {
    setBusy(true);
    setError('');
    try {
      setSourceStatuses(await window.tokenApi.scanSources());
      setSourceIdentities(await window.tokenApi.getSourceIdentities());
      setDiagnostics(await window.tokenApi.getCollectionDiagnostics());
      refreshOnboarding();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function openFilePermissions() {
    try { await window.tokenApi.openFilePermissions(); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  async function resolveFeedback(item: FeedbackItem) {
    try {
      await window.tokenApi.setFeedbackResolved(item.id, item.status !== 'resolved');
      setFeedbackItems(await window.tokenApi.listFeedback());
    } catch (reason) { setFeedbackError(errorMessage(reason)); }
  }

  async function resolveAdminNameConflict(event: React.FormEvent) {
    event.preventDefault(); setError('');
    try {
      await window.tokenApi.resolveAdminNameConflict(conflictUsername);
      setState(await window.tokenApi.getState());
      setUsers(await window.tokenApi.listUsers());
      setConflictUsername('');
      setNotice('冲突账户已改名；现在可创建固定 admin 管理员账号。');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function bindSource(key: string, userId: string | null) {
    setError('');
    try {
      await window.tokenApi.bindSourceIdentity(key, userId);
      setSourceIdentities(await window.tokenApi.getSourceIdentities());
      refreshOnboarding();
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
      setState(await window.tokenApi.getState());
      setUsers(await window.tokenApi.listUsers());
      setAccountStatuses(await window.tokenApi.getAccountCollectionStatuses());
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
      setAccountStatuses(await window.tokenApi.getAccountCollectionStatuses());
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
        <label>用户名<input autoFocus value={state.needsSetup ? 'admin' : username} readOnly={state.needsSetup} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="用户名" /></label>
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
  const currentOnboarding = onboarding?.userId === state.user.id ? onboarding.status : null;
  const viewerOnboardingDone = state.user.role === 'viewer' && currentOnboarding?.steps
    .filter(step => step.key === 'bind' || step.key === 'usage').every(step => step.state === 'complete');
  const showOnboardingHint = onboardingPreference?.userId === state.user.id && !onboardingPreference.skipped &&
    currentOnboarding && !viewerOnboardingDone && currentOnboarding.steps.some(step => step.state !== 'complete');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="app-logo"><span>T</span><strong>Token</strong></div>
        <div className="nav-group"><div className="nav-label">工作台</div>
          <button className={tab === 'overview' ? 'nav active' : 'nav'} onClick={returnToOverview}><span>◫</span> 概览</button>
          <button className={tab === 'onboarding' ? 'nav active' : 'nav'} onClick={showOnboarding}><span>◉</span> 首次引导</button>
          <button className={tab === 'report' ? 'nav active' : 'nav'} onClick={() => void showReport()}><span>▤</span> 用量报表</button>
          {state.user.role !== 'viewer' && <button className={tab === 'sources' ? 'nav active' : 'nav'} onClick={showSources}><span>◇</span> 数据来源</button>}
          <button className={tab === 'diagnostics' ? 'nav active' : 'nav'} onClick={showDiagnostics}><span>◎</span> 采集诊断</button>
          <button className={tab === 'feedback' ? 'nav active' : 'nav'} onClick={() => setTab('feedback')}><span>✎</span> 问题反馈</button>
          {state.user.role !== 'viewer' && <button className={tab === 'users' ? 'nav active' : 'nav'} onClick={showUsers}><span>♙</span> 管理中心</button>}
          <button className={tab === 'settings' ? 'nav active' : 'nav'} onClick={showSettings}><span>⚙</span> 系统设置{update?.available ? ' · 新版本' : ''}</button>
        </div>
        <div className="sidebar-bottom"><div className="avatar">{state.user.username.slice(0, 1).toUpperCase()}</div><div><strong>{state.user.username}</strong><small>{state.user.role === 'superadmin' ? '超级管理员' : state.user.role === 'admin' ? '管理员' : '普通用户'}</small></div><button className="logout" onClick={logout} aria-label="退出登录" title="退出登录">↪</button></div>
      </aside>
      <main className="main-content" ref={contentRef}>
        <div className="content-wrap">
        <header><div><nav className="breadcrumb" aria-label="当前位置"><button onClick={returnToOverview}>工作台</button><span> / </span>{tab === 'report' && reportDrilldown ? <><button onClick={() => { setReportBackTick(value => value + 1); setReportDrilldown(false); }}>用量报表</button><span> / 明细</span></> : <span>{tab === 'users' ? '管理中心' : tab === 'sources' ? '数据来源' : tab === 'report' ? '用量报表' : tab === 'settings' ? '系统设置' : tab === 'diagnostics' ? '采集诊断' : tab === 'feedback' ? '问题反馈' : tab === 'onboarding' ? '首次引导' : '概览'}</span>}</nav><h1>{tab === 'users' ? '管理中心' : tab === 'sources' ? '数据来源' : tab === 'report' ? '用量报表' : tab === 'settings' ? '系统设置' : tab === 'diagnostics' ? '采集诊断' : tab === 'feedback' ? '问题反馈' : tab === 'onboarding' ? '首次引导' : '用量概览'}</h1></div><div className="date-chip">{server?.online ? '服务已连接' : '本机运行'}</div></header>
        {error && <div className="error banner" role="alert">{error}</div>}
        {notice && <div className="notice banner" role="status">{notice}</div>}
        {tab === 'overview' ? <>{showOnboardingHint && <div className="panel onboarding-hint" role="status"><div><strong>继续首次使用引导</strong><p>已完成 {currentOnboarding.steps.filter(step => step.state === 'complete').length} / 4 步。进入页面或点击重新核对时更新当前账户状态。</p></div><div><button type="button" onClick={showOnboarding}>查看引导</button><button type="button" className="text-button" onClick={() => setOnboardingSkipped(true)}>跳过引导</button></div></div>}<OverviewPanel sources={sourceStatuses} server={server} upload={upload} update={update} user={state.user} users={users}
          days={overviewDays} provider={overviewProvider} userId={overviewUserId} timeZone={overviewTimeZone}
          focusId={returnFocusId} onFocusRestored={() => setReturnFocusId('')}
          setDays={setOverviewDays} setProvider={setOverviewProvider} setUserId={setOverviewUserId} setTimeZone={setOverviewTimeZone}
          onCheckUpdate={checkUpdate} onDownloadUpdate={downloadUpdate} onReport={destination => void showReport(destination)} /></>
        : tab === 'onboarding' ? <OnboardingPanel status={currentOnboarding} user={state.user}
          onNavigate={target => { if (target === 'sources') void showSources(); else if (target === 'diagnostics') void showDiagnostics(); else void showReport(); }}
          onSkip={() => { setOnboardingSkipped(true); setTab('overview'); }}
          onRefresh={refreshOnboarding} />
        : tab === 'report' ? <ReportPanel user={state.user} users={users} destination={reportDestination} backTick={reportBackTick} onDrilldownChange={setReportDrilldown} onDiagnostics={() => void showDiagnostics()} onPermissions={() => void openFilePermissions()} />
        : tab === 'settings' ? <SettingsPanel user={state.user} server={server} upload={upload} telemetry={telemetry} update={update} diagnostics={diagnostics}
          serverUrl={serverUrl} serverToken={serverToken} adminToken={serverAdminToken} busy={busy} checking={checkingUpdate}
          setServerUrl={setServerUrl} setServerToken={setServerToken} setAdminToken={setServerAdminToken} saveServer={saveServer}
          checkUpdate={checkUpdate} downloadUpdate={downloadUpdate} backupDatabase={backupDatabase} restoreDatabase={restoreDatabase} openFilePermissions={openFilePermissions} />
        : tab === 'diagnostics' ? <DiagnosticsPanel items={diagnostics} busy={busy} canScan={state.user.role !== 'viewer'} onScan={scanSources} onPermissions={openFilePermissions} onFeedback={() => setTab('feedback')} />
        : tab === 'feedback' ? <FeedbackPanel username={state.user.username} />
        : tab === 'sources' ? <>
          <p className="page-lead">只读取当前 macOS 账户可访问的本机会话记录。采集器不会保存提示词、回复正文或源码。</p>
          <div className="source-grid"><div className="source-card"><div className="source-icon codex">◈</div><div><h3>Codex</h3><p>{codexStatus?.detail || `${codexStatus?.fileCount ?? 0} 个会话文件 · ${codexStatus?.factCount ?? 0} 条本地 · ${codexStatus?.telemetryFactCount ?? 0} 条遥测`}</p></div><span className="status-pill">{sourceStatusLabel(codexStatus)}</span></div><div className="source-card"><div className="source-icon claude">✳</div><div><h3>Claude Code</h3><p>{claudeStatus?.detail || `${claudeStatus?.fileCount ?? 0} 个会话文件 · ${claudeStatus?.factCount ?? 0} 条本地 · ${claudeStatus?.telemetryFactCount ?? 0} 条遥测`}</p></div><span className="status-pill">{sourceStatusLabel(claudeStatus)}</span></div></div>
          <div className="source-actions"><button className="primary" disabled={busy} onClick={scanSources}>{busy ? '扫描中…' : '立即扫描'}</button><span>首次导入大量历史记录可能需要几分钟。</span></div>
          <section className="panel"><div className="panel-head"><h2>来源归属</h2><span>{sourceIdentities.length} 个来源</span></div><p className="hint">为来源指定应用用户后，普通用户才能在报表中看到对应记录。无法确认的来源可保留为未归属。</p><div className="table-wrap"><table><thead><tr><th>来源</th><th>工具</th><th>记录</th><th>归属用户</th></tr></thead><tbody>{sourceIdentities.map(identity => <tr key={identity.key}><td><strong>{identity.label}</strong></td><td>{identity.provider === 'codex' ? 'Codex' : 'Claude Code'}</td><td>{identity.factCount.toLocaleString()}</td><td><select className="owner-select" value={identity.ownerUserId ?? ''} onChange={e => bindSource(identity.key, e.target.value || null)}><option value="">未归属</option>{users.filter(user => user.active).map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select></td></tr>)}</tbody></table>{sourceIdentities.length === 0 && <div className="empty-row">扫描完成后会在这里显示可识别的来源。</div>}</div></section>
        </> : <>
          <p className="page-lead">查看账号状态、采集归属和反馈。普通用户只能查看已分配给自己的用量。</p>
          {state.superadminIssue && <section className="panel"><div className="panel-head"><h2>固定 admin 账号状态</h2><span>需要处理</span></div><p className="hint">{state.superadminIssue}</p>
            {state.superadminIssue.includes('占用') && <form className="reset-form" onSubmit={resolveAdminNameConflict}><label>为当前冲突账号设置新用户名<input value={conflictUsername} onChange={e => setConflictUsername(e.target.value)} placeholder="新的普通用户名" /></label><button className="primary">确认改名</button></form>}
          </section>}
          <section className="panel"><div className="panel-head"><h2>账号与采集状态</h2><span>{users.length} 位用户</span></div><div className="table-wrap"><table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>最近登录</th><th>已归属来源 / 记录</th><th>采集状态</th><th>最新用量</th><th>操作</th></tr></thead><tbody>{users.map(user => { const collection = accountStatuses.find(item => item.user.id === user.id); const protectedAdmin = user.role === 'superadmin' && state.user?.role !== 'superadmin'; return <tr key={user.id}><td><strong>{user.username}</strong></td><td>{user.role === 'superadmin' ? '超级管理员' : user.role === 'admin' ? '管理员' : '普通用户'}</td><td><span className={user.active ? 'dot good' : 'dot'} />{user.active ? '启用' : '停用'}</td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '尚未登录'}</td><td>{collection ? `${collection.sourceCount} / ${collection.factCount}` : '读取中'}</td><td>{collection?.sources.length ? collection.sources.map(source => `${source.provider === 'codex' ? 'Codex' : 'Claude'}: ${sourceStatusLabel(source)}`).join('，') : '未绑定来源'}</td><td>{collection?.lastRecord ? new Date(collection.lastRecord).toLocaleString('zh-CN') : '尚无归属记录'}</td><td><button className="text-button" disabled={user.id === state.user?.id || protectedAdmin} onClick={() => toggleUser(user)}>{user.active ? '停用' : '启用'}</button><button className="text-button" disabled={protectedAdmin} onClick={() => { setResetUser(user); setResetPassword(''); }}>重设密码</button></td></tr>; })}</tbody></table></div>{resetUser && <form className="reset-form" onSubmit={savePassword}><strong>为 {resetUser.username} 设置新密码</strong><input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="新密码至少 10 位" autoFocus /><button className="primary" disabled={busy}>保存密码</button><button type="button" className="text-button" onClick={() => setResetUser(null)}>取消</button></form>}</section>
          <section className="panel add-user"><h2>新增账户</h2><form onSubmit={createUser}><label>用户名<input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="3–32 位" /></label><label>初始密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 10 位" /></label><label>角色<select value={newRole} onChange={e => setNewRole(e.target.value as Role)}><option value="viewer">普通用户</option><option value="admin">管理员</option></select></label><button className="primary" disabled={busy}>创建用户</button></form></section>
          <section className="panel"><div className="panel-head"><h2>问题反馈</h2><span>{feedbackItems.length} 条</span></div>
            {feedbackError && <div className="error">反馈列表不可用：{feedbackError}</div>}
            <div className="table-wrap"><table><thead><tr><th>时间</th><th>账号</th><th>类型 / 标题</th><th>状态</th><th>操作</th></tr></thead><tbody>{feedbackItems.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td>{item.username}</td><td><details><summary>{item.title}</summary><p className="feedback-message">{item.message}</p>{item.diagnostics && <pre>{item.diagnostics}</pre>}</details><small className="model-provider">{item.category}</small></td><td>{item.status === 'resolved' ? '已处理' : '待处理'}</td><td><button className="text-button" onClick={() => resolveFeedback(item)}>{item.status === 'resolved' ? '重新打开' : '标记已处理'}</button></td></tr>)}</tbody></table>{feedbackItems.length === 0 && !feedbackError && <div className="empty-row">尚无反馈。</div>}</div>
          </section>
        </>}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
