const memoryStore = new Map();

function createScopedKey(prefix, key) {
    return prefix ? `${prefix}:${key}` : key;
}

export function createStorageService({ prefix = 'ce' } = {}) {
    const availableDrivers = [];
    const persistenceAllowed = typeof window !== 'undefined'
        ? window?.__CE_ALLOW_PERSISTENCE !== false
        : false;
    if (persistenceAllowed && typeof window?.localStorage !== 'undefined') {
        availableDrivers.push(window.localStorage);
    }

    const drivers = availableDrivers.length ? availableDrivers : [{
        getItem: (key) => memoryStore.has(key) ? memoryStore.get(key) : null,
        setItem: (key, value) => memoryStore.set(key, value),
        removeItem: (key) => memoryStore.delete(key),
        clear: () => memoryStore.clear()
    }];

    const driver = drivers[0];

    return {
        getItem(key) {
            if (!key) return null;
            const scoped = createScopedKey(prefix, key);
            try {
                return driver.getItem(scoped);
            } catch (error) {
                console.warn('Storage read failed, falling back to memory store.', error);
                return memoryStore.has(scoped) ? memoryStore.get(scoped) : null;
            }
        },
        setItem(key, value) {
            if (!key) return;
            const scoped = createScopedKey(prefix, key);
            try {
                driver.setItem(scoped, value);
                if (driver !== memoryStore) {
                    memoryStore.set(scoped, value);
                }
            } catch (error) {
                console.warn('Storage write failed, persisting to memory store only.', error);
                memoryStore.set(scoped, value);
            }
        },
        removeItem(key) {
            if (!key) return;
            const scoped = createScopedKey(prefix, key);
            try {
                driver.removeItem(scoped);
            } catch (error) {
                console.warn('Storage removal failed.', error);
            } finally {
                memoryStore.delete(scoped);
            }
        },
        clear() {
            try {
                driver.clear();
            } catch (error) {
                console.warn('Storage clear failed.', error);
            } finally {
                if (!prefix) {
                    memoryStore.clear();
                } else {
                    Array.from(memoryStore.keys()).forEach((key) => {
                        if (key.startsWith(`${prefix}:`)) {
                            memoryStore.delete(key);
                        }
                    });
                }
            }
        }
    };
}

export const storageService = createStorageService();
