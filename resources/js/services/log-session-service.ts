import { ethers } from 'ethers';

/**
 * LogSessionService
 * Manages the signing of logs using the dynamic session established by the main API client.
 */
class LogSessionService {
    private secret: string;

    constructor() {
        // In the new architecture, VITE_API_SECRET should be empty in the client.
        // If we still need to sign logs from the client to the proxy, we'd need a key.
        // But the proxy can sign for the engine.
        this.secret = (import.meta as any).env.VITE_API_SECRET || '';
    }

    /**
     * Signs a log payload using HMAC-SHA256
     */
    async signPayload(body: any) {
        const secret = this.secret || (import.meta as any).env.VITE_API_SECRET;

        if (!secret) {
            return null;
        }

        const timestamp = Date.now().toString();
        const bodyString = JSON.stringify(body);

        try {
            // Compute HMAC using ethers v6
            const signature = ethers.computeHmac(
                'sha256',
                ethers.getBytes(ethers.id(secret)), // Adjusting for ethers v6 if needed, but legacy used hexlify(utf8)
                ethers.toUtf8Bytes(timestamp + bodyString)
            );

            return {
                signature,
                timestamp
            };
        } catch (err) {
            console.error('[LogSession] Signing error:', err);

            return null;
        }
    }

    reset() {
        // No-op
    }
}

export const logSessionService = new LogSessionService();
export default logSessionService;
