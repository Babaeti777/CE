let appInstance = null;
let firestoreInstance = null;
let authInstance = null;
let firebaseNamespace = null;
let firebaseLoadingPromise = null;

const FIREBASE_SDK_SOURCES = [
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
];

function getFirebaseConfig() {
    if (typeof window === 'undefined') return null;
    return window.FIREBASE_CONFIG || null;
}

function isPlaceholderValue(value) {
    if (!value) return true;
    const normalized = String(value).trim().toUpperCase();
    return normalized.startsWith('YOUR_') || normalized === 'YOUR_APP_ID';
}

export function isFirebaseConfigured() {
    const config = getFirebaseConfig();
    if (!config) return false;
    const requiredKeys = ['apiKey', 'projectId', 'appId'];
    return requiredKeys.every(key => {
        const value = config[key];
        return Boolean(value) && !isPlaceholderValue(value);
    });
}

function ensureBrowserEnvironment() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('Firebase SDK is only available in browser environments.');
    }
}

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        ensureBrowserEnvironment();
        const existing = document.querySelector(`script[data-firebase-sdk="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve(window.firebase);
                return;
            }
            existing.addEventListener('load', () => resolve(window.firebase));
            existing.addEventListener('error', () => reject(new Error(`Failed to load Firebase SDK: ${src}`)));
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.dataset.firebaseSdk = src;
        script.addEventListener('load', () => {
            script.dataset.loaded = 'true';
            resolve(window.firebase);
        });
        script.addEventListener('error', () => reject(new Error(`Failed to load Firebase SDK: ${src}`)));
        document.head.appendChild(script);
    });
}

async function ensureFirebaseNamespace() {
    if (firebaseNamespace) return firebaseNamespace;
    if (firebaseLoadingPromise) return firebaseLoadingPromise;

    firebaseLoadingPromise = (async () => {
        ensureBrowserEnvironment();
        for (const src of FIREBASE_SDK_SOURCES) {
            await loadScriptOnce(src);
        }
        if (!window.firebase) {
            throw new Error('Firebase SDK failed to load.');
        }
        firebaseNamespace = window.firebase;
        return firebaseNamespace;
    })().catch(error => {
        firebaseLoadingPromise = null;
        throw error;
    });

    return firebaseLoadingPromise;
}

function requireFirestore() {
    if (!firestoreInstance) {
        throw new Error('Firebase Firestore has not been initialised.');
    }
    return firestoreInstance;
}

function requireAuth() {
    if (!authInstance) {
        throw new Error('Firebase Auth has not been initialised.');
    }
    return authInstance;
}

function requireFirebaseNamespace() {
    if (!firebaseNamespace) {
        throw new Error('Firebase SDK has not been loaded.');
    }
    return firebaseNamespace;
}

export async function initializeFirebase() {
    if (appInstance) {
        return { initialized: true };
    }

    const config = getFirebaseConfig();
    if (!config) {
        throw new Error('Firebase configuration is missing.');
    }

    const firebase = await ensureFirebaseNamespace();
    appInstance = firebase.apps?.length ? firebase.app() : firebase.initializeApp(config);
    firestoreInstance = firebase.firestore();
    authInstance = firebase.auth();
    authInstance?.useDeviceLanguage?.();
    return { initialized: true };
}

function projectCollection(profileId) {
    if (!profileId) throw new Error('Profile identifier is required for cloud sync.');
    return requireFirestore().collection('profiles').doc(profileId).collection('projects');
}

function profileDoc(profileId) {
    if (!profileId) throw new Error('Profile identifier is required for cloud sync.');
    return requireFirestore().collection('profiles').doc(profileId);
}

export async function fetchProjects(profileId) {
    const snapshot = await projectCollection(profileId).get();
    return snapshot.docs.map(docSnap => ({
        ...docSnap.data(),
    }));
}

export async function saveProject(profileId, project) {
    if (!project || !project.id) {
        throw new Error('Project payload must include an id.');
    }
    const docRef = projectCollection(profileId).doc(String(project.id));
    const payload = {
        ...project,
        updatedAt: new Date().toISOString(),
    };
    await docRef.set(payload, { merge: true });
}

export async function deleteProject(profileId, projectId) {
    await projectCollection(profileId).doc(String(projectId)).delete();
}

export function subscribeToProjects(profileId, callback, errorCallback = console.error) {
    return projectCollection(profileId).onSnapshot(snapshot => {
        const projects = snapshot.docs.map(docSnap => ({
            ...docSnap.data(),
        }));
        callback(projects);
    }, errorCallback);
}

export async function saveCompanyInfo(profileId, companyInfo) {
    const payload = {
        companyInfo: companyInfo || {},
        updatedAt: new Date().toISOString(),
    };
    await profileDoc(profileId).set(payload, { merge: true });
}

export async function loadCompanyInfo(profileId) {
    const snapshot = await profileDoc(profileId).get();
    const exists = typeof snapshot.exists === 'function' ? snapshot.exists() : snapshot.exists;
    if (!exists) return null;
    const data = snapshot.data();
    return data?.companyInfo || null;
}

export async function replaceAllProjects(profileId, projects = []) {
    const operations = projects.map(project => saveProject(profileId, project));
    await Promise.all(operations);
}

export function getCurrentUser() {
    return authInstance?.currentUser || null;
}

export function onAuthStateChanged(callback) {
    const auth = requireAuth();
    return auth.onAuthStateChanged(callback);
}

export async function signInWithGoogle() {
    const firebase = requireFirebaseNamespace();
    const auth = requireAuth();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters?.({ prompt: 'select_account' });
    const result = await auth.signInWithPopup(provider);
    return result?.user || null;
}

export function signOutFirebase() {
    return requireAuth().signOut();
}
