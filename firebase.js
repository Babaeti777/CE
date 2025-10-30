let appInstance = null;
let firestoreInstance = null;
let authInstance = null;
let firebaseApi = null;
let firebaseModulePromise = null;
const PLACEHOLDER_VALUES = new Set([
    'YOUR_API_KEY',
    'YOUR_PROJECT_ID',
    'YOUR_PROJECT_ID.firebaseapp.com',
    'YOUR_PROJECT_ID.appspot.com',
    'YOUR_MESSAGING_SENDER_ID',
    'YOUR_APP_ID'
]);

function isPlaceholderValue(value) {
    if (!value || typeof value !== 'string') return false;
    return PLACEHOLDER_VALUES.has(value.trim());
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
                getFirestore: firestoreModule.getFirestore,
                collection: firestoreModule.collection,
                doc: firestoreModule.doc,
                setDoc: firestoreModule.setDoc,
                getDocs: firestoreModule.getDocs,
                deleteDoc: firestoreModule.deleteDoc,
                onSnapshot: firestoreModule.onSnapshot,
                getDoc: firestoreModule.getDoc,
                getAuth: authModule.getAuth,
                onAuthStateChanged: authModule.onAuthStateChanged,
                GoogleAuthProvider: authModule.GoogleAuthProvider,
                signInWithPopup: authModule.signInWithPopup,
                signOut: authModule.signOut,
            };
            return firebaseApi;
        })
        .catch(error => {
            firebaseModulePromise = null;
            throw error;
        });

    return firebaseModulePromise;
}

function getFirebaseConfig() {
    if (typeof window === 'undefined') return null;
    return window.FIREBASE_CONFIG || null;
}

export function isFirebaseConfigured() {
    const config = getFirebaseConfig();
    if (!config) return false;
    const requiredFields = ['apiKey', 'projectId', 'appId'];
    return requiredFields.every((key) => {
        const value = config[key];
        if (!value) return false;
        return !isPlaceholderValue(String(value));
    });
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

function requireAuth() {
    if (!authInstance) {
        throw new Error('Firebase Auth has not been initialised.');
    }
    return authInstance;
}

export async function initializeFirebase() {
    if (appInstance) {
        return { initialized: true };
    }

    const config = getFirebaseConfig();
    if (!config) {
        throw new Error('Firebase configuration is missing.');
    }

    const api = await loadFirebaseModules();
    appInstance = api.initializeApp(config);
    firestoreInstance = api.getFirestore(appInstance);
    authInstance = api.getAuth(appInstance);
    return { initialized: true };
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

export function onAuthStateChange(callback, errorCallback = console.error) {
    const auth = requireAuth();
    const { onAuthStateChanged } = requireFirebaseApi();
    return onAuthStateChanged(auth, callback, errorCallback);
}

export async function signInWithGoogle() {
    const auth = requireAuth();
    const { GoogleAuthProvider, signInWithPopup } = requireFirebaseApi();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, provider);
}

export async function signOutUser() {
    const auth = requireAuth();
    const { signOut } = requireFirebaseApi();
    await signOut(auth);
}

export function getCurrentUser() {
    return authInstance?.currentUser || null;
}
