'use strict';
// Pure logic tests (no database).
process.env.TZ = 'Asia/Kolkata';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'x'.repeat(40);
const test = require('node:test');
const assert = require('node:assert/strict');
const time = require('../src/utils/time');
const v = require('../src/utils/validation');
const { activeMeal, serviceStatus, validateWindows } = require('../src/services/meals');
const csv = require('../src/services/csv');
const { filters } = require('../src/services/reports');
const { ValidationError } = require('../src/utils/errors');

const meals = [
  { id: 1, meal_name: 'Breakfast', start_time: '06:00:00', end_time: '11:00:00', end_inclusive: 0, status: 1 },
  { id: 2, meal_name: 'Lunch', start_time: '12:00:00', end_time: '15:00:00', end_inclusive: 1, status: 1 },
  { id: 3, meal_name: 'Dinner', start_time: '19:00:00', end_time: '23:30:00', end_inclusive: 1, status: 1 },
];
const at = (hms) => time.parse(`2026-11-03 ${hms}`);

test('meal windows: start inclusive, end inclusive/exclusive per meal', () => {
  assert.equal(activeMeal(meals, at('06:00:00')).meal_name, 'Breakfast');
  assert.equal(activeMeal(meals, at('10:59:59')).meal_name, 'Breakfast');
  assert.equal(activeMeal(meals, at('11:00:00')), null); // breakfast excludes 11:00:00
  assert.equal(activeMeal(meals, at('15:00:00')).meal_name, 'Lunch'); // lunch includes 15:00:00
  assert.equal(activeMeal(meals, at('15:00:01')), null);
  assert.equal(activeMeal(meals, at('23:30:00')).meal_name, 'Dinner');
});

test('inactive meals never match', () => {
  const off = meals.map((m) => (m.id === 2 ? { ...m, status: 0 } : m));
  assert.equal(activeMeal(off, at('13:00:00')), null);
  assert.equal(serviceStatus(off, at('13:00:00')).message, 'Meal service is currently closed. Dinner starts at 7:00 PM.');
});

test('service status messages', () => {
  assert.equal(serviceStatus(meals, at('05:00:00')).message, 'Meal service is currently closed. Breakfast starts at 6:00 AM.');
  assert.equal(serviceStatus(meals, at('12:30:00')).message, 'Lunch service is open.');
  assert.equal(serviceStatus(meals, at('23:45:00')).message, 'Dinner service is closed for today.');
});

test('meal window validation', () => {
  assert.doesNotThrow(() => validateWindows(meals));
  assert.throws(() => validateWindows([{ ...meals[0], end_time: '12:30:00' }, meals[1]]), /must not overlap/);
  assert.throws(() => validateWindows([{ ...meals[1], end_time: '19:00:00' }, meals[2]]), /must not overlap/); // inclusive end == next start
  assert.doesNotThrow(() => validateWindows([{ ...meals[0], end_time: '12:00:00' }, meals[1]])); // exclusive end == next start
  assert.throws(() => validateWindows([{ ...meals[0], start_time: '10:00:00', end_time: '09:00:00' }]), /end after it starts/);
  assert.throws(() => validateWindows([{ ...meals[0], start_time: '25:00:00' }]), /valid meal times/);
  assert.doesNotThrow(() => validateWindows([{ ...meals[0], end_time: '12:30:00', status: 0 }, meals[1]])); // inactive may overlap
});

test('Indian mobile normalisation and validation', () => {
  assert.equal(v.normalizeMobile('+91 98765 43210'), '9876543210');
  assert.equal(v.normalizeMobile('09876543210'), '9876543210');
  assert.equal(v.normalizeMobile('98765-43210'), '9876543210');
  assert.ok(v.isIndianMobile('6000000000'));
  assert.ok(!v.isIndianMobile('5999999999'));
  assert.ok(!v.isIndianMobile('98765'));
});

test('dates, numbers, PHP-style casts', () => {
  assert.ok(v.validDate('2024-02-29'));
  assert.ok(!v.validDate('2026-02-29'));
  assert.ok(!v.validDate('2026-1-05'));
  assert.equal(v.intval('12abc'), 12);
  assert.equal(v.intval('abc'), 0);
  assert.equal(v.intval(['1', '7']), 7);
  assert.ok(v.isNumeric('70.25') && v.isNumeric('0') && !v.isNumeric('1e') && !v.isNumeric('abc') && !v.isNumeric(''));
  assert.throws(() => v.cleanText({ name: 'x'.repeat(101) }, 'name', 100), ValidationError);
  assert.throws(() => v.cleanText({}, 'employee_name', 100, true), /valid employee name/);
});

test('PHP date formats', () => {
  const d = time.parse('2026-11-03 13:05:09');
  assert.equal(time.format(d, 'D, d M Y'), 'Tue, 03 Nov 2026');
  assert.equal(time.format(d, 'g:i A'), '1:05 PM');
  assert.equal(time.format(d, 'h:i:s A'), '01:05:09 PM');
  assert.equal(time.format('2026-02-10', 'Y-m-t'), '2026-02-28');
  assert.equal(time.format('2026-11-01', 'F Y'), 'November 2026');
  assert.equal(time.format('00:30:00', 'g:i A'), '12:30 AM');
});

test('report filters: presets and limits', () => {
  const t = time.today();
  assert.equal(filters({}).from, time.ymd(t));
  const week = filters({ preset: 'week' });
  assert.equal(time.parse(week.from).getDay(), 1); // Monday
  const prev = filters({ preset: 'previous' });
  assert.ok(prev.from.endsWith('-01') && prev.to < filters({ preset: 'month' }).from);
  assert.deepEqual([filters({ preset: 'custom', from: '2026-01-01', to: '2026-01-31' }).from, filters({ preset: 'custom', from: '2026-01-01', to: '2026-01-31' }).to], ['2026-01-01', '2026-01-31']);
  assert.throws(() => filters({ preset: 'custom', from: '2026-02-01', to: '2026-01-01' }), /valid date range/);
  assert.throws(() => filters({ preset: 'custom', from: '2020-01-01', to: '2026-01-01' }), /three years/);
  assert.equal(filters({ employee: '7' }, 3).employee, 3); // employee portal is pinned to self
});

test('CSV output escapes formulas and quotes like fputcsv', () => {
  assert.equal(csv.line(['a b', 'x"y', 'plain', '']), '"a b","x""y",plain,\n');
  assert.equal(csv.neutralise('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csv.neutralise('-5'), "'-5");
  const out = csv.reportCsv('summary', meals, [{ employee_name: '=Bad', employee_code: 'E1', counts: { 1: 2 }, total: 2, amount: 60, missing_rates: 0 }]);
  assert.ok(out.startsWith('﻿Employee,"Employee ID",Breakfast,Lunch,Dinner,"Total meals","Amount INR","Meals missing rates"\n'));
  assert.ok(out.includes("'=Bad,E1,2,0,0,2,60.00,0\n"));
});
