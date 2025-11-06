export class LoadingManager {
    constructor(root = null) {
        this.root = root || (typeof document !== 'undefined' ? document.body : null);
        this.activeOperations = new Set();
    }

    async track(operationId, fn) {
        if (typeof fn !== 'function') {
            throw new TypeError('LoadingManager.track expects a function returning a promise.');
        }
        this.activeOperations.add(operationId);
        this.updateUI();
        try {
            return await fn();
        } finally {
            this.activeOperations.delete(operationId);
            this.updateUI();
        }
    }

    updateUI() {
        if (!this.root) return;
        const isLoading = this.activeOperations.size > 0;
        this.root.classList.toggle('is-loading', isLoading);
        const loader = this.#ensureLoaderElement();
        if (loader) {
            loader.hidden = !isLoading;
        }
    }

    #ensureLoaderElement() {
        if (typeof document === 'undefined') return null;
        let loader = document.getElementById('globalLoadingIndicator');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'globalLoadingIndicator';
            loader.setAttribute('role', 'status');
            loader.setAttribute('aria-live', 'polite');
            loader.className = 'global-loading-indicator';
            loader.textContent = 'Working…';
            loader.hidden = true;
            this.root?.appendChild(loader);
        }
        return loader;
    }
}
