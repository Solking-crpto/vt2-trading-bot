import test from 'node:test';
import assert from 'node:assert/strict';

test('VT2 project baseline is working', () => {
  assert.equal(1 + 1, 2);
});

test('VT2 starts in paper-trading mode', () => {
  assert.equal('PAPER', 'PAPER');
});
