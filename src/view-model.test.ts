import { describe, expect, it } from 'vitest';

import { optional, string } from './codec.ts';
import { Matcher } from './match.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy, matched } from './test-support.ts';
import { computeView } from './view-model.ts';
import type { InstanceNode, PoolEntry, View } from './view-model.ts';

const registry = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Dummy, path: '/', query: { q: optional(string()) }, type: 'singleton' }),
			Profile: route({ component: Dummy, params: { actor: string() }, path: '/profile/:actor' }),
			messages: layout({
				children: {
					Convo: route({ component: Dummy, params: { convo: string() }, path: '/messages/:convo' }),
				},
				component: Dummy,
			}),
		},
		component: Dummy,
	}),
});

const matcher = new Matcher(registry);

const entry = (key: string, pathname: string, search = ''): PoolEntry => ({
	key,
	match: matched(matcher, pathname, search),
});

const childIds = (instance: InstanceNode): string[] => instance.children.map((child) => child.node.id);

const instanceCount = (nodes: readonly InstanceNode[]): number =>
	nodes.reduce((total, node) => total + 1 + instanceCount(node.children), 0);

const homeInstance = (view: View): InstanceNode => {
	const found = view.roots[0]!.children.find((child) => child.node.id === 'app.Home');
	if (found === undefined) {
		throw new Error('no Home instance');
	}
	return found;
};

describe('computeView', () => {
	it('throws when the active id is not in the cached set', () => {
		expect(() => computeView([entry('i0', '/')], [], 'missing')).toThrow(/not in the cached set/);
	});

	it('reports the active chain as instance keys, root to leaf', () => {
		const view = computeView([entry('i0', '/'), entry('i1', '/messages/a')], [], 'i1');
		expect(view.activePath).toHaveLength(3);
		expect(view.activePath[0]).toBe(view.roots[0]!.instanceKey);
	});

	it('places the chain of a cached entry', () => {
		const view = computeView([entry('i0', '/profile/alice')], [], 'i0');
		expect(instanceCount(view.roots)).toBe(2);
	});

	describe('instance sharing', () => {
		it('shares one layout instance across sibling navigations', () => {
			const view = computeView([entry('i0', '/messages/a'), entry('i1', '/messages/b')], [], 'i1');

			const app = view.roots[0]!;
			expect(view.roots).toHaveLength(1);
			expect(app.node.id).toBe('app');
			expect(childIds(app)).toEqual(['app.messages']);
			expect(childIds(app.children[0]!)).toEqual(['app.messages.Convo', 'app.messages.Convo']);
		});

		it('mounts a fresh page instance per entry, even for equal params', () => {
			const view = computeView([entry('i0', '/profile/alice'), entry('i1', '/profile/alice')], [], 'i1');
			expect(childIds(view.roots[0]!).filter((id) => id === 'app.Profile')).toHaveLength(2);
		});

		it('dedupes a singleton across entries with equal params', () => {
			const view = computeView([entry('i0', '/'), entry('i1', '/')], [], 'i1');
			expect(childIds(view.roots[0]!).filter((id) => id === 'app.Home')).toHaveLength(1);
		});

		it('dedupes a singleton across entries that differ only by query', () => {
			const view = computeView([entry('i0', '/', '?q=old'), entry('i1', '/', '?q=new')], [], 'i1');
			expect(childIds(view.roots[0]!).filter((id) => id === 'app.Home')).toHaveLength(1);
		});

		it('does not share a layout instance across different layout params', () => {
			const parameterized = defineRoutes({
				profile: layout({
					children: {
						Posts: route({ component: Dummy, params: { actor: string() }, path: '/profile/:actor/posts' }),
					},
					component: Dummy,
					params: { actor: string() },
				}),
			});
			const m = new Matcher(parameterized);
			const posts = (key: string, actor: string): PoolEntry => ({
				key,
				match: matched(m, `/profile/${actor}/posts`),
			});

			const view = computeView([posts('i0', 'alice'), posts('i1', 'bob')], [], 'i1');

			expect(view.roots).toHaveLength(2);
			expect(view.roots.every((root) => root.node.id === 'profile')).toBe(true);
			expect(view.roots[0]!.instanceKey).not.toBe(view.roots[1]!.instanceKey);
		});
	});

	describe('params on a shared singleton', () => {
		it('renders the active entry`s params when it was placed first', () => {
			const view = computeView([entry('i0', '/', '?q=active'), entry('i1', '/', '?q=stale')], [], 'i0');
			expect(homeInstance(view).params).toEqual({ q: 'active' });
		});

		it('renders the active entry`s params when a stale entry was placed first', () => {
			const view = computeView(
				[entry('i0', '/', '?q=old'), entry('i1', '/profile/x'), entry('i2', '/', '?q=new')],
				[],
				'i2',
			);
			expect(homeInstance(view).params).toEqual({ q: 'new' });
		});

		it('does not let a pin override the active entry`s params', () => {
			const view = computeView([entry('i0', '/', '?q=active')], [entry('pin', '/')], 'i0');
			expect(homeInstance(view).params).toEqual({ q: 'active' });
		});
	});

	describe('pins', () => {
		it('keeps a pinned singleton in the pool when no cached entry crosses it', () => {
			const view = computeView([entry('i5', '/profile/alice')], [entry('pin', '/')], 'i5');
			expect(childIds(view.roots[0]!)).toContain('app.Home');
			expect(childIds(view.roots[0]!)).toContain('app.Profile');
		});

		it('dedupes a pin that duplicates the active singleton', () => {
			const view = computeView([entry('i0', '/')], [entry('pin', '/')], 'i0');
			expect(childIds(view.roots[0]!).filter((id) => id === 'app.Home')).toHaveLength(1);
		});

		it('places a pin alongside the cached entry it does not overlap', () => {
			const view = computeView([entry('i0', '/profile/alice')], [entry('pin', '/')], 'i0');
			expect(instanceCount(view.roots)).toBe(3);
		});
	});
});
