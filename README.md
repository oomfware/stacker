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

drive the router imperatively using either URLs or type-safe route names and parameters:

```ts
// string-based navigation
router.push('/profile/alice');
router.replace('/profile/alice');

// name-based navigation (type-checked)
router.navigate('Profile', { actor: 'alice' });
router.build('Profile', { actor: 'alice' }); // -> "/profile/alice"

// history manipulation
router.popTo('Messages');
router.setParams({ tab: 'media' });
router.back();
```

`setParams` replaces the current history entry, preserving scroll and focus. undeclared query keys
are ignored.

### hooks

generate type-safe hooks bound to your route configuration using `createRouterHooks`:

```tsx
import { createRouterHooks } from '@oomfware/stacker';

const { useNavigate, useParams } = createRouterHooks(routes);

const Profile = () => {
	const [{ actor }, setParams] = useParams('Profile');
	const navigate = useNavigate();

	return (
		<>
			<h1>@{actor}</h1>
			<button onClick={() => setParams({ tab: 'media' })}>media</button>
			<button onClick={() => navigate('Settings')}>settings</button>
		</>
	);
};
```

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
