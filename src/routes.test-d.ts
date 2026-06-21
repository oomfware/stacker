import { expectTypeOf, test } from 'vitest';

import type { Codec } from './codec.ts';
import { enumOf, optional, string, withDefault } from './codec.ts';
import type { BuildParamsOf, ParamsOf, RouteName } from './routes.ts';
import { defineRoutes, layout, route } from './routes.ts';

type Did = `did:${string}:${string}`;
type Handle = `${string}.${string}`;
type ActorId = Did | Handle;

const isActorId = (s: string): s is ActorId => s.includes(':') || s.includes('.');
const actorId = (): Codec<ActorId> => ({
	decode: (s) => (isActorId(s) ? s : undefined),
	encode: (s) => s,
});

const Dummy = (): null => null;

const routes = defineRoutes({
	app: layout({
		children: {
			Feed: route({
				component: Dummy,
				path: '/feed',
				query: { sort: withDefault(enumOf(['hot', 'new']), 'hot') },
			}),
			Home: route({ component: Dummy, path: '/', type: 'singleton' }),
			PostThread: route({
				component: Dummy,
				params: { didOrHandle: actorId(), rkey: string() },
				path: '/profile/:didOrHandle/post/:rkey',
			}),
			Search: route({
				component: Dummy,
				path: '/search',
				query: { q: string(), type: optional(enumOf(['feed', 'profile', 'user'])) },
			}),
		},
		component: Dummy,
	}),
});

type R = typeof routes;

test('route registry inference', () => {
	expectTypeOf<RouteName<R>>().toEqualTypeOf<'Feed' | 'Home' | 'PostThread' | 'Search'>();

	expectTypeOf<ParamsOf<R, 'PostThread'>>().toEqualTypeOf<{ didOrHandle: ActorId; rkey: string }>();
	expectTypeOf<BuildParamsOf<R, 'PostThread'>>().toEqualTypeOf<{ didOrHandle: ActorId; rkey: string }>();

	expectTypeOf<ParamsOf<R, 'Home'>>().toEqualTypeOf<Record<never, never>>();

	expectTypeOf<ParamsOf<R, 'Search'>>().toEqualTypeOf<{ q: string; type?: 'feed' | 'profile' | 'user' }>();
	expectTypeOf<BuildParamsOf<R, 'Search'>>().toEqualTypeOf<{
		q: string;
		type?: 'feed' | 'profile' | 'user';
	}>();

	expectTypeOf<ParamsOf<R, 'Feed'>>().toEqualTypeOf<{ sort: 'hot' | 'new' }>();
	expectTypeOf<BuildParamsOf<R, 'Feed'>>().toEqualTypeOf<{ sort?: 'hot' | 'new' }>();
});
