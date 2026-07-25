# @oomfware/stacker

type-safe stack router for React.

```sh
npm install @oomfware/stacker
```

## usage

```tsx
import {
	defineRoutes,
	layout,
	Link,
	NavigationHistory,
	Outlet,
	route,
	Router,
	RouterView,
	string,
} from '@oomfware/stacker';

const AppShell = () => (
	<main>
		<nav>
			<Link to="/">home</Link>
			<Link to="/profile/alice">alice</Link>
		</nav>
		<Outlet />
	</main>
);

const Home = () => <h1>home</h1>;
const Profile = () => <h1>profile</h1>;

const routes = defineRoutes({
	app: layout({
		component: AppShell,
		children: {
			Home: route({ component: Home, path: '/' }),
			Profile: route({
				component: Profile,
				params: { actor: string() },
				path: '/profile/:actor',
			}),
		},
	}),
});

const router = new Router({ history: new NavigationHistory(), routes });

export const App = () => <RouterView router={router} />;
```

### defining routes

define routes using a nested tree of `layout` and `route` nodes. leaf names must be unique across
the tree:

```ts
import { defineRoutes, layout, route, string } from '@oomfware/stacker';

const routes = defineRoutes({
	app: layout({
		component: AppShell,
		children: {
			Home: route({ component: Home, path: '/' }),
			Profile: route({
				component: Profile,
				params: { actor: string() },
				query: { tab: optional(string()) },
				path: '/profile/:actor',
			}),
			Settings: route({ component: Settings, path: '/settings' }),
		},
	}),
});
```

routes are matched in declaration order, so declare specific paths ahead of broader ones that would
also match.

configure `type` to control page instance lifetimes:

```ts
// page (default): new instance and state per history entry
route({ component: Profile, path: '/profile/:actor', type: 'page' });

// singleton: one instance per distinct parameter set
route({ component: Home, path: '/', type: 'singleton' });
```

### parameters

declare path and query parameters using codecs. types are inferred automatically:

```ts
import { boolean, enumOf, integer, optional, route, string, withDefault } from '@oomfware/stacker';

route({
	component: SearchPage,
	path: '/search/:tag',
	params: { tag: string() },
	query: {
		page: withDefault(integer(), 1),
		sort: withDefault(enumOf(['new', 'top']), 'new'),
		unread: optional(boolean()),
	},
});
```

path parameters are always required. query parameters without a default or optional codec must be
present in the URL to match the route.

end a path with `*name` to capture the rest of the URL, separators included. a splat also matches
its bare parent path, where the remainder is empty:

```ts
route({ component: Docs, params: { rest: string() }, path: '/docs/*rest' });

// /docs/guide/intro -> { rest: 'guide/intro' }
// /docs             -> { rest: '' }
```

swap `string()` for `nonEmpty()` to reject the empty remainder, which leaves `/docs` to fall through
to the next matching route.

write custom codecs by defining `decode` and `encode` methods:

```ts
import type { Codec } from '@oomfware/stacker';

const date: Codec<Date> = {
	decode: (raw) => {
		const ms = Date.parse(raw);
		return Number.isNaN(ms) ? undefined : new Date(ms);
	},
	encode: (value) => value.toISOString(),
};
```

`defineRoutes` throws at load time if codecs do not match the `:params` declared in the path.

### navigating

use `<Link>` to route in-app:

```tsx
<Link to="/profile/alice">alice</Link>
<Link to="/settings" replace>settings</Link>
```

plain `<a>` elements also route in-app automatically under `NavigationHistory`.

drive the router imperatively with a _route target_: a route name and its parameters in one object,
type-checked against the registry.

```ts
router.navigate({ to: { name: 'Profile', actor: 'alice' } });
router.navigate({ to: { name: 'Profile', actor: 'alice' }, replace: true });

// a URL works too, for destinations the registry cannot spell
router.navigate({ to: '/profile/alice' });

// without navigating
router.href({ name: 'Profile', actor: 'alice' }); // -> "/profile/alice"
router.match('/profile/alice'); // -> { name: 'Profile', actor: 'alice' }

// returns to the nearest entry for the route, pushing if there is none
router.popTo({ name: 'Messages' });
router.back();
```

`navigate` passes `info`, `scroll` and `state` to the history entry. `scroll` defaults to `'auto'` —
top on a push, saved offset on a traversal; `'preserve'` holds the viewport and focus still.

`router.replace` patches the active route's query params in place, reusing the history entry so the
scroll offset and the focused element survive:

```ts
router.replace('Profile', { tab: 'media' }); // -> /profile/alice?tab=media
router.replace('Profile', { tab: undefined }); // -> /profile/alice
```

unmentioned params keep their values, undeclared keys are ignored, and naming a route other than the
one on screen throws.

a route target is a discriminated union, so narrowing on `name` narrows the params with it:

```ts
import type { RouteTarget } from '@oomfware/stacker';

const label = (target: RouteTarget<typeof routes>): string => {
	switch (target.name) {
		case 'Profile': {
			return `@${target.actor}`;
		}
		default: {
			return 'stacker';
		}
	}
};
```

because a target spells its params alongside `name`, a route cannot declare a param called `name`;
`defineRoutes` rejects it.

### hooks

generate type-safe hooks bound to your route configuration using `createRouterHooks`:

```tsx
import { createRouterHooks } from '@oomfware/stacker';

const { useParams, useRouter } = createRouterHooks(routes);

const Profile = () => {
	const [{ actor }, replace] = useParams('Profile');
	const router = useRouter();

	return (
		<>
			<h1>@{actor}</h1>
			<button onClick={() => replace({ tab: 'media' })}>media</button>
			<button onClick={() => router.navigate({ to: { name: 'Settings' } })}>settings</button>
		</>
	);
};
```

`useParams` hands back `replace` already bound to the route it names, so it takes the patch alone.

`useRouter` types the router against your registry, so `navigate`, `href` and the rest only accept
targets your routes describe. call them on the router itself; they read state private to it, so they
do not survive being pulled off the instance.

the same factory provides `useTarget` for reading the active route as a target, which re-renders on
navigation:

```tsx
const { useRouter, useTarget } = createRouterHooks(routes);

const Nav = () => {
	const router = useRouter();
	const target = useTarget();

	return (
		<a
			aria-current={target.name === 'Settings' ? 'page' : undefined}
			href={router.href({ name: 'Settings' })}
		>
			settings
		</a>
	);
};
```

reach for `useParams` over `useTarget` inside a screen: warm screens stay mounted behind the active
one, and only `useParams` reports the branch's own route rather than whichever one is active.

the package also exports registry-free hooks (`useLocation`, `useRoute`, `useRouter`) for components
that do not need type-safe route definitions.

### keeping screens alive

backward entries stay mounted behind the active screen. control memory usage and pinning behavior
during router setup:

```ts
const router = new Router({
	history: new NavigationHistory(),
	routes,
	max: 5, // keep up to 5 backward entries mounted; older ones are evicted
	pins: ["Home"], // keep specified singleton routes mounted indefinitely once visited
	notFound: NotFound,
	defaultFallback: <Spinner />,
});
```

use `router.dispose()` to detach the router from history when it is no longer needed.

### focus-aware effects

use focus hooks for work that should run when the screen becomes active, rather than when it mounts:

```tsx
import { useCallback } from 'react';
import { useFocusEffect, useIsFocused } from '@oomfware/stacker';

const Profile = () => {
	const [{ actor }] = useParams('Profile');

	useFocusEffect(
		useCallback(() => {
			document.title = `@${actor}`;
		}, [actor]),
	);

	const focused = useIsFocused();
	return <VideoPlayer paused={!focused} />;
};
```

`useFocusEffect` relies on reference identity; wrap the callback in `useCallback` to prevent it from
re-running on every render.

### server-owned URLs

exclude specific paths from in-app routing to let the browser handle them:

```ts
new NavigationHistory({
	ignore: (url) => url.pathname.startsWith('/oauth/'),
});
```

### metadata

declare custom route metadata using module augmentation:

```ts
import { layout, resolveMeta } from '@oomfware/stacker';

declare module '@oomfware/stacker' {
	interface RouteMeta {
		readonly requireAuth?: boolean;
	}
}

layout({
	component: AdminShell,
	meta: { requireAuth: true },
	children: {/* ... */},
});

// resolves metadata walking from leaf to root
resolveMeta(router.route, 'requireAuth');
```

### conditional matching

use `when` to conditionally reject matches based on custom logic, such as feature flags or query
parameters:

```ts
route({
	component: Beta,
	path: '/feed',
	when: ({ rawSearch }) => rawSearch.has('beta'),
});
```

### testing

use `MemoryHistory` to test routing behavior in environments without a DOM:

```ts
import { MemoryHistory } from '@oomfware/stacker/testing';

const router = new Router({
	history: new MemoryHistory({ initialEntries: ['/', '/profile/alice'] }),
	routes,
});
```
