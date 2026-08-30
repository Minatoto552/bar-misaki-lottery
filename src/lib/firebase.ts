import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFunctions, type Functions } from 'firebase/functions';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const configured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
const configuredSharedApiUrl = String(import.meta.env.VITE_SHARED_API_URL ?? '').trim().replace(/\/$/, '');
export const sharedApiBaseUrl = configuredSharedApiUrl || (window.location.hostname.endsWith('.chatgpt.site') ? window.location.origin : null);
let auth: Auth | null = null;
let functions: Functions | null = null;

if (configured) {
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  functions = getFunctions(app, 'asia-northeast1');
}

export const firebaseServices = { auth, functions };
export const isFirebaseMode = configured;
export const isSharedApiMode = Boolean(sharedApiBaseUrl);
export const isDemoMode = !configured && !sharedApiBaseUrl;
