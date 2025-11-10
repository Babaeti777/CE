let appInstance = null;
let firestoreInstance = null;
let authInstance = null;
let firebaseApi = null;
let firebaseModulePromise = null;

function resolveFirebaseOptions() {
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

export function isFirebaseConfigured() {
    const options = resolveFirebaseOptions();
    return Boolean(options && options.projectId);
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
        throw new Error('Firebase configuration is missing. Confirm that Firebase Hosting has injected the SDK.');
    }

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
    const payload = {
        companyInfo: companyInfo || {},
        updatedAt: new Date().toISOString(),
    };
    await setDoc(docRef, payload, { merge: true });
}

export async function loadCompanyInfo(profileId) {
    const { getDoc } = requireFirebaseApi();
    const docRef = profileDoc(profileId);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return data?.companyInfo || null;
}

export async function replaceAllProjects(profileId, projects = []) {
    const ops = projects.map(project => saveProject(profileId, project));
    await Promise.all(ops);
}
