import { ethers } from 'ethers';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/v1';

class LogSessionService {
    constructor() {
        this.sessionId = null;
        this.signatureKey = null;
        this.expiry = null;
        this.isHandshaking = false;
        this.handshakePromise = null;
    }

    /**
     * Performs handshake with backend to get a signing key
     */
    async handshake() {
        if (this.isHandshaking) return this.handshakePromise;
        
        // Return existing session if still valid (with 1 min buffer)
        if (this.sessionId && this.expiry && Date.now() < this.expiry - 60000) {
            return { sessionId: this.sessionId, signatureKey: this.signatureKey };
        }

        this.isHandshaking = true;
        this.handshakePromise = (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/auth/handshake`);
                if (!response.ok) throw new Error('Handshake failed');
                
                const data = await response.json();
                this.sessionId = data.sessionId;
                this.signatureKey = data.signatureKey;
                this.expiry = data.expiry;
                
                return data;
            } catch (error) {
                console.error('[LogSession] Handshake error:', error);
                throw error;
            } finally {
                this.isHandshaking = false;
            }
        })();

        return this.handshakePromise;
    }

    /**
     * Signs a log payload using HMAC-SHA256
     * @param {Object} body 
     * @returns {Object} { signature, timestamp, sessionId }
     */
    async signPayload(body) {
        const { sessionId, signatureKey } = await this.handshake();
        const timestamp = Date.now().toString();
        const bodyString = JSON.stringify(body);

        // Compute HMAC using ethers
        // We use the hex string of the key and the UTF-8 bytes of the message
        const signature = ethers.computeHmac(
            'sha256',
            ethers.hexlify(ethers.toUtf8Bytes(signatureKey)),
            ethers.toUtf8Bytes(timestamp + bodyString)
        );

        return {
            signature,
            timestamp,
            sessionId
        };
    }

    /**
     * Forces session reset (e.g. if rejected by server)
     */
    reset() {
        this.sessionId = null;
        this.signatureKey = null;
        this.expiry = null;
    }
}

export const logSessionService = new LogSessionService();
