import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVotes, validateVotesInput, sanitizeVotesMap } from '../src/agent/utils/results.js';

// Vote-field rules: whole digits 0-9 only; everything else rejected. These
// mirror the server-side zod schema messages exactly.

test('sanitizeVotes keeps digits and drops everything else', () => {
  assert.equal(sanitizeVotes('123'), '123');
  assert.equal(sanitizeVotes('0'), '0');
  assert.equal(sanitizeVotes(''), '');
  assert.equal(sanitizeVotes(undefined), '');
  assert.equal(sanitizeVotes(null), '');
  assert.equal(sanitizeVotes('1,200'), '1200');
  assert.equal(sanitizeVotes('abc12x3'), '123');
  assert.equal(sanitizeVotes('12.5'), '125');
  assert.equal(sanitizeVotes('-7'), '7');
  assert.equal(sanitizeVotes('1e5'), '15');
});

test('validateVotesInput accepts only whole non-negative integers', () => {
  assert.equal(validateVotesInput('0'), true);
  assert.equal(validateVotesInput('1234'), true);
  assert.equal(validateVotesInput(''), true);
  assert.ok(validateVotesInput('1.5') !== true);
  assert.ok(validateVotesInput('-3') !== true);
  assert.ok(validateVotesInput('12e3') !== true);
  assert.ok(validateVotesInput('abc') !== true);
  assert.ok(validateVotesInput('1,200') !== true);
  assert.match(String(validateVotesInput('abc')), /Numbers only/);
});

test('sanitizeVotesMap never emits malformed values into the payload', () => {
  const { clean, dropped } = sanitizeVotesMap({
    a: '12',
    b: '1.5',
    c: 'abc',
    d: '',
    e: '0',
  });
  assert.deepEqual(clean, { a: '12', e: '0' });
  assert.equal(dropped, 2); // two malformed values rejected; empty counts as 0
  assert.deepEqual(sanitizeVotesMap({}).clean, {});
});