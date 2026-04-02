import { keccak256, toBytes, toHex } from 'viem';

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
            // Compute HMAC using native Web Crypto API + Viem utilities
            // 1. Create the key from the secret (matching ethers.id which is keccak256)
            const keyData = new Uint8Array(toBytes(keccak256(toBytes(secret))));
            const cryptoKey = await window.crypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
            );

            // 2. Sign the payload
            const messageData = new Uint8Array(toBytes(timestamp + bodyString));
            const signatureBuffer = await window.crypto.subtle.sign(
                'HMAC',
                cryptoKey,
                messageData
            );

            // 3. Convert to hex (toHex adds 0x prefix by default, matching ethers behavior)
            const signature = toHex(new Uint8Array(signatureBuffer));

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
