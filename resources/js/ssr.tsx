import { createInertiaApp } from '@inertiajs/react';
import createServer from '@inertiajs/react/server';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import ReactDOMServer from 'react-dom/server';
import { ApiMetaProvider } from '@/contexts/api-meta-context';
import { TooltipProvider } from '@/components/ui/tooltip';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

createServer((page) =>
    createInertiaApp({
        page,
        render: ReactDOMServer.renderToString,
        title: (title) => (title ? `${title} - ${appName}` : appName),
        resolve: (name) =>
            resolvePageComponent(
                `./pages/${name}.tsx`,
                import.meta.glob('./pages/**/*.tsx'),
            ) as any,
        setup: ({ App, props }) => {
            const initialApiMeta = (props as any)?.initialPage?.props?.apiMeta ?? {};

            return (
                <ApiMetaProvider
                    initialApiVersion={initialApiMeta.version ?? null}
                    initialApiStatus={initialApiMeta.isUp ?? true}
                >
                    <TooltipProvider delayDuration={120}>
                        <App {...props} />
                    </TooltipProvider>
                </ApiMetaProvider>
            );
        },
    }),
);
