import { apiClient } from './api';

export async function bootstrapTelegramMiniApp(payload: {
    initData: string;
    platform?: string | null;
    version?: string | null;
    startParam?: string | null;
}) {
    return apiClient.post('/telegram/bootstrap', payload);
}
export async function checkTelegramWriteAccess() {
    return apiClient.post<{ success: boolean; allowsWriteToPm: boolean; hasSession: boolean }>(
        '/telegram/write-access-status',
    );
}
