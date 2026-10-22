import { request } from './client';
import type {
  Activity,
  ActivityInput,
  AuthResponse,
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  DashboardStats,
  Deal,
  DealInput,
  DealStage,
  ListParams,
  Paginated,
  User,
  UserInput,
} from './types';

export interface CompanyQuery extends ListParams {}
export interface ContactQuery extends ListParams {
  companyId?: number;
}
export interface DealQuery extends ListParams {
  stage?: DealStage;
  companyId?: number;
  contactId?: number;
}
export interface ActivityQuery extends ListParams {
  contactId?: number;
  dealId?: number;
  completed?: boolean;
}

function resource<T, I, Q extends ListParams = ListParams>(base: string) {
  return {
    list: (params?: Q) => request<Paginated<T>>(base, { query: params }),
    get: (id: number) => request<T>(`${base}/${id}`),
    create: (input: I) => request<T>(base, { method: 'POST', body: input }),
    update: (id: number, input: Partial<I>) => request<T>(`${base}/${id}`, { method: 'PATCH', body: input }),
    remove: (id: number) => request<void>(`${base}/${id}`, { method: 'DELETE' }),
  };
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      handleUnauthorized: false,
    }),
  register: (name: string, email: string, password: string) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { name, email, password },
      handleUnauthorized: false,
    }),
  me: () => request<User>('/auth/me'),
};

export const usersApi = resource<User, UserInput>('/users');
export const companiesApi = resource<Company, CompanyInput, CompanyQuery>('/companies');
export const contactsApi = resource<Contact, ContactInput, ContactQuery>('/contacts');
export const dealsApi = {
  ...resource<Deal, DealInput, DealQuery>('/deals'),
  moveStage: (id: number, stage: DealStage) =>
    request<Deal>(`/deals/${id}/stage`, { method: 'PATCH', body: { stage } }),
};
export const activitiesApi = {
  ...resource<Activity, ActivityInput, ActivityQuery>('/activities'),
  setCompleted: (id: number, completed: boolean) =>
    request<Activity>(`/activities/${id}`, { method: 'PATCH', body: { completed } }),
};
export const dashboardApi = {
  stats: () => request<DashboardStats>('/dashboard/stats'),
};
