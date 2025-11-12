export const SETTINGS_STORAGE_KEY = 'ce:settings';
export const SYNC_STATUS_RESET_DELAY = 2500;
export const SYNC_PROFILE_STORAGE_KEY = 'ce:cloud:profile-id';
export const FIREBASE_CONFIG_STORAGE_KEY = 'ce:firebase-config';

export const DATABASE_STORAGE_KEY = 'materialDatabase';
export const DATABASE_VERSION_KEY = 'materialDatabaseVersion';
export const DATABASE_SOURCE_URL = 'data/database.json';

export const FREQUENCY_INTERVALS = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
};

export const CLOUD_STATUS_MESSAGES = {
    disabled: 'Configure Firebase to enable cloud sync.',
    offline: 'Cloud sync offline',
    connecting: 'Connecting to Firebase…',
    connected: 'Cloud sync connected',
    error: 'Cloud sync unavailable',
    authRequired: 'Sign in with Google to enable cloud sync.',
};

export const EMPTY_COMPANY_INFO = Object.freeze({ name: '', address: '', phone: '', email: '' });
