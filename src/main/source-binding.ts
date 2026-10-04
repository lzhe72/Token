import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import type { AppDatabase } from './database';
import type { UsageScanner } from '../collectors/scanner';
import type { ReportService } from './report';
import type { UsageSync } from './usage-sync';
import type { BindingEvidenceDeclaration, BindingScopeSummary, PublicUser, ReportQuery, SourceBindingPreview, SourceBindingResult, UsageReport } from '../shared/types';

const PREVIEW_LIFETIME_MS = 5 * 60_000;
const rollbackPreview = Symbol('preview rollback');
export class BindingEvidenceError extends Error {
  constructor(readonly field: keyof BindingEvidenceDeclaration, message: string) { super(message); }
}

interface PendingPreview {
  actorId: string;
  sourceKey: string;
  newOwnerId: string | null;
  baseline: string;
  expiresAt: number;
}

function summary(report: UsageReport): BindingScopeSummary {
  return {
    observedFacts: report.coverage.reduce((total, source) => total + (source.factCount ?? 0) + (source.telemetryFactCount ?? 0), 0),
    confirmedFacts: report.totals.requests,
    confirmedTokens: report.accounting.confirmedSubtotal.totalTokens,
    pendingFacts: report.accounting.conflictCount,
    coverage: report.coverage.every(source => source.windowCoverage?.state === 'complete') ? 'complete' :
      report.coverage.some(source => source.windowCoverage?.state === 'partial') ? 'partial' : 'unknown'
  };
}

export class SourceBindingService {
  private readonly pending = new Map<string, PendingPreview>();

  constructor(private readonly db: AppDatabase, private readonly scanner: UsageScanner,
    private readonly reports: ReportService, private readonly sync: UsageSync) {}

  private actorAllowed(actor: PublicUser): void {
    const current = this.db.one('SELECT role, active FROM users WHERE id = ?', [actor.id]);
    if (!current || Number(current.active) !== 1 || current.role === 'viewer' || actor.role === 'viewer') {
      throw new Error('需要管理员权限');
    }
  }

  private source(key: unknown): { key: string; provider: 'codex' | 'claude'; label: string; ownerId: string | null } {
    if (typeof key !== 'string' || key.length > 500) throw new Error('来源无效');
    const row = this.db.one('SELECT key, provider, label, owner_user_id FROM source_identities WHERE key = ?', [key]);
    if (!row || (row.provider !== 'codex' && row.provider !== 'claude')) throw new Error('来源不存在，请刷新列表');
    if (key.startsWith('codex:otel:unknown:') || key.startsWith('codex:otel:legacy-ambiguous:') ||
        key.startsWith('codex:legacy-unverified:') || key.startsWith('claude:legacy-unverified:') ||
        key.startsWith('claude:otel:unknown:') || key.startsWith('claude:otel:legacy-unverified:') ||
        key.startsWith('claude:macos:') || key.startsWith('claude:local-file-unknown:')) {
      throw new Error(row.provider === 'claude'
        ? '账户身份无法验证，历史归属已暂停；请启用包含 user.account_uuid 或 user.account_id 的遥测并核对新来源'
        : '账户身份无法验证，历史归属已暂停；请重新启用包含 account_id 的遥测并核对新来源');
    }
    const oldFallback = `codex:otel:${createHash('sha256').update(os.userInfo().username).digest('hex').slice(0, 20)}`;
    if (key === oldFallback && !this.db.one(`SELECT 1 FROM usage_facts WHERE source_identity_key = ?
      AND source_key LIKE 'otel:codex:v2:%' LIMIT 1`, [key])) {
      throw new Error('账户身份尚未验证；请重新启用包含 account_id 的遥测并核对新来源');
    }
    return { key, provider: row.provider, label: String(row.label), ownerId: row.owner_user_id ? String(row.owner_user_id) : null };
  }

  private owner(id: string | null, requireActive = true): string {
    if (id === null) return '未归属';
    const row = this.db.one('SELECT username, active FROM users WHERE id = ?', [id]);
    if (!row) {
      if (requireActive) throw new Error('目标用户不存在，请刷新预览');
      return '已删除用户';
    }
    if (requireActive && Number(row.active) !== 1) throw new Error('目标用户不存在或已停用，请刷新预览');
    return `${String(row.username)}${Number(row.active) === 1 ? '' : '（已停用）'}`;
  }

  private baseline(key: string, newOwnerId: string | null, actorId: string): string {
    const source = this.source(key);
    const users = this.db.all('SELECT id, role, active FROM users WHERE id IN (?, ?, ?) ORDER BY id',
      [actorId, source.ownerId, newOwnerId]);
    const facts = this.db.all(`SELECT f.source_key, f.provider, f.session_id, f.model, f.occurred_at,
      f.input_tokens, f.output_tokens, f.cache_read_tokens, f.cache_creation_tokens, f.total_tokens,
      p.project_key, p.project_label FROM usage_facts f LEFT JOIN fact_projects p ON p.source_key=f.source_key
      WHERE f.source_identity_key = ? ORDER BY f.source_key`, [key]);
    return createHash('sha256').update(JSON.stringify([source, users, facts])).digest('hex');
  }

  private scoped(filter: ReportQuery, actor: PublicUser, ownerId: string | null): BindingScopeSummary {
    return summary(this.reports.query({ ...filter, userId: ownerId ?? 'unassigned' }, actor));
  }

  preview(key: unknown, newOwnerId: unknown, input: unknown, actor: PublicUser): SourceBindingPreview {
    this.actorAllowed(actor);
    for (const [id, item] of this.pending) if (Date.now() > item.expiresAt) this.pending.delete(id);
    if (this.pending.size >= 100) throw new Error('预览请求过多，请稍后重试');
    if (newOwnerId !== null && (typeof newOwnerId !== 'string' || newOwnerId.length > 100)) throw new Error('目标用户无效');
    const source = this.source(key);
    if (this.scanner.scanProgress().some(item => item.provider === source.provider)) throw new Error('该来源正在扫描，请完成后重新预览');
    const targetId = newOwnerId as string | null;
    if (source.ownerId === targetId) throw new Error('归属没有变化');
    const oldOwnerLabel = this.owner(source.ownerId, false);
    const newOwnerLabel = this.owner(targetId);
    // The report service validates dates, time zone, provider, model, project and actor scope.
    const normalized = this.reports.query({ ...(input as ReportQuery), userId: 'all' }, actor).query;
    const { userId: _ignored, ...filter } = normalized;
    const before = {
      oldOwner: this.scoped(normalized, actor, source.ownerId),
      newOwner: this.scoped(normalized, actor, targetId)
    };
    let after: SourceBindingPreview['after'] | null = null;
    try {
      this.db.transaction(() => {
        this.db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?', [targetId, source.key]);
        after = {
          oldOwner: this.scoped(normalized, actor, source.ownerId),
          newOwner: this.scoped(normalized, actor, targetId)
        };
        throw rollbackPreview;
      });
    } catch (error) { if (error !== rollbackPreview) throw error; }
    if (!after) throw new Error('无法生成归属预览');
    const id = randomUUID();
    const expiresAt = Date.now() + PREVIEW_LIFETIME_MS;
    this.pending.set(id, { actorId: actor.id, sourceKey: source.key, newOwnerId: targetId,
      baseline: this.baseline(source.key, targetId, actor.id), expiresAt });
    const affectedFactCount = Number(this.db.one('SELECT COUNT(*) AS count FROM usage_facts WHERE source_identity_key = ?', [source.key])?.count ?? 0);
    const context = this.scanner.identities().find(item => item.key === source.key);
    return { id, sourceKey: source.key, sourceLabel: source.label, oldOwnerId: source.ownerId, newOwnerId: targetId,
      oldOwnerLabel, newOwnerLabel, affectedFactCount, filter, before, after, expiresAt: new Date(expiresAt).toISOString(),
      projectLabel: context?.projectLabel ?? null, lastRecordAt: context?.lastRecordAt ?? null };
  }

  async confirm(id: unknown, actor: PublicUser, evidence?: unknown): Promise<SourceBindingResult> {
    this.actorAllowed(actor);
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('预览编号无效');
    const pending = this.pending.get(id);
    if (!pending || pending.actorId !== actor.id || Date.now() > pending.expiresAt) throw new Error('预览已过期，请重新预览');
    const fileAssignment = pending.sourceKey.startsWith('claude:local-file:') && pending.newOwnerId !== null;
    if (fileAssignment) {
      const declared = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
        ? evidence as Partial<BindingEvidenceDeclaration> : {};
      if (declared.evidenceCategory !== 'controlled_account_file_mapping' ||
          Object.keys(declared).some(key => !['evidenceCategory', 'evidenceSource', 'evidenceRef', 'evidenceReviewed'].includes(key))) {
        throw new BindingEvidenceError('evidenceCategory', '请选择受控账户与文件映射证据类别');
      }
      if (declared.evidenceSource !== 'external_managed_registry') {
        throw new BindingEvidenceError('evidenceSource', '证据出处必须是外部受管登记');
      }
      if (typeof declared.evidenceRef !== 'string' || !/^evr_[a-f0-9]{32}$/.test(declared.evidenceRef)) {
        throw new BindingEvidenceError('evidenceRef', '证据编号须为 evr_ 后接 32 位小写十六进制字符');
      }
      if (declared.evidenceReviewed !== true) {
        throw new BindingEvidenceError('evidenceReviewed', '请确认已在外部受管登记中人工核对');
      }
    }
    if (!fileAssignment && evidence !== undefined) throw new Error('此归属操作不接受文件登记证据');
    this.pending.delete(id);
    this.db.transactionDurable(() => {
      this.actorAllowed(actor);
      const source = this.source(pending.sourceKey);
      if (this.scanner.scanProgress().some(item => item.provider === source.provider)) throw new Error('该来源正在扫描，请完成后重新预览');
      this.owner(pending.newOwnerId);
      if (this.baseline(source.key, pending.newOwnerId, actor.id) !== pending.baseline) {
        throw new Error('来源或用户状态已变化，请重新预览');
      }
      const count = Number(this.db.one('SELECT COUNT(*) AS count FROM usage_facts WHERE source_identity_key = ?', [source.key])?.count ?? 0);
      this.db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?', [pending.newOwnerId, source.key]);
      this.scanner.recordBindingAudit(source.key, actor.id, source.ownerId, pending.newOwnerId, count,
        fileAssignment ? evidence as BindingEvidenceDeclaration : undefined);
      this.sync.queueSnapshot([source.provider]);
    });
    // A previous upload may have started before the authorization change. Send the
    // newly queued revision afterwards; a failed service call leaves it durable.
    const upload = this.sync.waitIdle().then(() => this.sync.flush()).catch(() => {});
    await Promise.race([upload, new Promise(resolve => setTimeout(resolve, 1500))]);
    const status = this.sync.status();
    return { localCommitted: true, service: status.currentConfirmed ? 'synced' : 'pending',
      syncError: status.currentConfirmed ? null : status.lastError };
  }

  cancel(id: unknown, actor: PublicUser): void {
    this.actorAllowed(actor);
    if (typeof id !== 'string') return;
    const pending = this.pending.get(id);
    if (pending?.actorId === actor.id) this.pending.delete(id);
  }
}
