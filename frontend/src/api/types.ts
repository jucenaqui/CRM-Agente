export type Role = 'admin' | 'sales';

export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

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
  dealsByStage: { stage: DealStage; count: number; value: number }[];
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
