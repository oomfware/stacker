import { SimpleEventEmitter } from '@mary-ext/simple-event-emitter';
import type { ComponentType, ReactNode } from 'react';

import { Builder } from './build.ts';
import type { LooseTarget } from './build.ts';
import type { CacheEntryRef } from './cache.ts';
import { computeCachedKeys } from './cache.ts';
import type { History, HistoryLocation, HistoryNavigateOptions } from './history/types.ts';
import { Matcher } from './match.ts';
import type { RouteMatch } from './match.ts';
import type {
	MatchedTarget,
	QueryPatchOf,
	ResolvedLeaf,
	ResolvedNode,
	RouteLeaf,
	RouteName,
	RouteRegistry,
	RouteTarget,
} from './routes.ts';
import { createPath, parsePath, resolvePath } from './url.ts';
import { computeView } from './view-model.ts';
import type { PoolEntry, View } from './view-model.ts';

/** options for a navigation. */
export interface NavigateOptions<R extends RouteRegistry<unknown>> extends HistoryNavigateOptions {
	/** replace the active history entry instead. */
	readonly replace?: boolean;
	/** where to go */
	readonly to: RouteTarget<R> | string;
}

/** options for the router constructor. */
export interface RouterOptions<R extends RouteRegistry<unknown>> {
	/** default fallback component shown during lazy chunk loading. */
	readonly defaultFallback?: ReactNode;
	/** backing history instance. */
	readonly history: History;
	/** maximum number of backward entries to keep warm. */
	readonly max?: number;
	/** component rendered when no route matches. */
	readonly notFound?: ComponentType;
	/** route names of pathless singleton routes to keep warm for the router's lifetime once first visited. */
	readonly pins?: readonly string[];
	/** compiled route registry. */
	readonly routes: R;
	/** window whose scroll position the router restores, defaulting to the global one where there is one. */
	readonly window?: Window;
}

/** a saved viewport offset. */
interface ScrollPosition {
	readonly x: number;
	readonly y: number;
}

interface Entry {
	readonly index: number;
	readonly key: string;
	readonly match: RouteMatch;
	/** offset to put the viewport back at when this entry is traversed to. */
	scrollPos: ScrollPosition;
	/** the match as a target. */
	readonly target: LooseTarget;
}

const DefaultNotFound: ComponentType = () => null;
const TOP: ScrollPosition = { x: 0, y: 0 };

/**
 * manages navigation state, history subscriptions, and active views.
 *
 * this class acts as the store for the React router view, maintaining and caching active matched nodes and
 * coordinates scrolling and focus.
 */
export class Router<R extends RouteRegistry<unknown>> {
	readonly #history: History;
	readonly #matcher: Matcher;
	readonly #builder: Builder<R>;
	readonly #routes: R;
	readonly #max: number;
	readonly #defaultFallback: ReactNode;
	readonly #notFound: { leaf: ResolvedLeaf; node: ResolvedNode };
	readonly #pins: ReadonlyMap<string, PoolEntry>;
	readonly #win: Window | null;
	readonly #updates = new SimpleEventEmitter<[]>();
	readonly #unlisten: () => void;

	#activePins = new Set<PoolEntry>();
	#entries = new Map<string, Entry>();
	#activeKey: string;
	#recency: string[] = [];
	#view: View;
	#commitWaiters: (() => void)[] = [];
	#viewAttached = false;
	#pendingScroll: ScrollPosition | null = null;

	constructor(options: RouterOptions<R>) {
		this.#history = options.history;
		this.#routes = options.routes;
		this.#matcher = new Matcher(options.routes);
		this.#builder = new Builder(options.routes);
		this.#max = options.max ?? 5;
		this.#defaultFallback = options.defaultFallback;
		this.#notFound = makeNotFound(options.notFound ?? DefaultNotFound);
		this.#pins = new Map((options.pins ?? []).map((name) => [name, this.#makePin(name)]));

		this.#win = options.window ?? (typeof window === 'undefined' ? null : window);

		const location = this.#history.location;
		this.#activeKey = location.key;
		this.#record(location, TOP);
		this.#view = this.#recompute();

		this.#unlisten = this.#history.listen(async ({ action, location: next, scroll }) => {
			const win = this.#win;
			const restoring = scroll === 'auto' && win !== null;
			if (restoring) {
				// the outgoing screen is still the one on screen here, before react re-renders.
				const outgoing = this.#entries.get(this.#activeKey);
				if (outgoing !== undefined) {
					outgoing.scrollPos = { x: win.scrollX, y: win.scrollY };
				}
			}

			this.#prune();

			// only a traversal returns to a screen the user has already scrolled; a push opens a new one, and a
			// replace reuses the outgoing slot, so the offset just saved under it is stale.
			const saved = action === 'traverse' ? this.#entries.get(next.key)?.scrollPos : undefined;
			const target = saved ?? TOP;

			this.#record(next, target);

			this.#activeKey = next.key;
			this.#view = this.#recompute();
			this.#pendingScroll = restoring ? target : null;

			// register before notifying because subscribers may render synchronously.
			const committed = this.#awaitCommit();
			this.#updates.emit();
			await committed;

			// an attached view already applied this from inside the commit; this is the headless fallback.
			this.restoreScroll();
		});
	}

	/** current view structure. */
	get view(): View {
		return this.#view;
	}

	/** active history location. */
	get location(): HistoryLocation {
		return this.#history.location;
	}

	/** active route match details, including the matched chain that `resolveMeta` takes. */
	get route(): RouteMatch {
		return this.#active().match;
	}

	/** the active route's name and parameters. */
	get target(): MatchedTarget<R> {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built from the registry's own match
		return this.#active().target as MatchedTarget<R>;
	}

	/** whether backward history is available. */
	get canGoBack(): boolean {
		return this.#history.canGoBack;
	}

	/** whether forward history is available. */
	get canGoForward(): boolean {
		return this.#history.canGoForward;
	}

	/** default suspense fallback component. */
	get defaultFallback(): ReactNode {
		return this.#defaultFallback;
	}

	/** the compiled registry this router was constructed with. */
	get routes(): R {
		return this.#routes;
	}

	/**
	 * subscribes to view updates.
	 *
	 * bound to the instance, so it keeps one identity for the router's lifetime and can be handed straight to
	 * `useSyncExternalStore` — which re-subscribes whenever the function it is given changes.
	 *
	 * @param listener change callback
	 * @returns unsubscribe function
	 */
	readonly subscribe = (listener: () => void): (() => void) => {
		return this.#updates.subscribe(listener);
	};

	/**
	 * builds the URL for a route.
	 *
	 * @param target route name and parameters
	 * @returns relative URL
	 */
	href(target: RouteTarget<R>): string {
		return this.#builder.build(target);
	}

	/**
	 * matches a URL against the route registry, without navigating to it.
	 *
	 * the URL is resolved against the active location, the same way {@link navigate} resolves it.
	 *
	 * @param to destination relative URL
	 * @returns the target it resolves to, or undefined when no route matches
	 */
	match(to: string): MatchedTarget<R> | undefined {
		const { hash, pathname, search } = resolvePath(to, this.#history.location);
		const match = this.#matcher.match(pathname, search, hash);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built from the registry's own match
		return match === undefined ? undefined : (toTarget(match) as MatchedTarget<R>);
	}

	/**
	 * navigates to a route.
	 *
	 * @param options where to go, and how to get there
	 */
	navigate(options: NavigateOptions<R>): void {
		const { replace = false, to, ...rest } = options;
		const url = typeof to === 'string' ? to : this.#builder.build(to);
		if (replace) {
			this.#history.replace(url, rest);
		} else {
			this.#history.push(url, rest);
		}
	}

	/**
	 * returns to the nearest existing history entry for a route, or pushes if none exists.
	 *
	 * @param to route target, or a relative URL resolved against the active location
	 */
	popTo(to: RouteTarget<R> | string): void {
		const url = typeof to === 'string' ? to : this.#builder.build(to);
		const { hash, pathname, search } = resolvePath(url, this.#history.location);
		const wantedMatch = this.#matcher.match(pathname, search, hash);
		if (wantedMatch !== undefined) {
			const wanted = this.#canonical(wantedMatch);
			const entries = this.#history.entries();
			for (let i = this.#history.location.index; i >= 0; i--) {
				const entry = entries[i];
				if (entry === undefined || !entry.sameDocument || entry.url === null) {
					break;
				}
				const parts = parsePath(entry.url);
				const match = this.#matcher.match(parts.pathname, parts.search, parts.hash);
				if (match !== undefined && match.name === wantedMatch.name && this.#canonical(match) === wanted) {
					this.#history.traverseTo(entry.key);
					return;
				}
			}
		}
		this.#history.push(url);
	}

	/**
	 * patches the active route's query params in place, without pushing a new entry.
	 *
	 * params the patch does not mention keep their values; setting one to `undefined` drops it from the URL.
	 * keys the route does not declare are ignored.
	 *
	 * @param name the active route's name, which types the patch
	 * @param patch query parameter changes
	 * @throws when `name` is not the active route
	 */
	replace<K extends RouteName<R>>(name: K, patch: QueryPatchOf<R, K>): void {
		const active = this.#active();
		if (active.match.name !== name) {
			throw new Error(`stacker: replace('${name}') called under route '${active.match.name}'`);
		}
		const leaf = this.#routes.leaves.get(name);
		if (leaf === undefined) {
			throw new Error(`stacker: unknown route '${name}'`);
		}
		const location = this.#history.location;
		const search = new URLSearchParams(location.search);
		for (const [param, value] of Object.entries(patch)) {
			const codec = leaf.query[param];
			if (codec === undefined) {
				continue;
			}
			if (value === undefined) {
				search.delete(param);
			} else {
				search.set(param, codec.encode(value));
			}
		}
		const query = search.toString();
		const to = createPath({
			hash: location.hash,
			pathname: location.pathname,
			search: query ? `?${query}` : '',
		});
		this.#history.replace(to, { scroll: 'preserve', state: location.state });
	}

	/** navigates back one entry. */
	back(): void {
		this.#history.back();
	}

	/** navigates forward one entry. */
	forward(): void {
		this.#history.forward();
	}

	/** navigates by a delta offset on the stack. */
	go(delta: number): void {
		this.#history.go(delta);
	}

	/**
	 * attaches a router view to coordinate transition commits.
	 *
	 * @returns detach function
	 */
	attachView(): () => void {
		this.#viewAttached = true;
		return () => {
			this.#viewAttached = false;
			this.notifyCommit();
		};
	}

	/** resolves pending navigation transitions after a view commits. */
	notifyCommit(): void {
		for (const resolve of this.#commitWaiters.splice(0)) {
			resolve();
		}
	}

	/**
	 * applies the viewport offset the active navigation is waiting on, if any.
	 *
	 * `RouterView` calls this from a layout effect ordered ahead of every branch's, so a branch measures its
	 * own offset rather than the outgoing screen's. a no-op with nothing pending.
	 */
	restoreScroll(): void {
		const pending = this.#pendingScroll;
		const win = this.#win;
		if (pending === null || win === null) {
			return;
		}
		this.#pendingScroll = null;
		// an app-wide `scroll-behavior: smooth` would otherwise animate this.
		win.scrollTo({ behavior: 'instant', left: pending.x, top: pending.y });
	}

	/** detaches history listeners and disposes resources. */
	dispose(): void {
		this.#unlisten();
		this.#history.dispose();
		// release transitions waiting on a view that has been disposed.
		this.notifyCommit();
	}

	#active(): Entry {
		const active = this.#entries.get(this.#activeKey);
		if (active === undefined) {
			throw new Error(`stacker: no warm entry for the active key '${this.#activeKey}'`);
		}
		return active;
	}

	#match(location: HistoryLocation): RouteMatch {
		return this.#matcher.match(location.pathname, location.search, location.hash) ?? this.#notFoundMatch();
	}

	// rebuilding normalizes values that codecs decode into fresh object identities.
	#canonical(match: RouteMatch): string {
		return this.#builder.buildPath(match.name, match.params);
	}

	#awaitCommit(): Promise<void> {
		if (!this.#viewAttached) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.#commitWaiters.push(resolve);
		});
	}

	#prune(): void {
		const live = new Set(this.#history.entries().map((entry) => entry.key));
		for (const key of this.#entries.keys()) {
			if (!live.has(key)) {
				this.#entries.delete(key);
			}
		}
	}

	#record(location: HistoryLocation, scrollPos: ScrollPosition): void {
		const match = this.#match(location);
		const entry: Entry = {
			index: location.index,
			key: location.key,
			match,
			scrollPos,
			target: toTarget(match),
		};
		this.#entries.set(location.key, entry);
		this.#recency = [entry.key, ...this.#recency.filter((key) => key !== entry.key)];
		const pin = this.#pins.get(entry.match.name);
		if (pin !== undefined) {
			this.#activePins.add(pin);
		}
	}

	#recompute(): View {
		const active = this.#active();
		const refs: CacheEntryRef[] = [...this.#entries.values()].map((entry) => ({
			index: entry.index,
			key: entry.key,
		}));
		const cachedKeys = computeCachedKeys(refs, active.index, this.#recency, { max: this.#max });

		const cached: PoolEntry[] = [];
		for (const entry of this.#entries.values()) {
			if (cachedKeys.has(entry.key)) {
				cached.push({ key: entry.key, match: entry.match });
			}
		}
		const view = computeView(cached, [...this.#activePins], active.key);

		for (const [key, entry] of this.#entries) {
			if (!cachedKeys.has(entry.key)) {
				this.#entries.delete(key);
			}
		}
		this.#recency = this.#recency.filter((key) => this.#entries.has(key));

		return view;
	}

	#makePin(name: string): PoolEntry {
		const leaf = this.#routes.leaves.get(name);
		if (leaf === undefined) {
			throw new Error(`stacker: pinned route '${name}' is not in the registry`);
		}
		// pins must resolve to one instance shared with active visits.
		if ((leaf.leaf.type ?? 'page') !== 'singleton') {
			throw new Error(`stacker: pinned route '${name}' must be a singleton`);
		}
		if (Object.keys(leaf.params).length > 0) {
			throw new Error(`stacker: pinned route '${name}' must have no path params`);
		}
		const { hash, pathname, search } = parsePath(leaf.path);
		const match = this.#matcher.match(pathname, search, hash);
		if (match === undefined) {
			throw new Error(`stacker: pinned route '${name}' (path '${leaf.path}') did not match`);
		}
		return { key: `pin:${name}`, match };
	}

	#notFoundMatch(): RouteMatch {
		return {
			chain: [{ node: this.#notFound.node, params: {} }],
			leaf: this.#notFound.leaf,
			name: this.#notFound.leaf.name,
			params: {},
		};
	}
}

// a route cannot declare a param named `name`, so the route name never collides with one.
const toTarget = (match: RouteMatch): LooseTarget => ({ ...match.params, name: match.name });

const makeNotFound = (component: ComponentType): { leaf: ResolvedLeaf; node: ResolvedNode } => {
	const leafNode: RouteLeaf = { component, kind: 'route', params: {}, path: '*', query: {}, type: 'page' };
	const node: ResolvedNode = {
		id: ' notFound',
		key: ' notFound',
		kind: 'route',
		node: leafNode,
		params: {},
		path: '*',
	};
	const leaf: ResolvedLeaf = {
		chain: [node],
		leaf: leafNode,
		name: ' notFound',
		params: {},
		path: '*',
		query: {},
	};
	return { leaf, node };
};
