function getMetaContent(name: string): string | null {
    if (typeof window === 'undefined') return null;
    const el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    return el?.getAttribute('content') ?? null;
}

export function getCurrentHostname(): string {
    if (typeof window === 'undefined') return '';
    return window.location.hostname.toLowerCase();
}

function getMiniAppHosts(): string[] {
    const content = getMetaContent('miniapp-hosts');
    if (!content) return [];
    return content
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
}

export function getMiniAppName(): string | null {
    return getMetaContent('miniapp-name');
}

export function isMiniAppHost(): boolean {
    const hosts = getMiniAppHosts();
    if (hosts.length === 0) return false;
    return hosts.includes(getCurrentHostname());
}

export function shouldEnableTelegramIntegration(): boolean {
    return isMiniAppHost();
}
