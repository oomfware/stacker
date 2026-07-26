import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy as reactLazy } from 'react';

import type { ResolvedNode } from './routes';

/** a preloadable lazily-loaded component. */
export type LazyComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
	/**
	 * start loading the component code.
	 *
	 * @returns promise that settles once loading finishes
	 */
	preload(): Promise<void>;
};

interface LazyInternals {
	_init(payload: unknown): unknown;
	_payload: unknown;
}

const noop = (): void => {};

/**
 * defines a lazily-loaded component that can be preloaded.
 *
 * @param init component module loader
 * @returns lazy component
 */
export const lazy = <T extends ComponentType<any>>(init: () => Promise<{ default: T }>): LazyComponent<T> => {
	const component = reactLazy(init);

	return Object.assign(component, {
		preload(): Promise<void> {
			try {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion
				const internals = component as unknown as LazyInternals;

				// get React to prime its internal state, it's fine if this doesn't work.
				// oxlint-disable-next-line no-underscore-dangle
				internals._init(internals._payload);
			} catch {}

			return Promise.try(init).then(noop, noop);
		},
	});
};

export const isPreloadable = (component: ComponentType): component is LazyComponent<any> => {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const obj = component as any;
	return typeof obj.preload === 'function';
};

/**
 * loads every preloadable component in a list.
 *
 * @param components components to load
 * @returns promise that settles once loading finishes
 */
export const preloadAll = (chain: readonly ResolvedNode[]): Promise<void> => {
	const pending: Promise<unknown>[] = [];
	for (const node of chain) {
		const component = node.node.component;
		if (!isPreloadable(component)) {
			continue;
		}

		try {
			pending.push(component.preload().then(noop, noop));
		} catch {}
	}

	return Promise.all(pending).then(noop);
};
