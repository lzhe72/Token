import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { AppDatabase } from './database';
import { AuthService } from './auth';
import { UsageScanner } from '../collectors/scanner';
import { ReportService } from './report';
import { TelemetryReceiver } from './telemetry';
import { TrustedDeviceStore } from './trusted-device';
import { ServerConnection } from './server-connection';
import { UsageSync } from './usage-sync';
import { UpdateClient } from './update-client';
import type { PublicUser } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let database: AppDatabase | null = null;
let scanner: UsageScanner | null = null;
let telemetry: TelemetryReceiver | null = null;
let connection: ServerConnection | null = null;
let usageSync: UsageSync | null = null;
const sessions = new Map<number, string>();

function checkSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() ||
    event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('请求来源无效');
  }
}

function currentUser(event: Electron.IpcMainInvokeEvent, auth: AuthService): PublicUser {
  checkSender(event);
  const id = sessions.get(event.sender.id);
  const user = id ? auth.getUser(id) : null;
  if (!user || !user.active) {
    sessions.delete(event.sender.id);
    throw new Error('请先登录');
  }
  return user;
}

function requireAdmin(event: Electron.IpcMainInvokeEvent, auth: AuthService): PublicUser {
  const user = currentUser(event, auth);
  if (user.role !== 'admin') throw new Error('需要管理员权限');
  return user;
}

function registerIpc(auth: AuthService, sources: UsageScanner, reports: ReportService, receiver: TelemetryReceiver, db: AppDatabase,
  trusted: TrustedDeviceStore, server: ServerConnection, sync: UsageSync, updater: UpdateClient): void {
  function forgetDevice(): void {
    const token = trusted.read();
    if (token) auth.revokeTrustedDevice(token);
    trusted.clear();
  }

  function rememberDevice(user: PublicUser, enabled: unknown): void {
    forgetDevice();
    if (enabled === true) {
      const token = auth.issueTrustedDevice(user.id);
      try { trusted.write(token); }
      catch (error) { auth.revokeTrustedDevice(token); throw error; }
    } else if (enabled !== false && enabled !== undefined) {
      throw new Error('信任设备参数无效');
    }
  }

  ipcMain.handle('auth:state', event => {
    checkSender(event);
    let id = sessions.get(event.sender.id);
    if (!id) {
      const token = trusted.read();
      const restored = token ? auth.authenticateTrustedDevice(token) : null;
      if (restored) {
        id = restored.id;
        sessions.set(event.sender.id, id);
      } else if (token) trusted.clear();
    }
    const user = id ? auth.getUser(id) : null;
    return { needsSetup: auth.needsSetup(), user: user?.active ? user : null };
  });
  ipcMain.handle('auth:setup', async (event, username: unknown, password: unknown, trustDevice: unknown) => {
    checkSender(event);
    const user = await auth.setupAdmin(username, password);
    rememberDevice(user, trustDevice);
    sessions.set(event.sender.id, user.id);
    return user;
  });
  ipcMain.handle('auth:login', async (event, username: unknown, password: unknown, trustDevice: unknown) => {
    checkSender(event);
    const user = await auth.login(username, password);
    rememberDevice(user, trustDevice);
    sessions.set(event.sender.id, user.id);
    return user;
  });
  ipcMain.handle('auth:logout', event => {
    checkSender(event);
    forgetDevice();
    sessions.delete(event.sender.id);
  });
  ipcMain.handle('users:list', event => {
    requireAdmin(event, auth);
    return auth.listUsers();
  });
  ipcMain.handle('users:create', (event, username: unknown, password: unknown, role: unknown) => {
    const actor = requireAdmin(event, auth);
    return auth.createUser(username, password, role, actor.id);
  });
  ipcMain.handle('users:set-active', (event, userId: unknown, active: unknown) => {
    const actor = requireAdmin(event, auth);
    auth.setActive(userId, active, actor.id);
  });
  ipcMain.handle('users:change-password', (event, userId: unknown, password: unknown) => {
    const actor = requireAdmin(event, auth);
    return auth.changePassword(userId, password, actor.id);
  });
  ipcMain.handle('sources:statuses', event => {
    currentUser(event, auth);
    return sources.statuses();
  });
  ipcMain.handle('sources:scan', async event => {
    requireAdmin(event, auth);
    await sources.scan();
    return sources.statuses();
  });
  ipcMain.handle('sources:identities', event => {
    requireAdmin(event, auth);
    return sources.identities();
  });
  ipcMain.handle('sources:bind', (event, key: unknown, userId: unknown) => {
    const actor = requireAdmin(event, auth);
    sources.bindIdentity(key, userId, actor.id);
  });
  ipcMain.handle('telemetry:configuration', event => {
    requireAdmin(event, auth);
    return receiver.configuration();
  });
  ipcMain.handle('server:status', event => {
    currentUser(event, auth);
    return server.status();
  });
  ipcMain.handle('server:configure', (event, url: unknown, token: unknown) => {
    requireAdmin(event, auth);
    server.setConfiguration(url, token);
    return server.status();
  });
  ipcMain.handle('sync:status', event => {
    currentUser(event, auth);
    return sync.status();
  });
  ipcMain.handle('update:check', event => {
    currentUser(event, auth);
    return updater.check();
  });
  ipcMain.handle('update:download', event => {
    requireAdmin(event, auth);
    return updater.downloadAndOpen();
  });
  ipcMain.handle('data:backup', async event => {
    requireAdmin(event, auth);
    if (!mainWindow) throw new Error('窗口已关闭');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '备份 Token 数据库', defaultPath: 'Token-backup.sqlite',
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }]
    });
    if (result.canceled || !result.filePath) return false;
    const liveFile = path.join(app.getPath('userData'), 'token.sqlite');
    if (path.resolve(result.filePath) === path.resolve(liveFile)) throw new Error('不能覆盖正在使用的数据库');
    db.backupTo(result.filePath);
    return true;
  });
  ipcMain.handle('data:restore', async event => {
    requireAdmin(event, auth);
    if (!mainWindow) throw new Error('窗口已关闭');
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Token 数据库备份', properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }]
    });
    if (selected.canceled || !selected.filePaths[0]) return false;
    const source = selected.filePaths[0];
    const liveFile = path.join(app.getPath('userData'), 'token.sqlite');
    if (path.resolve(source) === path.resolve(liveFile)) throw new Error('备份文件不能是当前数据库');
    await AppDatabase.validateBackup(source);
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'warning', buttons: ['取消', '恢复并重启'], defaultId: 0, cancelId: 0,
      message: '恢复备份会替换当前账户和用量数据。',
      detail: '应用会先保留当前数据库副本，然后重启。请确认已选择正确的备份文件。'
    });
    if (answer.response !== 1) return false;
    const staged = `${liveFile}.restore.tmp`;
    fs.copyFileSync(source, staged);
    fs.chmodSync(staged, 0o600);
    receiver.stop();
    sources.stop();
    await sources.waitIdle();
    db.close();
    fs.copyFileSync(liveFile, `${liveFile}.before-restore`);
    fs.chmodSync(`${liveFile}.before-restore`, 0o600);
    fs.renameSync(staged, liveFile);
    trusted.clear();
    app.relaunch({ args: process.argv.slice(1) });
    setImmediate(() => app.exit(0));
    return true;
  });
  ipcMain.handle('usage:query', (event, query: unknown) => {
    const actor = currentUser(event, auth);
    return reports.query(query, actor);
  });
  ipcMain.handle('usage:details', (event, query: unknown, page: unknown, period: unknown) => {
    const actor = currentUser(event, auth);
    return reports.details(query, page, period, actor);
  });
  ipcMain.handle('reports:export-csv', async (event, query: unknown) => {
    const actor = currentUser(event, auth);
    const csv = reports.csv(query, actor);
    if (!mainWindow) throw new Error('窗口已关闭');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Token 用量报表',
      defaultPath: 'Token-usage.csv',
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, csv, { encoding: 'utf8', mode: 0o600 });
    return true;
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#f5f6fa',
    title: 'Token',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const webContentsId = window.webContents.id;
  window.on('closed', () => {
    sessions.delete(webContentsId);
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
}

app.whenReady().then(async () => {
  const userDataArg = process.argv.find(arg => arg.startsWith('--token-user-data='));
  if (userDataArg) {
    const userDataPath = path.resolve(userDataArg.slice('--token-user-data='.length));
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    app.setPath('userData', userDataPath);
  }
  database = await AppDatabase.open(path.join(app.getPath('userData'), 'token.sqlite'));
  scanner = new UsageScanner(database);
  telemetry = new TelemetryReceiver(database, app.getPath('userData'));
  await telemetry.start();
  connection = new ServerConnection(app.getPath('userData'), safeStorage);
  await connection.startLocalService();
  usageSync = new UsageSync(database, scanner, connection);
  scanner.setAfterScan(() => usageSync!.afterScan());
  usageSync.start();
  const updater = new UpdateClient(connection, path.join(app.getPath('userData'), 'updates'), app.getVersion(), process.arch,
    file => shell.openPath(file));
  registerIpc(new AuthService(database), scanner, new ReportService(database, scanner), telemetry, database,
    new TrustedDeviceStore(app.getPath('userData'), safeStorage), connection, usageSync, updater);
  createWindow();
  scanner.start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  console.error('Token failed to start:', error);
  app.quit();
});

app.on('before-quit', () => {
  scanner?.stop();
  telemetry?.stop();
  usageSync?.stop();
  connection?.stop();
  scanner = null;
  telemetry = null;
  database = null;
});

app.on('window-all-closed', () => {
  app.quit();
});
