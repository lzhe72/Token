import { contextBridge, ipcRenderer } from 'electron';
import type { TokenApi } from '../shared/types';

const api: TokenApi = {
  getState: () => ipcRenderer.invoke('auth:state'),
  setupAdmin: (username, password) => ipcRenderer.invoke('auth:setup', username, password),
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  listUsers: () => ipcRenderer.invoke('users:list'),
  createUser: (username, password, role) => ipcRenderer.invoke('users:create', username, password, role),
  setUserActive: (userId, active) => ipcRenderer.invoke('users:set-active', userId, active),
  changePassword: (userId, password) => ipcRenderer.invoke('users:change-password', userId, password),
  getSourceStatuses: () => ipcRenderer.invoke('sources:statuses'),
  scanSources: () => ipcRenderer.invoke('sources:scan'),
  getSourceIdentities: () => ipcRenderer.invoke('sources:identities'),
  bindSourceIdentity: (key, userId) => ipcRenderer.invoke('sources:bind', key, userId),
  getTelemetryConfiguration: () => ipcRenderer.invoke('telemetry:configuration'),
  backupDatabase: () => ipcRenderer.invoke('data:backup'),
  restoreDatabase: () => ipcRenderer.invoke('data:restore'),
  queryUsage: query => ipcRenderer.invoke('usage:query', query),
  exportCsv: query => ipcRenderer.invoke('reports:export-csv', query)
};

contextBridge.exposeInMainWorld('tokenApi', api);
