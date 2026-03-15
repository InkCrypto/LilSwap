import { ethers } from 'ethers';

/**
 * LogSessionService
 * Manages the signing of logs using the dynamic session established by the main API client.
 * This avoids multiple syncs and ensures consistency.
 */
class LogSessionService {
    constructor() {
        this.sessionId = null;
        this.signatureKey = null;
        this.expiry = null;
    }

    /**
     * Updates the session details. Called by api.js when a session is established.
     */
    setSession(sessionId, signatureKey, expiry) {
        this.sessionId = sessionId;
        this.signatureKey = signatureKey;
        this.expiry = expiry;
    }

    /**
     * Signs a log payload using HMAC-SHA256
     * @param {Object} body 
     * @returns {Object|null} { signature, timestamp, sessionId } or null if no session
     */
    async signPayload(body) {
        // If no session is active, we can't sign logs securely
        if (!this.sessionId || !this.signatureKey) {
            return null;
        }

        const timestamp = Date.now().toString();
        const bodyString = JSON.stringify(body);

        try {
            // Compute HMAC using ethers
            const signature = ethers.computeHmac(
                'sha256',
                ethers.hexlify(ethers.toUtf8Bytes(this.signatureKey)),
                ethers.toUtf8Bytes(timestamp + bodyString)
            );

            return {
                signature,
                timestamp,
                sessionId: this.sessionId
            };
        } catch (err) {
            console.error('[LogSession] Signing error:', err);
            return null;
        }
    }

    reset() {
        this.sessionId = null;
        this.signatureKey = null;
        this.expiry = null;
    }
}

export const logSessionService = new LogSessionService();
