import type { AppDatabase } from './database';
import type { UsageScanner } from '../collectors/scanner';
import type { OnboardingStatus, PublicUser } from '../shared/types';
import { reconcileFacts } from './reconcile';
import type { ReconciliationFact } from './reconcile';

export function onboardingStatus(db: AppDatabase, scanner: UsageScanner, actor: PublicUser): OnboardingStatus {
  const admin = actor.role !== 'viewer';
  const sources = admin ? scanner.statuses() : [];
  const diagnosticReasons = admin ? db.all('SELECT diagnostic_json FROM source_status').map(row => {
    try { return String((JSON.parse(String(row.diagnostic_json)) as { reason?: string }).reason || ''); }
    catch { return ''; }
  }) : [];
  const owned = Number(db.one(`SELECT COUNT(*) AS count FROM source_identities
    WHERE owner_user_id IS NOT NULL ${admin ? '' : 'AND owner_user_id = ?'}`,
  admin ? [] : [actor.id])?.count ?? 0);
  const facts = db.all(`SELECT f.source_key, f.provider, f.session_id, f.occurred_at, f.total_tokens, s.owner_user_id,
      CASE WHEN uncertain.source_key IS NULL THEN 0 ELSE 1 END AS identity_uncertain
    FROM usage_facts f JOIN source_identities s ON s.key = f.source_identity_key
    LEFT JOIN usage_uncertain_facts uncertain ON uncertain.source_key = f.source_key
    WHERE s.owner_user_id IS NOT NULL ${admin ? '' : 'AND s.owner_user_id = ?'}`,
  admin ? [] : [actor.id]) as unknown as Array<ReconciliationFact & { total_tokens: number }>;
  const reconciled = reconcileFacts(facts);
  const confirmed = reconciled.confirmed.filter(fact => Number(fact.total_tokens) > 0).length;
  const pending = reconciled.pending.length;
  const detected = admin
    ? sources.some(source => source.status === 'ready' || source.status === 'no_records' || source.status === 'scanning') ||
      diagnosticReasons.some(reason => ['permission_denied', 'unreadable_file', 'invalid_record', 'oversized_record'].includes(reason))
    : owned > 0;
  const scanned = admin
    ? Boolean(db.one("SELECT 1 FROM source_status WHERE status IN ('ready','no_records','scanning') AND last_success IS NOT NULL LIMIT 1"))
    : false;
  return {
    steps: [
      { key: 'detect', state: detected ? 'complete' : admin ? 'pending' : 'unknown',
        detail: detected ? '检测到可识别的数据来源。' : admin ? '尚未检测到可用来源，请检查会话目录或权限。' : '当前账户尚无已归属来源，请联系管理员检查。' },
      { key: 'scan', state: scanned ? 'complete' : admin ? 'pending' : 'unknown',
        detail: scanned ? sources.some(source => source.status === 'scanning')
          ? '已有成功的本机扫描记录，当前正在重扫。' : '已有成功的本机扫描记录。'
          : admin ? '尚无当前成功扫描；请运行扫描并查看诊断。' : '当前账户无法核对来源级扫描结果，请联系管理员确认。' },
      { key: 'bind', state: owned ? 'complete' : 'pending',
        detail: owned ? admin ? '已有来源归属到应用用户。' : '已有来源归属到当前账户。'
          : admin ? '请为识别出的来源指定应用用户。' : '尚无归属到当前账户的来源，请联系管理员处理。' },
      { key: 'usage', state: confirmed ? 'complete' : 'pending',
        detail: confirmed ? '已观测到归属范围内第一笔已确认用量；完整覆盖仍需核对。'
          : pending ? '已有待核对记录，但尚无已确认的第一笔用量；请在报表查看冲突来源。'
            : '尚未观测到归属范围内的用量；这不代表零用量，请检查归属和采集诊断。' }
    ]
  };
}
