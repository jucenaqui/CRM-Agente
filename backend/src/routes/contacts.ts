import { z } from 'zod';
import { buildCrud } from '../lib/crud.js';
import { optEmail, optId, optText, reqText } from '../lib/validation.js';

const fields = {
  firstName: reqText(100),
  lastName: reqText(100),
  email: optEmail(),
  phone: optText(50),
  position: optText(100),
  companyId: optId(),
};

export const contacts = buildCrud({
  table: 'contacts',
  searchColumns: ['firstName', 'lastName', 'email', 'position'],
  sortColumns: ['firstName', 'lastName', 'email', 'position', 'createdAt', 'updatedAt'],
  filters: [{ param: 'companyId', column: 'companyId', kind: 'id' }],
  refs: [{ field: 'companyId', table: 'companies' }],
  createSchema: z.strictObject(fields),
  updateSchema: z.strictObject(fields).partial(),
  hasUpdatedAt: true,
});

export default contacts.router;
