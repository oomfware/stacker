import { getDefault, isOptional } from './codec.ts';
import { splitSplat } from './routes.ts';
import type { BuildParamsOf, RouteName, RouteRegistry } from './routes.ts';
import { createPath, encodeRemainder, encodeSegment } from './url.ts';

const SEGMENT = /:([A-Za-z_]\w*)/g;

export type BuildArgs<R, K extends RouteName<R>> =
	Record<never, never> extends BuildParamsOf<R, K>
		? [params?: BuildParamsOf<R, K>]
		: [params: BuildParamsOf<R, K>];

export class Builder<R extends RouteRegistry<unknown> = RouteRegistry<unknown>> {
	readonly #registry: R;

	constructor(registry: R) {
		this.#registry = registry;
	}

	build<K extends RouteName<R>>(name: K, ...args: BuildArgs<R, K>): string {
		return this.buildPath(name, args[0] ?? {});
	}

	buildPath(name: string, params: Readonly<Record<string, unknown>> = {}): string {
		const leaf = this.#registry.leaves.get(name);
		if (leaf === undefined) {
			throw new Error(`stacker: unknown route '${name}'`);
		}

		const encodeParam = (paramName: string): string => {
			const codec = leaf.params[paramName];
			const value = params[paramName];
			if (codec === undefined || value === undefined) {
				throw new Error(`stacker: missing path param '${paramName}' for route '${name}'`);
			}
			return codec.encode(value);
		};

		// a dot segment cannot survive a round trip: WHATWG URL parsing resolves it away, so `..` would
		// navigate somewhere other than where it was built. percent-encoding is no escape either — the spec
		// matches `%2e` case-insensitively when detecting dot segments — so reject them outright.
		const rejectDotSegments = (segments: readonly string[], paramName: string): void => {
			for (const segment of segments) {
				if (segment === '.' || segment === '..') {
					throw new Error(
						`stacker: path param '${paramName}' for route '${name}' cannot contain a '${segment}' segment`,
					);
				}
			}
		};

		const { head, splat } = splitSplat(leaf.path);

		let pathname = head.replaceAll(SEGMENT, (_full, paramName: string) => {
			// an ordinary param is always one segment; its own separators percent-encode away.
			const encoded = encodeParam(paramName);
			rejectDotSegments([encoded], paramName);
			return encodeSegment(encoded);
		});

		if (splat !== undefined) {
			const remainder = encodeParam(splat);
			rejectDotSegments(remainder.split('/'), splat);

			// an empty remainder contributes nothing, keeping `/docs` the canonical form rather than `/docs/`.
			if (remainder !== '') {
				pathname += `/${encodeRemainder(remainder)}`;
			}
		}

		const search = new URLSearchParams();
		for (const [paramName, codec] of Object.entries(leaf.query)) {
			const value = params[paramName];
			if (value === undefined) {
				if (!isOptional(codec) && getDefault(codec) === undefined) {
					throw new Error(`stacker: missing required query param '${paramName}' for route '${name}'`);
				}
				continue;
			}
			search.set(paramName, codec.encode(value));
		}
		const query = search.toString();

		return createPath({ hash: '', pathname, search: query ? `?${query}` : '' });
	}
}
