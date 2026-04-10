import { createInertiaApp } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import '../css/app.css';

import { ApiMetaProvider } from '@/contexts/api-meta-context';
import { ToastProvider } from '@/contexts/toast-context';
import { TransactionTrackerProvider } from '@/contexts/transaction-tracker-context';
import { UserActivityProvider } from '@/contexts/user-activity-context';
import { Web3Provider } from '@/contexts/web3-context';
import { initializeTheme } from '@/hooks/use-appearance';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

createInertiaApp({
    title: (title) => (title ? `${title} - ${appName}` : appName),
    resolve: (name) =>
        resolvePageComponent(
            `./pages/${name}.tsx`,
            import.meta.glob('./pages/**/*.tsx'),
        ),
    setup({ el, App, props }) {
        const root = createRoot(el);
        const initialApiMeta = (props as any)?.initialPage?.props?.apiMeta ?? {};

        root.render(
            <Web3Provider>
                <StrictMode>
                    <ApiMetaProvider
                        initialApiVersion={initialApiMeta.version ?? null}
                        initialApiStatus={initialApiMeta.isUp ?? true}
                    >
                        <UserActivityProvider>
                            <ToastProvider>
                                <TransactionTrackerProvider>
                                    <TooltipProvider delayDuration={120}>
                                        <App {...props} />
                                    </TooltipProvider>
                                </TransactionTrackerProvider>
                            </ToastProvider>
                        </UserActivityProvider>
                    </ApiMetaProvider>
                </StrictMode>
            </Web3Provider>,
        );
    },
    progress: {
        color: '#4B5563',
    },
});

// This will set light / dark mode on load...
initializeTheme();
