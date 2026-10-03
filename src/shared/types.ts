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
  status: 'scanning' | 'cancelled' | 'ready' | 'no_records' | 'not_found' | 'error' | 'idle';
  fileCount: number | null;
  factCount: number | null;
  telemetryFactCount: number | null;
  lastTelemetry: string | null;
  lastScan: string | null;
  detail: string | null;
  windowCoverage?: {
    state: 'unknown' | 'partial' | 'complete';
    reason: string;
    asOf: string | null;
    lastObserved: string | null;
  };
}

export interface SourceIdentity {
  key: string;
  provider: Provider;
  label: string;
  ownerUserId: string | null;
  factCount: number;
}

export interface BindingScopeSummary {
  observedFacts: number;
  confirmedFacts: number;
  confirmedTokens: number;
  pendingFacts: number;
  coverage: 'unknown' | 'partial' | 'complete';
}

export interface SourceBindingPreview {
  id: string;
  sourceKey: string;
  sourceLabel: string;
  oldOwnerId: string | null;
  newOwnerId: string | null;
  oldOwnerLabel: string;
  newOwnerLabel: string;
  affectedFactCount: number;
  filter: Omit<ReportQuery, 'userId'>;
  before: { oldOwner: BindingScopeSummary; newOwner: BindingScopeSummary };
  after: { oldOwner: BindingScopeSummary; newOwner: BindingScopeSummary };
  expiresAt: string;
}

export interface SourceBindingResult {
  localCommitted: true;
  service: 'synced' | 'pending';
  syncError: string | null;
}

export interface OnboardingStatus {
  steps: Array<{ key: 'detect' | 'scan' | 'bind' | 'usage';
    state: 'complete' | 'pending' | 'unknown'; detail: string }>;
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
  serviceType: 'built_in' | 'configured';
  configurationSource: 'default' | 'explicit' | 'legacy';
  remoteConfigured: boolean;
  reachable: boolean;
  authorization: 'authorized' | 'missing' | 'rejected' | 'unknown';
  protocol: 'compatible' | 'incompatible' | 'unknown';
}

export interface UploadStatus {
  pending: number | null;
  uncertainRows: number | null;
  localRevision: number | null;
  confirmedRevision: number | null;
  currentConfirmed: boolean | null;
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
  snapshotId: string;
  accounting: { status: 'confirmed' | 'uncertain'; confirmedSubtotal: TokenTotals;
    conflictCount: number; conflictSources: Array<'local' | 'telemetry'> };
  totals: TokenTotals;
  points: ReportPoint[];
  models: ModelTotal[];
  projects: ProjectTotal[];
  providers: Array<TokenTotals & { provider: Provider }>;
  availableModels: string[];
  availableModelOptions: Array<{ provider: Provider; model: string }>;
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
  accountingStatus: 'confirmed' | 'pending';
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
  fileCount: number | null;
  factCount: number | null;
  unknownProjectCount: number | null;
  unassignedFactCount: number | null;
  pendingTailCount: number | null;
  malformedCount: number | null;
  oversizedCount: number | null;
  unreadableCount: number | null;
  lastScan: string | null;
  lastSuccess: string | null;
  reason: string;
  suggestion: string;
  progress?: {
    phase: 'discovering' | 'reading' | 'finalizing' | 'cancelling';
    processedFiles: number;
    discoveredFiles: number | null;
    lastProgressAt: string;
  };
}

export interface ScanProgress {
  provider: Provider;
  progress: NonNullable<CollectionDiagnostic['progress']>;
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
  getAppInfo(): Promise<{ version: string; platform: string;
    installResult: { status: 'success' | 'rollback'; version: string; message: string } | null }>;
  setupAdmin(username: string, password: string, trustDevice?: boolean): Promise<PublicUser>;
  login(username: string, password: string, trustDevice?: boolean): Promise<PublicUser>;
  logout(): Promise<void>;
  listUsers(): Promise<PublicUser[]>;
  createUser(username: string, password: string, role: Role): Promise<PublicUser>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  changePassword(userId: string, password: string): Promise<void>;
  resolveAdminNameConflict(newUsername: string): Promise<void>;
  getSourceStatuses(): Promise<SourceStatus[]>;
  getOnboardingStatus(): Promise<OnboardingStatus>;
  getCollectionDiagnostics(): Promise<CollectionDiagnostic[]>;
  getAccountCollectionStatuses(): Promise<AccountCollectionStatus[]>;
  scanSources(): Promise<SourceStatus[]>;
  cancelScan(): Promise<boolean>;
  getScanProgress(): Promise<ScanProgress[]>;
  getSourceIdentities(): Promise<SourceIdentity[]>;
  previewSourceBinding(key: string, userId: string | null, filter: ReportQuery): Promise<SourceBindingPreview>;
  confirmSourceBinding(previewId: string): Promise<SourceBindingResult>;
  cancelSourceBinding(previewId: string): Promise<void>;
  getTelemetryConfiguration(): Promise<TelemetryConfiguration>;
  getServerStatus(): Promise<ServerStatus>;
  configureServer(url: string, token: string, adminToken?: string): Promise<ServerStatus>;
  useBuiltInServer(): Promise<ServerStatus>;
  getUploadStatus(): Promise<UploadStatus>;
  retryUpload(): Promise<UploadStatus>;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<string>;
  backupDatabase(): Promise<boolean>;
  restoreDatabase(): Promise<boolean>;
  openFilePermissions(): Promise<void>;
  submitFeedback(category: FeedbackItem['category'], title: string, message: string, attachDiagnostics: boolean, id: string): Promise<FeedbackSubmission>;
  getMyFeedback(): Promise<FeedbackSubmission[]>;
  retryFeedback(): Promise<FeedbackSubmission[]>;
  listFeedback(): Promise<FeedbackItem[]>;
  setFeedbackResolved(id: string, resolved: boolean): Promise<void>;
  queryUsage(query: ReportQuery): Promise<UsageReport>;
  queryUsageDetails(query: ReportQuery, page: number, period: string, snapshotId?: string): Promise<UsageDetailsPage>;
  exportCsv(query: ReportQuery, snapshotId?: string): Promise<boolean>;
}
