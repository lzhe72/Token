import React from 'react';
import type { OnboardingStatus, PublicUser } from '../shared/types';

const labels = { detect: '检测数据来源', scan: '完成采集扫描', bind: '确认来源归属', usage: '看到第一笔已确认用量' };
const stateLabels = { complete: '已完成', pending: '待完成', unknown: '待管理员确认' };

export function OnboardingPanel({ status, user, onNavigate, onSkip, onRefresh }: {
  status: OnboardingStatus | null;
  user: PublicUser;
  onNavigate: (page: 'sources' | 'diagnostics' | 'report') => void;
  onSkip: () => void;
  onRefresh: () => void;
}) {
  const steps = status?.steps ?? [];
  const completed = steps.filter(step => step.state === 'complete').length;
  return <div className="onboarding-page">
    <p className="page-lead">按实际采集状态完成四步。进入相关页面操作后可返回引导；结束引导不会修改来源、扫描或用量。</p>
    <section className="panel"><div className="panel-head"><h2>首次使用引导</h2><span>{status ? `${completed} / 4 步已完成` : '正在核对'}</span></div>
      <div className="onboarding-steps">{steps.map((step, index) => {
        const viewer = user.role === 'viewer';
        const target = step.key === 'usage' ? 'report' : step.key === 'detect' ? 'diagnostics'
          : viewer ? 'diagnostics' : 'sources';
        const action = step.key === 'usage' ? '查看用量报表' : step.key === 'detect' ? '查看采集诊断'
          : viewer ? '查看本人采集状态' : step.key === 'scan' ? '前往扫描来源' : '管理来源归属';
        return <div className="onboarding-step" key={step.key}>
          <span className="step-number">{index + 1}</span><div><h3>{labels[step.key]}</h3><p>{step.detail}</p><small>{stateLabels[step.state]}</small></div>
          <button type="button" className="text-button" onClick={() => onNavigate(target)}>{action}</button>
        </div>;
      })}</div>
      {!status && <p role="status">正在读取当前账户的引导状态…</p>}
      <div className="onboarding-actions"><button type="button" onClick={onRefresh}>重新核对进度</button><button type="button" className="text-button" onClick={onSkip}>{status && completed === steps.length ? '完成引导' : '跳过引导'}</button></div>
    </section>
  </div>;
}
