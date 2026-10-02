export type Role = 'superadmin' | 'admin' | 'viewer';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface AppState {
  needsSetup: boolean;
  user: PublicUser | null;
  superadminIssue?: string | null;
}

export type Provider = 'codex' | 'claude';

export interface SourceStatus {
  provider: Provider;
  status: 'scanning' | 'ready' | 'no_records' | 'not_found' | 'error' | 'idle';
  fileCount: number;
  factCount: number;
  telemetryFactCount: number;
  lastTelemetry: string | null;
  lastScan: string | null;
  detail: string | null;
}

export interface SourceIdentity {
  key: string;
  provider: Provider;
  label: string;
  ownerUserId: string | null;
  factCount: number;
}

export interface TelemetryConfiguration {
  running: boolean;
  error: string | null;
  codex: string;
  claude: string;
  codexWarning: string | null;
  claudeWarning: string | null;
}

export interface ServerStatus {
  url: string;
  online: boolean;
  error: string | null;
  hasToken: boolean;
}

export interface UploadStatus {
  pending: number;
  lastSuccess: string | null;
  lastError: string | null;
  lastAttempt: string | null;
}

export interface UpdateStatus {
  available: boolean;
  version: string | null;
  currentVersion: string;
  error: string | null;
}

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface ReportQuery {
  from: string;
  to: string;
  timeZone: string;
  granularity: Granularity;
  provider: Provider | 'all';
  model: string;
  projectKey?: string;
  userId: string;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  requests: number;
}

export interface ReportPoint extends TokenTotals {
  period: string;
}

export interface ModelTotal extends TokenTotals {
  provider: Provider;
  model: string;
}

export interface ProjectTotal extends TokenTotals {
  key: string;
  label: string;
}

export interface UsageReport {
  query: ReportQuery;
  totals: TokenTotals;
  points: ReportPoint[];
  models: ModelTotal[];
  projects: ProjectTotal[];
  providers: Array<TokenTotals & { provider: Provider }>;
  availableModels: string[];
  availableProjects: Array<{ key: string; label: string }>;
  coverage: SourceStatus[];
}

export interface UsageDetail {
  id: string;
  provider: Provider;
  model: string;
  projectKey: string;
  projectLabel: string;
  occurredAt: string;
  source: 'local' | 'telemetry';
  sourceLabel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface CollectionDiagnostic {
  provider: Provider;
  status: SourceStatus['status'];
  location: string;
  fileCount: number;
  factCount: number;
  unknownProjectCount: number;
  unassignedFactCount: number;
  pendingTailCount: number;
  malformedCount: number;
  oversizedCount: number;
  unreadableCount: number;
  lastScan: string | null;
  lastSuccess: string | null;
  reason: string;
  suggestion: string;
}

export interface AccountCollectionStatus {
  user: PublicUser;
  sourceCount: number;
  factCount: number;
  lastRecord: string | null;
  sources: Array<{ provider: Provider; status: SourceStatus['status']; lastScan: string | null; detail: string | null }>;
}

export interface FeedbackItem {
  id: string;
  username: string;
  category: 'missing_usage' | 'report' | 'update' | 'other';
  title: string;
  message: string;
  status: 'open' | 'resolved';
  createdAt: string;
  diagnostics: string | null;
  appVersion: string;
  platform: string;
}

export interface FeedbackSubmission {
  id: string;
  delivery: 'sent' | 'queued';
}

export interface UsageDetailsPage {
  records: UsageDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TokenApi {
  getState(): Promise<AppState>;
  getAppInfo(): Promise<{ version: string; platform: string }>;
  setupAdmin(username: string, password: string, trustDevice?: boolean): Promise<PublicUser>;
  login(username: string, password: string, trustDevice?: boolean): Promise<PublicUser>;
  logout(): Promise<void>;
  listUsers(): Promise<PublicUser[]>;
  createUser(username: string, password: string, role: Role): Promise<PublicUser>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  changePassword(userId: string, password: string): Promise<void>;
  resolveAdminNameConflict(newUsername: string): Promise<void>;
  getSourceStatuses(): Promise<SourceStatus[]>;
  getCollectionDiagnostics(): Promise<CollectionDiagnostic[]>;
  getAccountCollectionStatuses(): Promise<AccountCollectionStatus[]>;
  scanSources(): Promise<SourceStatus[]>;
  getSourceIdentities(): Promise<SourceIdentity[]>;
  bindSourceIdentity(key: string, userId: string | null): Promise<void>;
  getTelemetryConfiguration(): Promise<TelemetryConfiguration>;
  getServerStatus(): Promise<ServerStatus>;
  configureServer(url: string, token: string, adminToken?: string): Promise<ServerStatus>;
  getUploadStatus(): Promise<UploadStatus>;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<string>;
  backupDatabase(): Promise<boolean>;
  restoreDatabase(): Promise<boolean>;
  openFilePermissions(): Promise<void>;
  submitFeedback(category: FeedbackItem['category'], title: string, message: string, attachDiagnostics: boolean): Promise<FeedbackSubmission>;
  getMyFeedback(): Promise<FeedbackSubmission[]>;
  retryFeedback(): Promise<FeedbackSubmission[]>;
  listFeedback(): Promise<FeedbackItem[]>;
  setFeedbackResolved(id: string, resolved: boolean): Promise<void>;
  queryUsage(query: ReportQuery): Promise<UsageReport>;
  queryUsageDetails(query: ReportQuery, page: number, period: string): Promise<UsageDetailsPage>;
  exportCsv(query: ReportQuery): Promise<boolean>;
}
