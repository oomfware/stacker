export type { Codec, DefaultedCodec, Infer, OptionalCodec } from './codec.ts';
export { boolean, enumOf, integer, nonEmpty, optional, string, withDefault } from './codec.ts';
export type {
	BuildParamsOf,
	LayoutConfig,
	LayoutNode,
	LeafType,
	MatchedTarget,
	ParamsOf,
	QueryPatchOf,
	ReadonlyURLSearchParams,
	ResolvedLeaf,
	ResolvedNode,
	RouteChildren,
	RouteConfig,
	RouteLeaf,
	RouteMeta,
	RouteName,
	RouteNode,
	RouteRegistry,
	RouteTarget,
	WhenContext,
} from './routes.ts';
export { defineRoutes, layout, route } from './routes.ts';
export type { MatchedNode, RouteMatch } from './match.ts';
export { resolveMeta } from './match.ts';
export type { NavigationHistoryOptions } from './history/navigation.ts';
export { NavigationHistory } from './history/navigation.ts';
export type {
	History,
	HistoryAction,
	HistoryEntry,
	HistoryListener,
	HistoryLocation,
	HistoryNavigateOptions,
	HistoryScrollBehavior,
	HistoryUpdate,
} from './history/types.ts';
export type { InstanceNode, View } from './view-model.ts';
export type { LazyComponent } from './lazy.ts';
export { lazy } from './lazy.ts';
export type { NavigateOptions, RouterOptions } from './router.ts';
export { Router } from './router.ts';
export { RouterView } from './react/router-view.tsx';
export { Outlet } from './react/outlet.tsx';
export type { RouterHooks } from './react/hooks.ts';
export {
	createRouterHooks,
	useFocusEffect,
	useIsFocused,
	useLocation,
	useParams,
	useRoute,
	useRouter,
} from './react/hooks.ts';
export type { LinkProps } from './react/link.tsx';
export { Link } from './react/link.tsx';
