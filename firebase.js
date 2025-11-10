const CONFIG_STORAGE_KEY = 'ce:firebase-config';
const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

let appInstance = null;
let firestoreInstance = null;
let authInstance = null;
let firebaseApi = null;
let firebaseModulePromise = null;
let firebaseOptions = null;

function resolveFirebaseOptions() {
    if (firebaseOptions) {
        return firebaseOptions;
    }
    if (typeof window === 'undefined') return null;
    try {
        const compatApp = window.firebase?.app?.();
        return compatApp?.options || null;
    } catch (error) {
        return null;
    }
}

async function loadFirebaseModules() {
    if (firebaseApi) return firebaseApi;
    if (firebaseModulePromise) return firebaseModulePromise;
    if (typeof window === 'undefined') {
        throw new Error('Firebase SDK is only available in browser environments.');
    }

    firebaseModulePromise = Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
    ])
        .then(([appModule, firestoreModule, authModule]) => {
            firebaseApi = {
                initializeApp: appModule.initializeApp,
                getApp: appModule.getApp,
                getApps: appModule.getApps,
                getFirestore: firestoreModule.getFirestore,
                collection: firestoreModule.collection,
                doc: firestoreModule.doc,
                setDoc: firestoreModule.setDoc,
                getDocs: firestoreModule.getDocs,
                deleteDoc: firestoreModule.deleteDoc,
                onSnapshot: firestoreModule.onSnapshot,
                getDoc: firestoreModule.getDoc,
                writeBatch: firestoreModule.writeBatch,
                getAuth: authModule.getAuth,
                GoogleAuthProvider: authModule.GoogleAuthProvider,
                signInWithPopup: authModule.signInWithPopup,
                signInWithRedirect: authModule.signInWithRedirect,
                getRedirectResult: authModule.getRedirectResult,
                signOut: authModule.signOut,
                onAuthStateChanged: authModule.onAuthStateChanged,
                setPersistence: authModule.setPersistence,
                browserLocalPersistence: authModule.browserLocalPersistence,
            };
            return firebaseApi;
        })
        .catch(error => {
            firebaseModulePromise = null;
            throw error;
        });

    return firebaseModulePromise;
}

function hasRequiredConfig(options) {
    if (!options) return false;
    const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
    return required.every(key => typeof options[key] === 'string' && options[key].trim().length > 0);
}

export function setFirebaseConfig(options) {
    const normalized = hasRequiredConfig(options) ? { ...options } : null;
    const previous = firebaseOptions ? JSON.stringify(firebaseOptions) : null;
    const next = normalized ? JSON.stringify(normalized) : null;
    firebaseOptions = normalized;
    if (previous !== next) {
        appInstance = null;
        firestoreInstance = null;
        authInstance = null;
    }
}

export function isFirebaseConfigured() {
    return hasRequiredConfig(resolveFirebaseOptions());
}

function requireFirebaseApi() {
    if (!firebaseApi) {
        throw new Error('Firebase modules have not been loaded. Call initializeFirebase() first.');
    }
    return firebaseApi;
}

function requireFirestore() {
    if (!firestoreInstance) {
        throw new Error('Firebase has not been initialised.');
    }
    return firestoreInstance;
}

export async function initializeFirebase() {
    if (appInstance) {
        return { initialized: true };
    }

    const options = resolveFirebaseOptions();
    if (!options) {
        throw new Error('Firebase configuration is missing. Add your web app credentials in the settings panel.');
    }

    manualConfig = normalizeConfig(options);

    const api = await loadFirebaseModules();

    const apps = api.getApps ? api.getApps() : [];
    if (apps.length) {
        appInstance = api.getApp();
    } else {
        appInstance = api.initializeApp(options);
    }

    firestoreInstance = api.getFirestore(appInstance);
    authInstance = api.getAuth(appInstance);

    if (api.setPersistence && api.browserLocalPersistence && authInstance) {
        try {
            await api.setPersistence(authInstance, api.browserLocalPersistence);
        } catch (error) {
            console.warn('Unable to enforce browser persistence for Firebase auth.', error);
        }
    }
    return { initialized: true };
}

function requireAuth() {
    if (!authInstance) {
        throw new Error('Firebase auth has not been initialised.');
    }
    return authInstance;
}

function projectCollection(profileId) {
    if (!profileId) throw new Error('Profile identifier is required for cloud sync.');
    const db = requireFirestore();
    const { collection } = requireFirebaseApi();
    return collection(db, 'profiles', profileId, 'projects');
}

function profileDoc(profileId) {
    if (!profileId) throw new Error('Profile identifier is required for cloud sync.');
    const db = requireFirestore();
    const { doc } = requireFirebaseApi();
    return doc(db, 'profiles', profileId);
}

export async function fetchProjects(profileId) {
    const { getDocs } = requireFirebaseApi();
    const snapshot = await getDocs(projectCollection(profileId));
    return snapshot.docs.map(docSnap => ({
        ...docSnap.data(),
    }));
}

export async function saveProject(profileId, project) {
    if (!project || !project.id) {
        throw new Error('Project payload must include an id.');
    }
    const { doc, setDoc } = requireFirebaseApi();
    const docRef = doc(projectCollection(profileId), String(project.id));
    const payload = {
        ...project,
        updatedAt: new Date().toISOString(),
    };
    await setDoc(docRef, payload, { merge: true });
}

export async function deleteProject(profileId, projectId) {
    const { doc, deleteDoc } = requireFirebaseApi();
    const docRef = doc(projectCollection(profileId), String(projectId));
    await deleteDoc(docRef);
}

export function subscribeToProjects(profileId, callback, errorCallback = console.error) {
    const { onSnapshot } = requireFirebaseApi();
    return onSnapshot(projectCollection(profileId), snapshot => {
        const projects = snapshot.docs.map(docSnap => ({
            ...docSnap.data(),
        }));
        callback(projects);
    }, errorCallback);
}

export function onAuthStateChange(callback) {
    const { onAuthStateChanged } = requireFirebaseApi();
    const auth = requireAuth();
    return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } = requireFirebaseApi();
    const auth = requireAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters?.({ prompt: 'select_account' });
    try {
        return await signInWithPopup(auth, provider);
    } catch (error) {
        if (error?.code === 'auth/operation-not-supported-in-this-environment') {
            await signInWithRedirect(auth, provider);
            return getRedirectResult(auth);
        }
        throw error;
    }
}

export function signOutFromGoogle() {
    const { signOut } = requireFirebaseApi();
    const auth = requireAuth();
    return signOut(auth);
}

export async function saveCompanyInfo(profileId, companyInfo) {
    const { setDoc } = requireFirebaseApi();
    const docRef = profileDoc(profileId);
    await setDoc(docRef, { companyInfo, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function loadCompanyInfo(profileId) {
    const { getDoc } = requireFirebaseApi();
    const docSnap = await getDoc(profileDoc(profileId));
    if (!docSnap.exists()) return null;
    return docSnap.data()?.companyInfo || null;
}

export async function replaceAllProjects(profileId, projects = []) {
    const db = requireFirestore();
    const { doc, setDoc, deleteDoc } = requireFirebaseApi();
    const batch = firebaseApi.writeBatch ? firebaseApi.writeBatch(db) : null;

    if (batch) {
        const collectionRef = projectCollection(profileId);
        const existing = await firebaseApi.getDocs(collectionRef);
        existing.forEach(docSnap => batch.delete(docSnap.ref));
        projects.forEach(project => {
            const docRef = doc(collectionRef, String(project.id));
            batch.set(docRef, project, { merge: true });
        });
        await batch.commit();
        return;
    }

    const collectionRef = projectCollection(profileId);
    const existing = await firebaseApi.getDocs(collectionRef);
    await Promise.all(existing.docs.map(docSnap => deleteDoc(docSnap.ref)));
    await Promise.all(projects.map(project => {
        const docRef = doc(collectionRef, String(project.id));
        return setDoc(docRef, project, { merge: true });
    }));
}
