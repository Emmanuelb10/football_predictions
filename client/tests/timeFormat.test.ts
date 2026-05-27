import assert from 'assert';
import { formatKickoffTime } from '../src/utils/timeFormat.ts';

assert.equal(formatKickoffTime('2026-05-20T10:30:00.000Z'), '01:30 PM');
assert.equal(formatKickoffTime('2026-05-20T21:05:00.000Z'), '12:05 AM');

console.log('timeFormat tests passed');
