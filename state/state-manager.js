export class StateManager {
    constructor(initialState = {}) {
        this.listeners = new Map();
        this.root = this.#wrapState(initialState, []);
    }

    get state() {
        return this.root;
    }

    setState(path, value) {
        if (!path) {
            throw new Error('Path is required when setting state.');
        }
        const keys = Array.isArray(path) ? path : String(path).split('.');
        let current = this.root;
        for (let i = 0; i < keys.length - 1; i += 1) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
                current[key] = {};
            }
            current = current[key];
        }
        const finalKey = keys[keys.length - 1];
        current[finalKey] = this.#maybeWrap(value, keys);
        this.#notify(keys.join('.'));
        return current[finalKey];
    }

    getState(path = '') {
        if (!path) {
            return this.root;
        }
        const keys = Array.isArray(path) ? path : String(path).split('.');
        let current = this.root;
        for (const key of keys) {
            if (!current || typeof current !== 'object') {
                return undefined;
            }
            current = current[key];
        }
        return current;
    }

    subscribe(path, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('Subscription callback must be a function.');
        }
        const key = path || '__root__';
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        const set = this.listeners.get(key);
        set.add(callback);
        return () => {
            set.delete(callback);
            if (set.size === 0) {
                this.listeners.delete(key);
            }
        };
    }

    #wrapState(target, path) {
        if (!target || typeof target !== 'object') {
            return target;
        }
        if (Array.isArray(target)) {
            target.forEach((value, index) => {
                target[index] = this.#maybeWrap(value, [...path, String(index)]);
            });
        } else {
            Object.entries(target).forEach(([key, value]) => {
                target[key] = this.#maybeWrap(value, [...path, key]);
            });
        }
        return new Proxy(target, {
            set: (obj, prop, value) => {
                obj[prop] = this.#maybeWrap(value, [...path, String(prop)]);
                this.#notify([...path, String(prop)].join('.'));
                return true;
            },
            deleteProperty: (obj, prop) => {
                if (prop in obj) {
                    delete obj[prop];
                    this.#notify([...path, String(prop)].join('.'));
                }
                return true;
            }
        });
    }

    #maybeWrap(value, path) {
        if (!value || typeof value !== 'object') {
            return value;
        }
        return this.#wrapState(value, path);
    }

    #notify(path) {
        const direct = this.listeners.get(path);
        if (direct) {
            direct.forEach(cb => {
                try {
                    cb(this.getState(path));
                } catch (error) {
                    console.error('State listener error:', error);
                }
            });
        }
        const rootListeners = this.listeners.get('__root__');
        if (rootListeners) {
            rootListeners.forEach(cb => {
                try {
                    cb(this.root);
                } catch (error) {
                    console.error('State listener error:', error);
                }
            });
        }
    }
}

export const createStateManager = (initialState = {}) => new StateManager(initialState);
