import { describe, expect, it } from 'vitest';

import { createPath, parsePath, resolvePath } from './url.ts';

describe('parsePath', () => {
	it('splits pathname, search, and hash', () => {
		expect(parsePath('/profile/alice?tab=feeds#top')).toEqual({
			hash: '#top',
			pathname: '/profile/alice',
			search: '?tab=feeds',
		});
	});

	it('handles a bare path', () => {
		expect(parsePath('/')).toEqual({ hash: '', pathname: '/', search: '' });
	});

	it('handles a hash with no search', () => {
		expect(parsePath('/x#y')).toEqual({ hash: '#y', pathname: '/x', search: '' });
	});
});

describe('createPath', () => {
	it('joins parts back into a relative URL', () => {
		expect(createPath({ hash: '#top', pathname: '/profile/alice', search: '?tab=feeds' })).toBe(
			'/profile/alice?tab=feeds#top',
		);
	});

	it('round-trips with parsePath', () => {
		for (const url of ['/', '/x', '/x?a=1', '/x#h', '/x?a=1&b=2#h', '/profile/al%20ice']) {
			expect(createPath(parsePath(url))).toBe(url);
		}
	});
});

describe('resolvePath', () => {
	const base = { hash: '', pathname: '/profile/alice', search: '?tab=feeds' };

	it('keeps the base pathname for a search-only destination', () => {
		expect(resolvePath('?tab=likes', base)).toEqual({
			hash: '',
			pathname: '/profile/alice',
			search: '?tab=likes',
		});
	});

	it('keeps the base pathname and search for a hash-only destination', () => {
		expect(resolvePath('#top', base)).toEqual({
			hash: '#top',
			pathname: '/profile/alice',
			search: '?tab=feeds',
		});
	});

	it('replaces everything for an absolute destination', () => {
		expect(resolvePath('/messages/x', base)).toEqual({ hash: '', pathname: '/messages/x', search: '' });
	});

	it('resolves a bare relative reference against the base directory', () => {
		expect(resolvePath('bob', base).pathname).toBe('/profile/bob');
	});
});
