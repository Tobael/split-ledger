export function postAuthRoute(pathname: string, search: string): string {
    if (pathname === '/join' || pathname.startsWith('/invite/')) return pathname + search;
    return '/dashboard';
}
