import request from 'supertest';
import { app } from '../../src/app';

export const api = () => request(app);

export async function register(name: string, email: string, password = 'Password123!') {
  const r = await api().post('/api/auth/register').send({ name, email, password });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token as string, user: r.body.user };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
