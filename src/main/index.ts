import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { AppDatabase } from './database';
import { AuthService } from './auth';
import type { PublicUser } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let database: AppDatabase | null = null;
const sessions = new Map<number, string>();

function checkSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
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

function registerIpc(auth: AuthService): void {
  ipcMain.handle('auth:state', event => {
    checkSender(event);
    const id = sessions.get(event.sender.id);
    const user = id ? auth.getUser(id) : null;
    return { needsSetup: auth.needsSetup(), user: user?.active ? user : null };
  });
  ipcMain.handle('auth:setup', async (event, username: unknown, password: unknown) => {
    checkSender(event);
    const user = await auth.setupAdmin(username, password);
    sessions.set(event.sender.id, user.id);
    return user;
  });
  ipcMain.handle('auth:login', async (event, username: unknown, password: unknown) => {
    checkSender(event);
    const user = await auth.login(username, password);
    sessions.set(event.sender.id, user.id);
    return user;
  });
  ipcMain.handle('auth:logout', event => {
    checkSender(event);
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
  registerIpc(new AuthService(database));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  console.error('Token failed to start:', error);
  app.quit();
});

app.on('before-quit', () => {
  database?.close();
  database = null;
});

app.on('window-all-closed', () => {
  app.quit();
});
