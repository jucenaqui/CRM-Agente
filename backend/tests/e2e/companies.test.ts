import { crudSuite } from './crudSuite';

crudSuite({
  name: 'Companies',
  path: '/api/companies',
  textField: 'name',
  valid: (label) => ({
    name: label,
    industry: 'Software',
    website: 'https://example.com',
    phone: '+34 600 000 000',
    address: 'Calle Falsa 123',
  }),
  invalid: [{}, { name: '' }, { name: 123 }],
  patch: { industry: 'Retail' },
  invalidPatch: { name: '' },
});
