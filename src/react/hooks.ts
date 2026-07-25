import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { EffectCallback } from 'react';

import type { HistoryLocation } from '../history/types.ts';
import type { RouteMatch } from '../match.ts';
import type { Router } from '../router.ts';
import type { MatchedTarget, ParamsOf, QueryPatchOf, RouteName, RouteRegistry } from '../routes.ts';

import { CurrentNodeContext, RouterContext } from './context.ts';

// #region loose hooks (no registry type required)

/**
 * gets the active router instance.
 *
 * @returns router instance
 * @throws when used outside a router view context
 */
export const useRouter = (): Router<RouteRegistry<unknown>> => {
	const router = useContext(RouterContext);
	if (router === null) {
		throw new Error('stacker: useRouter must be used within a <RouterView>');
	}
	return router;
};

/**
 * gets the active history location.
 *
 * @returns history location
 */
export const useLocation = (): HistoryLocation => {
	const router = useRouter();
	return useSyncExternalStore(router.subscribe, () => router.location);
};

/**
 * gets the active route match information.
 *
 * @returns active route match
 */
export const useRoute = (): RouteMatch => {
	const router = useRouter();
	return useSyncExternalStore(router.subscribe, () => router.route);
};

/**
 * gets the untyped parameter map of the nearest enclosing route node.
 *
 * @returns decoded parameters
 * @throws when used outside a route tree context
 */
export const useParams = (): Readonly<Record<string, unknown>> => {
	const current = useContext(CurrentNodeContext);
	if (current === null) {
		throw new Error('stacker: useParams must be used within a route component');
	}
	return current.node.params;
};

/**
 * gets whether the enclosing branch is focused (on screen).
 *
 * @returns true if focused
 */
export const useIsFocused = (): boolean => {
	return useContext(CurrentNodeContext)?.focused ?? false;
};

/**
 * runs an effect callback only while the branch is focused.
 *
 * the effect re-runs whenever its identity changes, the way `useEffect` does, so wrap it in `useCallback` to
 * control when that happens. an effect built fresh on every render re-runs on every render.
 *
 * @param effect effect callback
 */
export const useFocusEffect = (effect: EffectCallback): void => {
	const focused = useIsFocused();
	useEffect(() => {
		if (!focused) {
			return undefined;
		}
		return effect();
	}, [effect, focused]);
};

// #endregion

// #region typed hooks

/** typed hooks bound to a specific route registry. */
export interface RouterHooks<R extends RouteRegistry<unknown>> {
	/** returns a function that builds URLs for routes. */
	useHref(): Router<R>['href'];
	/** gets the current location. */
	useLocation(): HistoryLocation;
	/** returns a function to navigate to routes. */
	useNavigate(): Router<R>['navigate'];
	/** gets a route's parameters and a setter that patches its query in place. */
	useParams<K extends RouteName<R>>(name: K): readonly [ParamsOf<R, K>, (patch: QueryPatchOf<R, K>) => void];
	/** gets the active route match. */
	useRoute(): RouteMatch;
	/** gets the typed router instance. */
	useRouter(): Router<R>;
	/** gets the active route's name and parameters. */
	useTarget(): MatchedTarget<R>;
}

/**
 * generates typed hooks bound to a specific route registry.
 *
 * @param routes the compiled registry the hooks are typed against
 * @returns typed hooks record
 * @throws when used with a router built from a different registry
 */
export const createRouterHooks = <R extends RouteRegistry<unknown>>(routes: R): RouterHooks<R> => {
	const useTypedRouter = (): Router<R> => {
		const router = useContext(RouterContext);
		if (router === null) {
			throw new Error('stacker: hooks must be used within a <RouterView>');
		}
		// registry identity makes restoring the erased generic a checked assertion.
		if (router.routes !== routes) {
			throw new Error('stacker: these hooks were created for a different route registry');
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by the registry identity check
		return router as Router<R>;
	};

	return {
		useHref() {
			const router = useTypedRouter();

			return useMemo<Router<R>['href']>(() => {
				return (target) => router.href(target);
			}, [router]);
		},

		useLocation: useLocation,

		useNavigate() {
			const router = useTypedRouter();

			return useMemo<Router<R>['navigate']>(() => {
				return (options) => router.navigate(options);
			}, [router]);
		},

		useParams<K extends RouteName<R>>(
			name: K,
		): readonly [ParamsOf<R, K>, (patch: QueryPatchOf<R, K>) => void] {
			const router = useTypedRouter();

			const current = useContext(CurrentNodeContext);

			const setParams = useMemo<(patch: QueryPatchOf<R, K>) => void>(() => {
				return (patch) => router.setParams(patch);
			}, [router]);

			if (current === null) {
				throw new Error('stacker: useParams must be used within a route component');
			}
			if (current.node.node.kind !== 'route' || current.node.node.key !== name) {
				throw new Error(
					`stacker: useParams('${name}') called under ${current.node.node.kind} '${current.node.node.key}'`,
				);
			}

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by the name check above
			return [current.node.params as ParamsOf<R, K>, setParams];
		},

		useRoute: useRoute,

		useRouter: useTypedRouter,

		useTarget() {
			const router = useTypedRouter();
			return useSyncExternalStore(router.subscribe, () => router.target);
		},
	};
};

// #endregion
