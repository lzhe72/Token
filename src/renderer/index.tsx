import React from 'react';
import { createRoot } from 'react-dom/client';
import type { AccountCollectionStatus, AppState, BindingEvidenceDeclaration, BindingEvidenceField, CollectionDiagnostic, FeedbackItem, OnboardingStatus, Provider, PublicUser, ReportQuery, Role, ServerStatus, SourceBindingPreview, SourceIdentity, SourceStatus, TelemetryConfiguration, UpdateStatus, UploadStatus } from '../shared/types';
import { HeaderStatus } from './header-status';
import { ReportPanel } from './report';
import { OverviewPanel } from './overview';
import { SettingsPanel } from './settings';
import { DiagnosticsPanel } from './diagnostics';
import { FeedbackPanel } from './feedback';
import { OnboardingPanel } from './onboarding';
import { SourceBindingDialog } from './source-binding';
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
    case 'cancelled': return '扫描已取消 · 覆盖未知';
    case 'no_records': return '暂无记录';
    case 'not_found': return '未找到';
    case 'error': return '需要检查';
    default: return '等待扫描';
  }
}

function sourceNeedsIdentityReview(source: SourceIdentity): boolean {
  return source.key.startsWith('codex:otel:unknown:') ||
    source.key.startsWith('codex:otel:legacy-ambiguous:') ||
    source.key.startsWith('codex:legacy-unverified:') ||
    source.key.startsWith('claude:legacy-unverified:') ||
    source.key.startsWith('claude:otel:unknown:') ||
    source.key.startsWith('claude:otel:legacy-unverified:') ||
    source.key.startsWith('claude:local-file-unknown:') ||
    source.label.includes('账户身份尚未验证');
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function initialBindingRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);
  return { from: localDate(start), to: localDate(end), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai' };
}

function App() {
  const [state, setState] = React.useState<AppState | null>(null);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [trustDevice, setTrustDevice] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [scanCancelling, setScanCancelling] = React.useState(false);
  const [scanActive, setScanActive] = React.useState(false);
  const [tab, setTab] = React.useState<'overview' | 'report' | 'sources' | 'users' | 'settings' | 'diagnostics' | 'feedback' | 'onboarding'>('overview');
  const [onboarding, setOnboarding] = React.useState<{ userId: string; status: OnboardingStatus } | null>(null);
  const [onboardingActiveUserId, setOnboardingActiveUserId] = React.useState<string | null>(null);
  const onboardingRequest = React.useRef(0);
  const [users, setUsers] = React.useState<PublicUser[]>([]);
  const [accountStatuses, setAccountStatuses] = React.useState<AccountCollectionStatus[]>([]);
  const [diagnostics, setDiagnostics] = React.useState<CollectionDiagnostic[]>([]);
  const [feedbackItems, setFeedbackItems] = React.useState<FeedbackItem[]>([]);
  const [feedbackError, setFeedbackError] = React.useState('');
  const [sourceStatuses, setSourceStatuses] = React.useState<SourceStatus[]>([]);
  const [sourceIdentities, setSourceIdentities] = React.useState<SourceIdentity[]>([]);
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'pending' | 'assigned' | 'deferred'>('all');
  const [sourceProjectFilter, setSourceProjectFilter] = React.useState('');
  const [sourceLastFrom, setSourceLastFrom] = React.useState('');
  const [sourceLastTo, setSourceLastTo] = React.useState('');
  const [appliedSourceDates, setAppliedSourceDates] = React.useState({ from: '', to: '' });
  const [sourcePage, setSourcePage] = React.useState(1);
  const [showRoutineSources, setShowRoutineSources] = React.useState(false);
  const [editingSourceKey, setEditingSourceKey] = React.useState<string | null>(null);
  const [deferredView, setDeferredView] = React.useState<{ userId: string; keys: string[] } | null>(null);
  const sourceViewRequest = React.useRef(0);
  const [bindingDraft, setBindingDraft] = React.useState<{ key: string; userId: string | null } | null>(null);
  React.useEffect(() => {
    try { localStorage.removeItem('token-deferred-source-keys'); } catch { /* obsolete unscoped preference */ }
  }, []);
  const [bindingPreview, setBindingPreview] = React.useState<SourceBindingPreview | null>(null);
  const [bindingBusy, setBindingBusy] = React.useState(false);
  const [bindingError, setBindingError] = React.useState('');
  const [bindingValidationField, setBindingValidationField] = React.useState<BindingEvidenceField | null>(null);
  const [bindingRange, setBindingRange] = React.useState(initialBindingRange);
  const bindingTrigger = React.useRef<HTMLButtonElement | null>(null);
  const bindingSelect = React.useRef<HTMLSelectElement | null>(null);
  const bindingErrorRef = React.useRef<HTMLParagraphElement | null>(null);
  const bindingRequest = React.useRef(0);
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
    window.tokenApi.getState().then(value => {
      setState(value);
      if (value.user && localStorage.getItem(`token:onboarding:active:${value.user.id}`) === '1') {
        setOnboardingActiveUserId(value.user.id);
        setTab('onboarding');
      }
    }).catch(e => setError(errorMessage(e)));
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
    if (!busy || !state?.user || state.user.role === 'viewer') return;
    let active = true;
    const poll = () => void window.tokenApi.getScanProgress().then(progress => {
      if (active) setScanActive(progress.length > 0);
    }).catch(() => {});
    const timer = window.setInterval(poll, 300);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, state?.user?.id]);

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
    if (tab !== 'sources') { bindingRequest.current++; setBindingBusy(false); }
  }, [tab]);

  React.useEffect(() => {
    if (!bindingError || bindingPreview) return;
    const frame = requestAnimationFrame(() => bindingErrorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [bindingError, bindingPreview]);

  function refreshOnboarding() {
    const userId = state?.user?.id;
    if (!userId) return;
    const request = ++onboardingRequest.current;
    void window.tokenApi.getOnboardingStatus().then(status => {
      if (request === onboardingRequest.current) setOnboarding({ userId, status });
    }).catch(reason => { if (request === onboardingRequest.current) setError(errorMessage(reason)); });
  }

  React.useEffect(() => {
    if (state?.user && tab === 'onboarding') refreshOnboarding();
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
  React.useEffect(() => { setNotice(''); }, [tab]);
  React.useEffect(() => {
    if (upload?.currentConfirmed && notice.includes('服务待同步')) setNotice('来源归属已更新，当前版本已由服务端确认。');
  }, [upload?.currentConfirmed, notice]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      const firstSetup = state.needsSetup;
      firstSetup
        ? await window.tokenApi.setupAdmin('admin', password, trustDevice)
        : await window.tokenApi.login(username, password, trustDevice);
      const nextState = await window.tokenApi.getState();
      if (nextState.user) {
        const key = `token:onboarding:active:${nextState.user.id}`;
        if (firstSetup) localStorage.setItem(key, '1');
        const active = localStorage.getItem(key) === '1';
        setOnboardingActiveUserId(active ? nextState.user.id : null);
        setTab(active ? 'onboarding' : 'overview');
      }
      setState(nextState);
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    onboardingRequest.current++;
    bindingRequest.current++;
    sourceViewRequest.current++;
    setDeferredView(null);
    setSourceFilter('all'); setSourceProjectFilter(''); setSourceLastFrom(''); setSourceLastTo('');
    setAppliedSourceDates({ from: '', to: '' }); setSourcePage(1);
    setShowRoutineSources(false); setEditingSourceKey(null);
    await window.tokenApi.logout();
    setState({ needsSetup: false, user: null });
    setUsers([]);
    setAccountStatuses([]); setFeedbackItems([]); setSourceIdentities([]); setSourceStatuses([]);
    setDiagnostics([]); setUpload(null); setReportDestination(null);
    setBindingDraft(null); setBindingPreview(null); setBindingError(''); setBindingBusy(false);
    setNotice(''); setError('');
    setTab('overview');
  }

  function finishOnboarding() {
    const userId = state?.user?.id;
    if (!userId) return;
    localStorage.removeItem(`token:onboarding:active:${userId}`);
    localStorage.removeItem(`token:onboarding:skipped:${userId}`);
    setOnboardingActiveUserId(null);
    setTab('overview');
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
    bindingRequest.current++; setBindingBusy(false);
    setBindingDraft(null); setBindingPreview(null); setBindingError('');
    setShowRoutineSources(false); setEditingSourceKey(null);
    const actorId = state?.user?.id;
    if (!actorId) return;
    const request = ++sourceViewRequest.current;
    setDeferredView(null);
    try {
      const [identities, allUsers, deferredKeys] = await Promise.all([
        window.tokenApi.getSourceIdentities(), window.tokenApi.listUsers(), window.tokenApi.getDeferredSourceKeys()
      ]);
      if (request !== sourceViewRequest.current) return;
      setSourceIdentities(identities);
      setUsers(allUsers);
      setDeferredView({ userId: actorId, keys: deferredKeys });
      setSourcePage(1);
      setTab('sources');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function toggleSourceDeferred(key: string) {
    const actorId = state?.user?.id;
    if (!actorId || deferredView?.userId !== actorId) return;
    const deferred = !deferredView.keys.includes(key);
    try {
      const keys = await window.tokenApi.setSourceDeferred(key, deferred);
      setDeferredView({ userId: actorId, keys });
      setSourcePage(1);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function changeSourceDate(field: 'from' | 'to', value: string) {
    const from = field === 'from' ? value : sourceLastFrom;
    const to = field === 'to' ? value : sourceLastTo;
    setSourceLastFrom(from); setSourceLastTo(to);
    if (from && to && from > to) return;
    setAppliedSourceDates({ from, to });
    setSourcePage(1);
  }

  function clearSourceDates() {
    setSourceLastFrom(''); setSourceLastTo(''); setAppliedSourceDates({ from: '', to: '' }); setSourcePage(1);
  }

  function clearSourceFilters() {
    setSourceFilter('all'); setSourceProjectFilter(''); clearSourceDates();
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
      setUpload(await window.tokenApi.getUploadStatus());
      setNotice(result.online ? '服务器连接已更新。' : '服务器地址已保存，当前无法连接。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function useBuiltInServer() {
    setBusy(true);
    setError('');
    try {
      const result = await window.tokenApi.useBuiltInServer();
      setServer(result);
      setServerUrl(result.url);
      setServerToken('');
      setServerAdminToken('');
      setUpload(await window.tokenApi.getUploadStatus());
      setNotice(result.online ? '已切换到内置本机服务。' : '已选择内置本机服务，请查看连接诊断。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function retryUpload() {
    setBusy(true);
    setError('');
    try {
      const result = await window.tokenApi.retryUpload();
      setUpload(result);
      setNotice(result.currentConfirmed ? '当前修订版已由当前服务确认。' :
        `仍有 ${result.pending} 批待传${result.lastError ? `：${result.lastError}` : '，稍后可再试'}`);
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
    setScanCancelling(false);
    setScanActive(true);
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
      setScanCancelling(false);
      setScanActive(false);
    }
  }

  async function cancelScan() {
    setScanCancelling(true);
    try {
      if (!await window.tokenApi.cancelScan()) setScanCancelling(false);
    } catch (reason) {
      setScanCancelling(false);
      setError(errorMessage(reason));
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

  async function previewBinding() {
    if (!bindingDraft) return;
    const request = ++bindingRequest.current;
    setBindingBusy(true); setBindingError(''); setBindingValidationField(null);
    try {
      const source = sourceIdentities.find(item => item.key === bindingDraft.key);
      if (!source) throw new Error('来源已变化，请刷新列表');
      const filter: ReportQuery = { ...bindingRange, granularity: 'day', provider: source.provider,
        model: '', projectKey: '', userId: 'all' };
      const result = await window.tokenApi.previewSourceBinding(bindingDraft.key, bindingDraft.userId, filter);
      if (request === bindingRequest.current) setBindingPreview(result);
    } catch (e) {
      if (request === bindingRequest.current) { setBindingDraft(null); setBindingError(errorMessage(e)); }
    } finally { if (request === bindingRequest.current) setBindingBusy(false); }
  }

  function closeBinding(keepDraft: boolean, clearError = true, restoreFocus = true) {
    setBindingPreview(null);
    setBindingValidationField(null);
    if (!keepDraft) { setBindingDraft(null); setEditingSourceKey(null); }
    if (clearError) setBindingError('');
    if (restoreFocus) requestAnimationFrame(() => {
      const target = keepDraft ? bindingTrigger.current : bindingSelect.current;
      if (target?.isConnected) target.focus();
      else document.querySelector<HTMLButtonElement>('.source-routine-toggle button')?.focus();
    });
  }

  async function confirmBinding(evidence?: BindingEvidenceDeclaration) {
    if (!bindingPreview) return;
    setBindingBusy(true); setBindingError(''); setBindingValidationField(null);
    try {
      const result = await window.tokenApi.confirmSourceBinding(bindingPreview.id, evidence);
      if (!result.localCommitted) {
        setBindingValidationField(result.validationError.field);
        setBindingError(result.validationError.message);
        return;
      }
      setSourceIdentities(await window.tokenApi.getSourceIdentities());
      setUpload(await window.tokenApi.getUploadStatus());
      setNotice(result.service === 'synced' ? '来源归属已更新，当前版本已由服务端确认。' :
        `来源归属已在本机更新；服务待同步${result.syncError ? `：${result.syncError}` : '，稍后自动重试'}`);
      closeBinding(false);
      refreshOnboarding();
    } catch (e) {
      setBindingError(errorMessage(e));
      closeBinding(false, false, false);
      setSourceIdentities(await window.tokenApi.getSourceIdentities().catch(() => sourceIdentities));
    } finally { setBindingBusy(false); }
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
  const onboardingInProgress = onboardingActiveUserId === state.user.id;
  const deferredReady = deferredView?.userId === state.user.id;
  const deferredSourceSet = new Set(deferredReady ? deferredView.keys : []);
  const unassignedFileCount = sourceIdentities.filter(item => item.key.startsWith('claude:local-file:') && !item.ownerUserId).length;
  const pendingFileCount = sourceIdentities.filter(item => item.key.startsWith('claude:local-file:') &&
    !item.ownerUserId && !deferredSourceSet.has(item.key)).length;
  const singleUserMode = users.length === 1 && users[0].active && users[0].role !== 'viewer';
  const isRoutineSource = (item: SourceIdentity) => !!item.ownerUserId && !sourceNeedsIdentityReview(item);
  const assignedCount = (provider: Provider) => sourceIdentities.filter(item => item.provider === provider && isRoutineSource(item)).length;
  const exceptionCount = sourceIdentities.filter(item => !isRoutineSource(item)).length;
  const sourceProjectOptions = [...new Set(sourceIdentities.map(item => item.projectLabel).filter((label): label is string => !!label))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const dateRangeInvalid = !!sourceLastFrom && !!sourceLastTo && sourceLastFrom > sourceLastTo;
  const hasSourceFilters = sourceFilter !== 'all' || !!sourceProjectFilter || !!sourceLastFrom || !!sourceLastTo;
  const scopedSources = (deferredReady ? sourceIdentities : []).filter(item => {
    const statusMatches = sourceFilter === 'all' ? true : sourceFilter === 'assigned' ? !!item.ownerUserId :
      sourceFilter === 'deferred' ? !item.ownerUserId && deferredSourceSet.has(item.key) : !item.ownerUserId && !deferredSourceSet.has(item.key);
    return statusMatches && (!sourceProjectFilter || item.projectLabel === sourceProjectFilter);
  });
  const unknownLastRecordCount = scopedSources.filter(item => !item.lastRecordAt || Number.isNaN(Date.parse(item.lastRecordAt))).length;
  const dateFilteredSources = scopedSources.filter(item => {
    if (!appliedSourceDates.from && !appliedSourceDates.to) return true;
    if (!item.lastRecordAt) return false;
    const date = new Date(item.lastRecordAt);
    if (Number.isNaN(date.getTime())) return false;
    const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return (!appliedSourceDates.from || localDay >= appliedSourceDates.from) &&
      (!appliedSourceDates.to || localDay <= appliedSourceDates.to);
  });
  const collapseRoutine = singleUserMode && sourceFilter === 'all' && !sourceProjectFilter &&
    !appliedSourceDates.from && !appliedSourceDates.to && !showRoutineSources;
  const visibleSources = dateFilteredSources.filter(item => !collapseRoutine || !isRoutineSource(item) || bindingDraft?.key === item.key);
  const hiddenRoutineCount = dateFilteredSources.length - visibleSources.length;
  const sourcePageCount = Math.max(1, Math.ceil(visibleSources.length / 20));
  const visibleSourcePage = Math.min(sourcePage, sourcePageCount);
  const pageSources = visibleSources.slice((visibleSourcePage - 1) * 20, visibleSourcePage * 20);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="app-logo"><span>T</span><strong>Token</strong></div>
        <div className="nav-group"><div className="nav-label">工作台</div>
          <button className={tab === 'overview' ? 'nav active' : 'nav'} onClick={returnToOverview}><span>◫</span> 概览</button>
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
        <header><div><nav className="breadcrumb" aria-label="当前位置"><button onClick={returnToOverview}>工作台</button><span> / </span>{tab === 'report' && reportDrilldown ? <><button onClick={() => { setReportBackTick(value => value + 1); setReportDrilldown(false); }}>用量报表</button><span> / 明细</span></> : <span>{tab === 'users' ? '管理中心' : tab === 'sources' ? '数据来源' : tab === 'report' ? '用量报表' : tab === 'settings' ? '系统设置' : tab === 'diagnostics' ? '采集诊断' : tab === 'feedback' ? '问题反馈' : tab === 'onboarding' ? '首次引导' : '概览'}</span>}</nav><h1>{tab === 'users' ? '管理中心' : tab === 'sources' ? '数据来源' : tab === 'report' ? '用量报表' : tab === 'settings' ? '系统设置' : tab === 'diagnostics' ? '采集诊断' : tab === 'feedback' ? '问题反馈' : tab === 'onboarding' ? '首次引导' : '用量概览'}</h1></div><HeaderStatus sources={sourceStatuses} server={server} upload={upload} onDiagnostics={() => void showDiagnostics()} onSettings={() => void showSettings()} /></header>
        {error && <div className="error banner" role="alert">{error}</div>}
        {notice && <div className="notice banner" role="status">{notice}</div>}
        {onboardingInProgress && tab !== 'onboarding' && <div className="panel onboarding-hint" role="status"><div><strong>首次设置尚未结束</strong><p>完成当前操作后可返回引导，核对四步进度。</p></div><div><button type="button" onClick={() => setTab('onboarding')}>返回引导</button><button type="button" className="text-button" onClick={finishOnboarding}>结束引导</button></div></div>}
        {tab === 'overview' ? <OverviewPanel sources={sourceStatuses} server={server} upload={upload} update={update} user={state.user} users={users}
          days={overviewDays} provider={overviewProvider} userId={overviewUserId} timeZone={overviewTimeZone}
          focusId={returnFocusId} onFocusRestored={() => setReturnFocusId('')}
          setDays={setOverviewDays} setProvider={setOverviewProvider} setUserId={setOverviewUserId} setTimeZone={setOverviewTimeZone}
          onCheckUpdate={checkUpdate} onDownloadUpdate={downloadUpdate} onReport={destination => void showReport(destination)} />
        : tab === 'onboarding' ? <OnboardingPanel status={currentOnboarding} user={state.user}
          onNavigate={target => { if (target === 'sources') void showSources(); else if (target === 'diagnostics') void showDiagnostics(); else void showReport(); }}
          onSkip={finishOnboarding}
          onRefresh={refreshOnboarding} />
        : tab === 'report' ? <ReportPanel user={state.user} users={users} destination={reportDestination} backTick={reportBackTick} onDrilldownChange={setReportDrilldown} onDiagnostics={() => void showDiagnostics()} onPermissions={() => void openFilePermissions()} />
        : tab === 'settings' ? <SettingsPanel user={state.user} server={server} upload={upload} telemetry={telemetry} update={update} diagnostics={diagnostics}
          serverUrl={serverUrl} serverToken={serverToken} adminToken={serverAdminToken} busy={busy} checking={checkingUpdate}
          setServerUrl={setServerUrl} setServerToken={setServerToken} setAdminToken={setServerAdminToken} saveServer={saveServer}
          useBuiltInServer={useBuiltInServer} retryUpload={retryUpload}
          checkUpdate={checkUpdate} downloadUpdate={downloadUpdate} backupDatabase={backupDatabase} restoreDatabase={restoreDatabase} openFilePermissions={openFilePermissions} />
        : tab === 'diagnostics' ? <DiagnosticsPanel items={diagnostics} busy={busy} scanning={scanActive} cancelling={scanCancelling} canScan={state.user.role !== 'viewer'} onScan={scanSources} onCancel={cancelScan} onPermissions={openFilePermissions} onFeedback={() => setTab('feedback')} />
        : tab === 'feedback' ? <FeedbackPanel username={state.user.username} />
        : tab === 'sources' ? <>
          <p className="page-lead">只读取当前 macOS 账户可访问的本机会话记录。采集器不会保存提示词、回复正文或源码。</p>
          <div className="source-grid"><div className="source-card"><div className="source-icon codex">◈</div><div><h3>Codex</h3><p>{singleUserMode ? `已归属 ${assignedCount('codex')} 个来源 · ${sourceIdentities.filter(item => item.provider === 'codex' && !isRoutineSource(item)).length} 个需处理` : codexStatus?.detail || `${codexStatus?.fileCount ?? 0} 个会话文件 · ${codexStatus?.factCount ?? 0} 条本地 · ${codexStatus?.telemetryFactCount ?? 0} 条遥测`}</p>{singleUserMode && codexStatus && !['ready', 'no_records'].includes(codexStatus.status) && <small className="source-card-detail">{codexStatus.detail}</small>}</div><span className="status-pill">{sourceStatusLabel(codexStatus)}</span></div><div className="source-card"><div className="source-icon claude">✳</div><div><h3>Claude Code</h3><p>{singleUserMode ? `已归属 ${assignedCount('claude')} 个来源 · ${sourceIdentities.filter(item => item.provider === 'claude' && !isRoutineSource(item)).length} 个需处理` : claudeStatus?.detail || `${claudeStatus?.fileCount ?? 0} 个会话文件 · ${claudeStatus?.factCount ?? 0} 条本地 · ${claudeStatus?.telemetryFactCount ?? 0} 条遥测`}</p>{singleUserMode && claudeStatus && !['ready', 'no_records'].includes(claudeStatus.status) && <small className="source-card-detail">{claudeStatus.detail}</small>}</div><span className="status-pill">{sourceStatusLabel(claudeStatus)}</span></div></div>
          <div className="source-actions"><button className="primary" disabled={busy} onClick={scanSources}>{busy ? scanActive ? '扫描中…' : '正在同步…' : '立即扫描'}</button>{busy && scanActive && <button className="export-button" disabled={scanCancelling} onClick={cancelScan}>{scanCancelling ? '正在取消…' : '取消扫描'}</button>}<span>首次导入大量历史记录可能需要几分钟。</span></div>
          <section className="panel"><div className="panel-head"><h2>来源归属</h2><span>{singleUserMode ? `${exceptionCount} 个需处理 · ${sourceIdentities.length} 个来源` : `${sourceIdentities.length} 个来源`}</span></div><p className="hint">选择用户只生成草稿；预览后确认才会改变授权。无法确认的来源可保留为未归属。</p>
            {singleUserMode && <div className="source-routine-toggle"><span>{hiddenRoutineCount ? `已收起 ${hiddenRoutineCount} 个正常归属来源；身份未知及未归属来源仍显示。` : '正常归属来源可在此展开查看。'}</span><button type="button" className="export-button" onClick={() => { setShowRoutineSources(value => !value); setSourcePage(1); }}>{showRoutineSources ? '收起正常来源' : '查看全部已归属来源'}</button></div>}
            {sourceIdentities.some(source => source.key.startsWith('claude:local-file:')) &&
              (users.length === 1 && users[0].active && users[0].role !== 'viewer'
                ? <p className="hint">本机单用户模式：当前 macOS 用户资料中可确认的 Claude 文件默认归属 {users[0].username}。这是本机使用者归属，不代表已验证 Claude 账号；无法确认的旧记录仍待核对。</p>
                : <p className="config-warning">Claude Code 本地记录按文件来源区分，文件本身不能证明账号。请核对项目、时间及独立证据后逐项绑定；缺少证据时保持未归属。</p>)}
            {sourceIdentities.some(source => source.key.includes(':legacy-unverified:')) && <p className="config-warning">旧本地记录的归属暂不可确认。请检查文件访问权限并重新扫描；恢复后核对新来源与用量，待重扫来源不能直接绑定。</p>}
            {sourceIdentities.some(source => source.provider === 'codex' && sourceNeedsIdentityReview(source) && !source.key.includes(':legacy-unverified:')) && <p className="config-warning">Codex 账户身份无法验证，历史归属已暂停。请重新启用包含 account_id 的遥测并核对新来源；未知来源不能直接绑定用户。</p>}
            {sourceIdentities.some(source => source.provider === 'claude' && sourceNeedsIdentityReview(source) && !source.key.includes(':legacy-unverified:')) && <p className="config-warning">Claude Code 账户身份无法验证，历史归属已暂停。请启用包含 user.account_uuid 或 user.account_id 的遥测并核对新来源；未知来源不能直接绑定用户。</p>}
            <div className="binding-range"><label>预览开始 <input type="date" disabled={bindingBusy} value={bindingRange.from} onChange={e => setBindingRange(current => ({ ...current, from: e.target.value }))} /></label><label>预览结束 <input type="date" disabled={bindingBusy} value={bindingRange.to} onChange={e => setBindingRange(current => ({ ...current, to: e.target.value }))} /></label><span>同一时区 {bindingRange.timeZone} · 当前来源工具 · 全部模型与项目</span></div>
            {bindingError && <p className="error" role="alert" tabIndex={-1} ref={bindingErrorRef}>{bindingError} · 请检查来源后重新预览。 <button type="button" className="text-button" onClick={() => bindingSelect.current?.focus()}>重新选择归属</button></p>}
            <div className="source-actions"><label>来源状态 <select aria-label="来源状态筛选" value={sourceFilter} onChange={event => { setSourceFilter(event.target.value as typeof sourceFilter); setSourcePage(1); }}><option value="all">全部来源</option><option value="pending">我的待办</option><option value="assigned">已归属</option><option value="deferred">我的暂缓</option></select></label><label>项目 <select aria-label="来源项目筛选" value={sourceProjectFilter} onChange={event => { setSourceProjectFilter(event.target.value); setSourcePage(1); }}><option value="">全部项目</option>{sourceProjectOptions.map(label => <option key={label} value={label}>{label}</option>)}</select></label><label>最近记录从 <input type="date" aria-label="最近记录开始日期" aria-invalid={dateRangeInvalid} value={sourceLastFrom} onChange={event => changeSourceDate('from', event.target.value)} /></label><label>至 <input type="date" aria-label="最近记录结束日期" aria-invalid={dateRangeInvalid} value={sourceLastTo} onChange={event => changeSourceDate('to', event.target.value)} /></label><button type="button" className="text-button" disabled={!sourceLastFrom && !sourceLastTo && !appliedSourceDates.from && !appliedSourceDates.to} onClick={clearSourceDates}>清除日期条件</button><button type="button" className="text-button" disabled={!hasSourceFilters} onClick={clearSourceFilters}>清除来源筛选</button><span>{deferredReady ? `Claude 文件未归属总数 ${unassignedFileCount} 个 · 我的待办 ${pendingFileCount} 个 · 筛选命中 ${visibleSources.length} 个 · 最近时间未知 ${unknownLastRecordCount} 个 · 每页 20 个来源` : '正在加载当前管理员待办…'}</span></div>
            {dateRangeInvalid && <p className="config-warning" role="alert">最近记录开始日期不能晚于结束日期；保留上一次有效日期筛选结果。请调整日期范围。</p>}
            <div className="table-wrap"><table><thead><tr><th>来源</th><th>工具</th><th>记录</th><th>归属用户</th><th>操作</th></tr></thead><tbody>{pageSources.map(identity => {
              const locked = sourceNeedsIdentityReview(identity);
              return <tr key={identity.key}><td><strong>{identity.label}</strong>{identity.key.startsWith('claude:local-file:') && <small className="model-provider">项目 {identity.projectLabel || '未知'} · {identity.lastRecordAt ? `最近时间 ${new Date(identity.lastRecordAt).toLocaleString('zh-CN')}` : '最近记录：时间未知'}</small>}</td><td>{identity.provider === 'codex' ? 'Codex' : 'Claude Code'}</td><td>{identity.factCount.toLocaleString()}</td><td>{singleUserMode && isRoutineSource(identity) && editingSourceKey !== identity.key
                ? <span>{users.find(user => user.id === identity.ownerUserId)?.username || '已归属用户'}</span>
                : <select className="owner-select" disabled={bindingBusy || locked} aria-label={`${identity.label} 归属草稿`} value={bindingDraft?.key === identity.key ? bindingDraft.userId ?? '' : identity.ownerUserId ?? ''} onChange={e => { bindingRequest.current++; setBindingError(''); setBindingPreview(null); setBindingDraft({ key: identity.key, userId: e.target.value || null }); }}><option value="">未归属</option>{users.filter(user => user.active || user.id === identity.ownerUserId).map(user => <option key={user.id} value={user.id}>{user.username}{user.active ? '' : '（已停用）'}</option>)}</select>}</td><td>{singleUserMode && isRoutineSource(identity) && editingSourceKey !== identity.key && <button type="button" className="text-button" onClick={() => setEditingSourceKey(identity.key)}>管理归属</button>}{locked ? <span className="hint">{identity.key.includes(':legacy-unverified:') ? '等待重新扫描' : '身份无法验证'}</span> : bindingDraft?.key === identity.key && bindingDraft.userId !== identity.ownerUserId && <><span className="binding-draft-label">未保存草稿</span><button type="button" className="export-button" disabled={bindingBusy} onClick={event => { bindingTrigger.current = event.currentTarget; bindingSelect.current = event.currentTarget.closest('tr')?.querySelector('select') ?? null; void previewBinding(); }}>预览变更</button></>}{editingSourceKey === identity.key && !bindingPreview && <button type="button" className="text-button" onClick={() => { setEditingSourceKey(null); setBindingDraft(null); }}>取消编辑</button>}{identity.key.startsWith('claude:local-file:') && !identity.ownerUserId && <button type="button" className="text-button" onClick={() => void toggleSourceDeferred(identity.key)}>{deferredSourceSet.has(identity.key) ? '重新纳入待归属' : '暂不归属'}</button>}</td></tr>;
            })}</tbody></table>{visibleSources.length === 0 && <div className="empty-row">{!deferredReady ? '正在加载当前管理员的来源视图…' : collapseRoutine && hiddenRoutineCount ? '需要处理的来源已清空；正常归属来源已收起。' : hasSourceFilters ? <>当前筛选下没有来源。<button type="button" className="text-button" onClick={clearSourceFilters}>清除来源筛选</button></> : sourceIdentities.length ? '当前没有可显示的来源。' : '扫描完成后会在这里显示可识别的来源。'}</div>}</div>
            {sourcePageCount > 1 && <div className="source-actions"><button type="button" className="export-button" disabled={visibleSourcePage === 1} onClick={() => setSourcePage(page => Math.max(1, page - 1))}>上一页</button><span>第 {visibleSourcePage} / {sourcePageCount} 页</span><button type="button" className="export-button" disabled={visibleSourcePage === sourcePageCount} onClick={() => setSourcePage(page => Math.min(sourcePageCount, page + 1))}>下一页</button></div>}</section>
          {bindingPreview && <SourceBindingDialog key={bindingPreview.id} preview={bindingPreview} busy={bindingBusy} error={bindingError}
            validationField={bindingValidationField} onEvidenceEdit={() => { setBindingError(''); setBindingValidationField(null); }}
            onCancel={() => { void window.tokenApi.cancelSourceBinding(bindingPreview.id).catch(() => {}); closeBinding(true); }}
            onConfirm={evidence => void confirmBinding(evidence)} />}
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
