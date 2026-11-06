import test from 'node:test';
import assert from 'node:assert';
import { reportTotal } from './report.js';
import { invoiceTotal } from './invoice.js';

test('reports', () => assert.strictEqual(reportTotal(1234), '$12.34'));
test('invoices', () => assert.strictEqual(invoiceTotal(1234), 12.34));
