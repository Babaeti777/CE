export class ErrorBoundary {
    static wrap(fn, context = 'Operation') {
        if (typeof fn !== 'function') {
            throw new TypeError('ErrorBoundary.wrap expects a function.');
        }
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                console.error(`${context} failed:`, error);
                if (typeof window !== 'undefined' && window?.showToast) {
                    window.showToast(`${context} failed. Please try again.`, 'error');
                }
                return null;
            }
        };
    }
}
