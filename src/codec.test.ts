import { describe, expect, it } from 'vitest';

import { boolean, enumOf, getDefault, integer, isOptional, optional, string, withDefault } from './codec.ts';

describe('string', () => {
	it('decodes and encodes any segment identically', () => {
		const c = string();
		expect(c.decode('alice')).toBe('alice');
		expect(c.decode('')).toBe('');
		expect(c.encode('bob')).toBe('bob');
	});
});

describe('integer', () => {
	const c = integer();

	it('decodes valid integers', () => {
		expect(c.decode('0')).toBe(0);
		expect(c.decode('42')).toBe(42);
		expect(c.decode('-7')).toBe(-7);
	});

	it('rejects non-integers and ambiguous forms', () => {
		expect(c.decode('1.5')).toBeUndefined();
		expect(c.decode('abc')).toBeUndefined();
		expect(c.decode('')).toBeUndefined();
		expect(c.decode('007')).toBeUndefined();
		expect(c.decode('1e3')).toBeUndefined();
		expect(c.decode('+1')).toBeUndefined();
		expect(c.decode('-0')).toBeUndefined();
		expect(c.decode('9007199254740993')).toBeUndefined();
	});

	it('encodes safe integers', () => {
		expect(c.encode(42)).toBe('42');
		expect(c.encode(-7)).toBe('-7');
	});

	it('throws rather than encode a value it could not decode back', () => {
		expect(() => c.encode(1.5)).toThrow();
		expect(() => c.encode(Number.NaN)).toThrow();
		expect(() => c.encode(Number.MAX_SAFE_INTEGER + 1)).toThrow();
		expect(() => c.encode(-0)).toThrow();
	});

	it('round-trips every safe integer it accepts', () => {
		for (const raw of ['0', '1', '-1', '42', '-7', '1000']) {
			expect(c.encode(c.decode(raw)!)).toBe(raw);
		}
	});
});

describe('boolean', () => {
	const c = boolean();

	it('decodes the literals true/false only', () => {
		expect(c.decode('true')).toBe(true);
		expect(c.decode('false')).toBe(false);
		expect(c.decode('1')).toBeUndefined();
		expect(c.decode('TRUE')).toBeUndefined();
	});

	it('encodes', () => {
		expect(c.encode(true)).toBe('true');
		expect(c.encode(false)).toBe('false');
	});
});

describe('enumOf', () => {
	const c = enumOf(['feed', 'profile', 'user']);

	it('accepts only listed values', () => {
		expect(c.decode('user')).toBe('user');
		expect(c.decode('feed')).toBe('feed');
		expect(c.decode('other')).toBeUndefined();
	});

	it('encodes', () => {
		expect(c.encode('profile')).toBe('profile');
	});
});

describe('optional', () => {
	it('delegates decode/encode and is marked optional', () => {
		const c = optional(integer());
		expect(c.decode('5')).toBe(5);
		expect(c.decode('x')).toBeUndefined();
		expect(c.encode(5)).toBe('5');
		expect(isOptional(c)).toBe(true);
	});

	it('plain codecs are not optional', () => {
		expect(isOptional(integer())).toBe(false);
	});
});

describe('withDefault', () => {
	it('delegates decode/encode and exposes its default', () => {
		const c = withDefault(enumOf(['all', 'mine']), 'all');
		expect(c.decode('mine')).toBe('mine');
		expect(c.decode('bogus')).toBeUndefined();
		expect(c.encode('mine')).toBe('mine');
		expect(getDefault(c)).toEqual(['all']);
	});

	it('distinguishes an undefined default from absence', () => {
		const withUndef = withDefault(string(), undefined as unknown as string);
		expect(getDefault(withUndef)).toEqual([undefined]);
		expect(getDefault(string())).toBeUndefined();
	});

	it('is not flagged as optional', () => {
		expect(isOptional(withDefault(string(), 'x'))).toBe(false);
	});
});
