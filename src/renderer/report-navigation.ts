import type { ReportQuery } from '../shared/types';

export interface ReportDestination {
  query: ReportQuery;
  period?: string;
  originId?: string;
}
