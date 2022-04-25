import { assert } from 'chai';
import dayjs from 'dayjs';
import _ from 'lodash';
import { describe, it } from 'mocha';
import { DueDate } from '../../dueDate';
import { DueState } from '../../types';
import { headerDelimiter } from './testUtils';

function addDays(date: Date, n: number) {
	return dayjs(date).add(n, 'day').toDate();
}

const $1jan2018monday = new Date(2018, 0, 1);// just an ok date, first day of the year, month, week
const $2jan2018tuesday = new Date(2018, 0, 2);
const $3jan2018wednesday = new Date(2018, 0, 3);
const $4jan2018thursday = new Date(2018, 0, 4);
const $5jan2018friday = new Date(2018, 0, 5);
const $6jan2018saturday = new Date(2018, 0, 6);
const $7jan2018sunday = new Date(2018, 0, 7);

const $1jan2018mondayDueDate = new DueDate('2018-01-01', {
	targetDate: $1jan2018monday,
});

describe(`${headerDelimiter('due date')}Not recurring`, () => {
	it('Simple date format `2018-01-01` is due at that date.', () => {
		assert.equal($1jan2018mondayDueDate.isDue, DueState.due);
	});
	it('`2018-01-01` is not recurring', () => {
		assert.isFalse($1jan2018mondayDueDate.isRecurring);
	});
});

describe('♻ Recurring', () => {
	it('`ed` (every day alias). Is due on any day', () => {
		const ed = new DueDate('ed', {
			targetDate: addDays($1jan2018monday, _.random(-100, 100)),
		});
		assert.equal(ed.isDue, DueState.due);
	});
	it('`monday` is recurring', () => {
		assert.isTrue(new DueDate('monday').isRecurring);
	});
	it('Week days like `Monday` are case insensitive', () => {
		const mondayDueDate = new DueDate('Monday');
		assert.notEqual(mondayDueDate.isDue, DueState.invalid);
		assert.isTrue(mondayDueDate.isRecurring);
	});
	it('monday', () => {
		assert.equal(new DueDate('monday', { targetDate: $1jan2018monday }).isDue, DueState.due, 'monday');
		assert.equal(new DueDate('mon', { targetDate: $1jan2018monday }).isDue, DueState.due, 'mon');
	});
	it('monday is not due on any other day', () => {
		assert.equal(new DueDate('monday', { targetDate: $2jan2018tuesday }).isDue, DueState.notDue, 'tuesday');
		assert.equal(new DueDate('monday', { targetDate: $3jan2018wednesday }).isDue, DueState.notDue, 'wednesday');
		assert.equal(new DueDate('monday', { targetDate: $4jan2018thursday }).isDue, DueState.notDue, 'thursday');
		assert.equal(new DueDate('monday', { targetDate: $5jan2018friday }).isDue, DueState.notDue, 'friday');
		assert.equal(new DueDate('monday', { targetDate: $6jan2018saturday }).isDue, DueState.notDue, 'saturday');
		assert.equal(new DueDate('monday', { targetDate: $7jan2018sunday }).isDue, DueState.notDue, 'sunday');
	});
	it('tuesday', () => {
		assert.equal(new DueDate('tuesday', { targetDate: $2jan2018tuesday }).isDue, DueState.due, 'tuesday');
		assert.equal(new DueDate('tue', { targetDate: $2jan2018tuesday }).isDue, DueState.due, 'tue');
	});
	it('wednesday', () => {
		assert.equal(new DueDate('wednesday', { targetDate: $3jan2018wednesday }).isDue, DueState.due, 'wednesday');
		assert.equal(new DueDate('wed', { targetDate: $3jan2018wednesday }).isDue, DueState.due, 'wed');
	});
	it('thursday', () => {
		assert.equal(new DueDate('thursday', { targetDate: $4jan2018thursday }).isDue, DueState.due, 'thursday');
		assert.equal(new DueDate('thu', { targetDate: $4jan2018thursday }).isDue, DueState.due, 'thu');
	});
	it('friday', () => {
		assert.equal(new DueDate('friday', { targetDate: $5jan2018friday }).isDue, DueState.due, 'friday');
		assert.equal(new DueDate('fri', { targetDate: $5jan2018friday }).isDue, DueState.due, 'fri');
	});
	it('saturday', () => {
		assert.equal(new DueDate('saturday', { targetDate: $6jan2018saturday }).isDue, DueState.due, 'saturday');
		assert.equal(new DueDate('sat', { targetDate: $6jan2018saturday }).isDue, DueState.due, 'sat');
	});
	it('sunday', () => {
		assert.equal(new DueDate('sunday', { targetDate: $7jan2018sunday }).isDue, DueState.due, 'sunday');
		assert.equal(new DueDate('sun', { targetDate: $7jan2018sunday }).isDue, DueState.due, 'sun');
	});
});

describe('♻ Recurring with starting date', () => {
	const dueString = '2018-01-01|e2d';

	it(`${dueString} is due on the same day`, () => {
		assert.equal(new DueDate(dueString, { targetDate: new Date(2018, 0, 1) }).isDue, DueState.due);
	});
	it(`${dueString} is not due on the next day`, () => {
		assert.equal(new DueDate(dueString, { targetDate: new Date(2018, 0, 2) }).isDue, DueState.notDue);
	});
	it(`${dueString} is due in 2 days`, () => {
		assert.equal(new DueDate(dueString, { targetDate: new Date(2018, 0, 3) }).isDue, DueState.due);
	});
});

describe('Comma delimited `,`', () => {
	it('`mon,sun`', () => {
		assert.equal(new DueDate('mon,sun', { targetDate: $1jan2018monday }).isDue, DueState.due);
		assert.equal(new DueDate('mon,sun', { targetDate: $7jan2018sunday }).isDue, DueState.due);
		assert.equal(new DueDate('mon,sun', { targetDate: $2jan2018tuesday }).isDue, DueState.notDue);
		assert.equal(new DueDate('mon,sun', { targetDate: $3jan2018wednesday }).isDue, DueState.notDue);
		assert.equal(new DueDate('mon,sun', { targetDate: $4jan2018thursday }).isDue, DueState.notDue);
		assert.equal(new DueDate('mon,sun', { targetDate: $5jan2018friday }).isDue, DueState.notDue);
		assert.equal(new DueDate('mon,sun', { targetDate: $6jan2018saturday }).isDue, DueState.notDue);
	});
});

describe('🚫 Invalid due date', () => {
	it('Due date should have `invalid` state', () => {
		assert.equal(new DueDate('2020').isDue, DueState.invalid, '2020');
		assert.equal(new DueDate('2020-05-2').isDue, DueState.invalid, '2020-05-2');
		assert.equal(new DueDate('2020-07-31|e14').isDue, DueState.invalid, '2020-07-31|e14');
		assert.equal(new DueDate('2020-07-35').isDue, DueState.invalid, '2020-07-35');
	});
});

