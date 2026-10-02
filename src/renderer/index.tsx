import React from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, PublicUser, Role } from '../shared/types';
import './style.css';

function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function App() {
  const [state, setState] = React.useState<AppState | null>(null);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [tab, setTab] = React.useState<'overview' | 'users'>('overview');
  const [users, setUsers] = React.useState<PublicUser[]>([]);
  const [newUsername, setNewUsername] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newRole, setNewRole] = React.useState<Role>('viewer');
  const [resetUser, setResetUser] = React.useState<PublicUser | null>(null);
  const [resetPassword, setResetPassword] = React.useState('');

  React.useEffect(() => {
    window.tokenApi.getState().then(setState).catch(e => setError(errorMessage(e)));
  }, []);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      const user = state.needsSetup
        ? await window.tokenApi.setupAdmin(username, password)
        : await window.tokenApi.login(username, password);
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
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? '请稍候…' : state.needsSetup ? '创建并进入' : '登录'}</button>
        <small>数据仅保存在这台 Mac。</small>
      </form>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="app-logo"><span>T</span><strong>Token</strong></div>
        <div className="nav-group"><div className="nav-label">工作台</div>
          <button className={tab === 'overview' ? 'nav active' : 'nav'} onClick={() => setTab('overview')}><span>◫</span> 概览</button>
          {state.user.role === 'admin' && <button className={tab === 'users' ? 'nav active' : 'nav'} onClick={showUsers}><span>♙</span> 用户管理</button>}
        </div>
        <div className="sidebar-bottom"><div className="avatar">{state.user.username.slice(0, 1).toUpperCase()}</div><div><strong>{state.user.username}</strong><small>{state.user.role === 'admin' ? '管理员' : '普通用户'}</small></div><button className="logout" onClick={logout} aria-label="退出登录" title="退出登录">↪</button></div>
      </aside>
      <main className="main-content">
        <header><div><span className="eyebrow">TOKEN MONITOR</span><h1>{tab === 'users' ? '用户管理' : '用量概览'}</h1></div><div className="date-chip">本机 · 离线</div></header>
        {error && <div className="error banner" role="alert">{error}</div>}
        {tab === 'overview' ? <>
          <div className="hero-card"><div><span className="eyebrow light">WELCOME TO TOKEN</span><h2>你的 AI 编程用量，<br />从这里变得清晰。</h2><p>账户和应用骨架已就绪。下一阶段将连接 Codex 与 Claude Code 本机记录。</p></div><div className="hero-art"><div className="orbit one" /><div className="orbit two" /><div className="hero-core">T</div></div></div>
          <div className="section-heading"><h2>数据来源</h2><span>等待连接</span></div>
          <div className="source-grid"><div className="source-card"><div className="source-icon codex">◈</div><div><h3>Codex</h3><p>本机会话记录</p></div><span className="status-pill">即将支持</span></div><div className="source-card"><div className="source-icon claude">✳</div><div><h3>Claude Code</h3><p>本机会话记录</p></div><span className="status-pill">即将支持</span></div></div>
        </> : <>
          <p className="page-lead">管理可以登录此应用的账户。用户归属将在采集器完成后开放。</p>
          <section className="panel"><div className="panel-head"><h2>账户列表</h2><span>{users.length} 位用户</span></div><div className="table-wrap"><table><thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{user.role === 'admin' ? '管理员' : '普通用户'}</td><td><span className={user.active ? 'dot good' : 'dot'} />{user.active ? '启用' : '停用'}</td><td>{new Date(user.createdAt).toLocaleDateString('zh-CN')}</td><td><button className="text-button" disabled={user.id === state.user?.id} onClick={() => toggleUser(user)}>{user.active ? '停用' : '启用'}</button><button className="text-button" onClick={() => { setResetUser(user); setResetPassword(''); }}>重设密码</button></td></tr>)}</tbody></table></div>{resetUser && <form className="reset-form" onSubmit={savePassword}><strong>为 {resetUser.username} 设置新密码</strong><input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="新密码至少 10 位" autoFocus /><button className="primary" disabled={busy}>保存密码</button><button type="button" className="text-button" onClick={() => setResetUser(null)}>取消</button></form>}</section>
          <section className="panel add-user"><h2>新增账户</h2><form onSubmit={createUser}><label>用户名<input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="3–32 位" /></label><label>初始密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 10 位" /></label><label>角色<select value={newRole} onChange={e => setNewRole(e.target.value as Role)}><option value="viewer">普通用户</option><option value="admin">管理员</option></select></label><button className="primary" disabled={busy}>创建用户</button></form></section>
        </>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
