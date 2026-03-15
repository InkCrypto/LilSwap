/**
 * integrityWorker.js
 * Internal state synchronization worker.
 */

async function s(m) {
    const b = new TextEncoder().encode(m);
    const h = await crypto.subtle.digest('SHA-256', b);
    const a = Array.from(new Uint8Array(h));
    return a.map(b => b.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (e) => {
    const { c, d } = e.data;
    
    if (!c || d == null) {
        self.postMessage({ error: 'e1' });
        return;
    }

    const p = '0'.repeat(d);
    let n = 0;

    try {
        while (true) {
            const ns = n.toString();
            const h = await s(c + ns);
            
            if (h.startsWith(p)) {
                self.postMessage({ 
                    success: true, 
                    n: ns
                });
                break;
            }
            
            n++;

            if (n > 5000000) { 
               self.postMessage({ error: 'e2' });
               break;
            }
        }
    } catch (err) {
        self.postMessage({ error: err.message });
    }
};
