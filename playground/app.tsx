import { useCallback, useState } from 'react';

import {
	NavigationHistory,
	createRouterHooks,
	defineRoutes,
	layout,
	Link,
	optional,
	Outlet,
	Router,
	route,
	RouterView,
	string,
	useFocusEffect,
	useIsFocused,
	useLocation,
} from '../src/index.ts';

// the playground imports from source, so its `RouteMeta` augmentation targets this module.
declare module '../src/routes.ts' {
	interface RouteMeta {
		readonly navGroup?: string;
	}
}

const useTitle = (title: string): void => {
	useFocusEffect(
		useCallback(() => {
			document.title = title;
		}, [title]),
	);
};

// mount ids make frozen and remounted branches distinguishable in the playground.
let mountSeq = 0;
const useMountId = (): number => useState(() => (mountSeq += 1))[0];

const Badge = ({ id, testId }: { readonly id: number; readonly testId: string }) => (
	<code
		data-active={useIsFocused() ? 'true' : 'false'}
		data-testid={testId}
		style={{ background: '#eee', borderRadius: 4, padding: '0 4px' }}
	>
		#{id}
	</code>
);

const Tall = () => <div style={{ height: 2000 }} />;

const Home = () => {
	const id = useMountId();
	useTitle('home · stacker');
	return (
		<section>
			<h2>
				home <Badge id={id} testId="home-mount" />
			</h2>
			<Tall />
		</section>
	);
};

const Profile = () => {
	const id = useMountId();
	const [{ actor, tab }, replace] = hooks.useParams('Profile');
	useTitle(`profile: ${actor} · stacker`);
	return (
		<section>
			<h2>
				profile: {actor} <Badge id={id} testId="profile-mount" />
			</h2>
			<div>
				tab: <code data-testid="profile-tab">{tab ?? '(none)'}</code>{' '}
				<button data-testid="set-tab" onClick={() => replace({ tab: 'media' })} type="button">
					replace tab=media
				</button>
			</div>
			<input data-testid="profile-input" placeholder="type, navigate away, come back" size={40} />
			<Tall />
		</section>
	);
};

const Settings = () => {
	const id = useMountId();
	useTitle('settings · stacker');
	return (
		<section>
			<h2>
				settings <Badge id={id} testId="settings-mount" />
			</h2>
		</section>
	);
};

const Convo = () => {
	const id = useMountId();
	const [{ convo }] = hooks.useParams('Convo');
	return (
		<section>
			<h3>
				conversation: {convo} <Badge id={id} testId="convo-mount" />
			</h3>
		</section>
	);
};

const Messages = () => {
	const id = useMountId();
	useTitle('messages · stacker');
	return (
		<section>
			<h3>
				messages inbox <Badge id={id} testId="messages-mount" />
			</h3>
		</section>
	);
};

const MessagesShell = () => {
	const id = useMountId();
	const [count, setCount] = useState(0);
	return (
		<div style={{ display: 'flex', gap: 16 }}>
			<aside style={{ borderRight: '1px solid #ccc', paddingRight: 16 }}>
				<strong>
					messages layout <Badge id={id} testId="mshell-mount" />
				</strong>
				<div>
					<button data-testid="mshell-count" onClick={() => setCount((c) => c + 1)} type="button">
						left-column count: {count}
					</button>
				</div>
				<nav style={{ display: 'flex', flexDirection: 'column' }}>
					<Link to="/messages/alpha">→ alpha</Link>
					<Link to="/messages/beta">→ beta</Link>
				</nav>
			</aside>
			<div style={{ flex: 1 }}>
				<Outlet />
			</div>
		</div>
	);
};

const NotFound = () => <h2 data-testid="notfound">not found</h2>;

const AppShell = () => {
	const id = useMountId();
	const location = useLocation();
	const router = hooks.useRouter();
	return (
		<div style={{ fontFamily: 'system-ui', padding: 16 }}>
			<header
				style={{
					borderBottom: '1px solid #ccc',
					paddingBottom: 8,
					position: 'sticky',
					top: 0,
					background: '#fff',
				}}
			>
				<strong>
					app shell <Badge id={id} testId="app-mount" />
				</strong>
				<nav style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
					<Link to="/">home</Link>
					<Link to="/profile/alice">alice</Link>
					<Link to="/profile/bob">bob</Link>
					{/* native anchors exercise navigation API interception. */}
					<a data-testid="bare-anchor" href="/messages">
						messages
					</a>
					{/* ignored URLs fall through to a document navigation. */}
					<a data-testid="server-anchor" href="/nav-probe.html">
						server route
					</a>
					<Link to="/settings">settings</Link>
					<button
						data-testid="nav-carol"
						onClick={() => router.navigate({ to: { actor: 'carol', name: 'Profile' } })}
						type="button"
					>
						carol (typed)
					</button>
					<button data-testid="back" onClick={() => router.back()} type="button">
						← back
					</button>
					<button data-testid="forward" onClick={() => router.go(1)} type="button">
						forward →
					</button>
				</nav>
				<div>
					at: <code data-testid="location">{location.pathname + location.search}</code>
				</div>
			</header>
			<main style={{ paddingTop: 12 }}>
				<Outlet />
			</main>
		</div>
	);
};

const routes = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Home, path: '/', type: 'singleton' }),
			Profile: route({
				component: Profile,
				params: { actor: string() },
				path: '/profile/:actor',
				query: { tab: optional(string()) },
			}),
			Settings: route({ component: Settings, path: '/settings' }),
			messages: layout({
				children: {
					Convo: route({ component: Convo, params: { convo: string() }, path: '/messages/:convo' }),
					Messages: route({ component: Messages, path: '/messages', type: 'singleton' }),
				},
				component: MessagesShell,
				meta: { navGroup: 'messages' },
			}),
		},
		component: AppShell,
	}),
});

const hooks = createRouterHooks(routes);

const router = new Router({
	history: new NavigationHistory({ ignore: (url) => url.pathname.endsWith('.html') }),
	max: 2,
	notFound: NotFound,
	pins: ['Home'],
	routes,
});

export const App = () => <RouterView router={router} />;
