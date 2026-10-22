import { z } from 'zod';
import { buildCrud } from '../lib/crud.js';
import { optText, optUrl, reqText } from '../lib/validation.js';

const fields = {
  name: reqText(200),
  industry: optText(100),
  website: optUrl(),
  phone: optText(50),
  address: optText(300),
};

export const companies = buildCrud({
  table: 'companies',
  searchColumns: ['name', 'industry', 'website'],
  sortColumns: ['name', 'industry', 'createdAt', 'updatedAt'],
  createSchema: z.strictObject(fields),
  updateSchema: z.strictObject(fields).partial(),
  hasUpdatedAt: true,
});

export default companies.router;
