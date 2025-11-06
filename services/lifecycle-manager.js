export class LifecycleManager {
    constructor() {
        this.listeners = [];
    }

    addEventListener(target, event, handler, options) {
        if (!target || typeof target.addEventListener !== 'function') {
            return () => {};
        }
        target.addEventListener(event, handler, options);
        const entry = { target, event, handler, options };
        this.listeners.push(entry);
        return () => {
            this.removeEventListener(entry);
        };
    }

    removeEventListener(entry) {
        const index = this.listeners.indexOf(entry);
        if (index !== -1) {
            const { target, event, handler, options } = this.listeners[index];
            target.removeEventListener?.(event, handler, options);
            this.listeners.splice(index, 1);
        }
    }

    cleanup() {
        this.listeners.forEach(({ target, event, handler, options }) => {
            target.removeEventListener?.(event, handler, options);
        });
        this.listeners = [];
    }
}
