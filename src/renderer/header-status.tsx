import React from 'react';
import type { ServerStatus, SourceStatus, UploadStatus } from '../shared/types';
import { localLabels, serviceLabels, syncLabels } from './service-state';

export function HeaderStatus({ sources, server, upload, onDiagnostics, onSettings }: {
  sources: SourceStatus[];
  server: ServerStatus | null;
  upload: UploadStatus | null;
  onDiagnostics: () => void;
  onSettings: () => void;
}) {
  const capture = !sources.length ? '采集待核对'
    : sources.some(source => source.status === 'error' || source.status === 'not_found' || source.status === 'cancelled') ? '采集需检查'
    : sources.some(source => source.status === 'scanning') ? '扫描中'
    : sources.every(source => source.status === 'ready' || source.status === 'no_records') ? '采集正常' : '采集待扫描';
  // Source scans alone never establish complete coverage for a selected report window.
  const coverage = sources.length && sources.every(source => source.windowCoverage?.state === 'complete')
    ? '覆盖已证实' : '覆盖未知';
  const sync = !upload || upload.pending === null ? '同步状态未知'
    : upload?.pending || (upload && !upload.currentConfirmed) ? '同步待处理'
    : upload?.currentConfirmed && server?.reachable ? '同步已确认' : '同步待处理';
  const service = serviceLabels(server);
  const delivery = syncLabels(upload);
  return <details className="header-status" aria-label="服务与采集状态">
    <summary aria-label={`${capture}，${coverage}，${sync}；查看详细诊断`}>
      <span>{capture}</span><i aria-hidden="true">·</i><span>{coverage}</span><i aria-hidden="true">·</i><span>{sync}</span>
    </summary>
    <div className="header-status-detail">
      <strong>状态详情</strong>
      <p>{localLabels(sources)}</p>
      <p>{service.type} · {service.connection} · {service.authorization} · {service.protocol}</p>
      <p>{delivery.delivery} · {delivery.review}</p>
      <div className="header-status-actions"><button type="button" onClick={onDiagnostics}>采集诊断</button><button type="button" onClick={onSettings}>系统设置</button></div>
    </div>
  </details>;
}
