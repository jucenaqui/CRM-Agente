export type Role = 'admin' | 'sales';

/** Clave de una etapa del embudo. Las etapas las define cada cliente (ver Stage), así que es un texto libre. */
export type DealStage = string;

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'task', 'note'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Company {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  companyId: number | null;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: number;
  title: string;
  value: number;
  currency: string;
  stage: DealStage;
  contactId: number | null;
  companyId: number | null;
  ownerId: number;
  expectedCloseDate: string | null;
  /** Fecha real de cierre: la pone el servidor al entrar en una etapa ganada o perdida. */
  closedAt: string | null;
  sourceId: number | null;
  lostReasonId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: number;
  type: ActivityType;
  subject: string;
  description: string | null;
  dueDate: string | null;
  completed: boolean;
  contactId: number | null;
  dealId: number | null;
  ownerId: number;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface DashboardStats {
  totals: {
    companies: number;
    contacts: number;
    deals: number;
    openDealsValue: number;
    wonDealsValue: number;
  };
  dealsByStage: { stage: DealStage; name?: string; kind?: StageKind; color?: string; count: number; value: number }[];
  upcomingActivities: Activity[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface CompanyInput {
  name: string;
  industry?: string | null;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface ContactInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  companyId?: number | null;
}

export interface DealInput {
  title: string;
  value: number;
  currency?: string;
  stage?: DealStage;
  contactId?: number | null;
  companyId?: number | null;
  expectedCloseDate?: string | null;
  sourceId?: number | null;
  lostReasonId?: number | null;
}

export interface ActivityInput {
  type: ActivityType;
  subject: string;
  description?: string | null;
  dueDate?: string | null;
  completed?: boolean;
  contactId?: number | null;
  dealId?: number | null;
}

export interface UserInput {
  name: string;
  email: string;
  password?: string;
  role: Role;
}

// ---- Embudo configurable ----

export type StageKind = 'open' | 'won' | 'lost';

export interface Stage {
  id: number;
  key: DealStage;
  name: string;
  position: number;
  probability: number;
  kind: StageKind;
  color: string;
}

export type OptionKind = 'lead_source' | 'loss_reason';

export interface CrmOption {
  id: number;
  kind: OptionKind;
  name: string;
  position: number;
  archived: boolean;
}

export interface PipelineOverview {
  stages: Stage[];
  leadSources: CrmOption[];
  lossReasons: CrmOption[];
}

export interface DealHistoryItem {
  id: number;
  fromStage: DealStage | null;
  toStage: DealStage;
  changedAt: string;
  changedByName: string | null;
}

// ---- Métricas ----

export type MetricsPeriod = '30d' | '90d' | '12m' | 'all';

export interface Metrics {
  period: MetricsPeriod;
  from: string;
  generatedAt: string;
  summary: {
    wonCount: number;
    wonValue: number;
    lostCount: number;
    lostValue: number;
    winRate: number | null;
    avgDealSize: number | null;
    avgCycleDays: number | null;
    openCount: number;
    openValue: number;
    weightedForecast: number;
    stalledCount: number;
    overdueActivities: number;
  };
  salesByMonth: { month: string; wonCount: number; wonValue: number; lostCount: number }[];
  forecast: {
    weighted: number;
    expectedThisMonth: number;
    overdueExpected: number;
    byStage: { stage: DealStage; name: string; probability: number; count: number; value: number; weighted: number }[];
  };
  funnel: { stage: DealStage; name: string; kind: StageKind; reached: number; conversionFromPrev: number | null; avgDaysInStage: number | null }[];
  bySource: { sourceId: number | null; name: string; deals: number; won: number; lost: number; wonValue: number; winRate: number | null }[];
  lostReasons: { reasonId: number | null; name: string; count: number; value: number }[];
  activities: { completed: number; overdue: number; completedByType: { type: string; count: number }[] };
  stalled: { id: number; title: string; value: number; stage: DealStage; days: number }[];
  byOwner?: {
    ownerId: number;
    name: string;
    openCount: number;
    openValue: number;
    weighted: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    winRate: number | null;
    activitiesCompleted: number;
  }[];
}
