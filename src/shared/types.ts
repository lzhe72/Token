export type Role = 'admin' | 'viewer';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AppState {
  needsSetup: boolean;
  user: PublicUser | null;
}

export type Provider = 'codex' | 'claude';

export interface SourceStatus {
  provider: Provider;
  status: 'scanning' | 'ready' | 'not_found' | 'error' | 'idle';
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
}

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface ReportQuery {
  from: string;
  to: string;
  timeZone: string;
  granularity: Granularity;
  provider: Provider | 'all';
  model: string;
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

export interface UsageReport {
  query: ReportQuery;
  totals: TokenTotals;
  points: ReportPoint[];
  models: ModelTotal[];
  providers: Array<TokenTotals & { provider: Provider }>;
  availableModels: string[];
  coverage: SourceStatus[];
}

export interface TokenApi {
  getState(): Promise<AppState>;
  setupAdmin(username: string, password: string): Promise<PublicUser>;
  login(username: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  listUsers(): Promise<PublicUser[]>;
  createUser(username: string, password: string, role: Role): Promise<PublicUser>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  changePassword(userId: string, password: string): Promise<void>;
  getSourceStatuses(): Promise<SourceStatus[]>;
  scanSources(): Promise<SourceStatus[]>;
  getSourceIdentities(): Promise<SourceIdentity[]>;
  bindSourceIdentity(key: string, userId: string | null): Promise<void>;
  getTelemetryConfiguration(): Promise<TelemetryConfiguration>;
  backupDatabase(): Promise<boolean>;
  restoreDatabase(): Promise<boolean>;
  queryUsage(query: ReportQuery): Promise<UsageReport>;
  exportCsv(query: ReportQuery): Promise<boolean>;
}
