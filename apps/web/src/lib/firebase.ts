import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const configuredOptions: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Object.values(configuredOptions).every(Boolean)

const localOnlyOptions: FirebaseOptions = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-zamam.local',
  projectId: 'demo-zamam',
  storageBucket: 'demo-zamam.local',
  messagingSenderId: '000000000000',
  appId: 'demo-zamam-app',
}

const firebaseConfig = isFirebaseConfigured ? configuredOptions : localOnlyOptions
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

const secondaryApp = getApps().find(({ name }) => name === 'Secondary')
  ?? initializeApp(firebaseConfig, 'Secondary')

export const secondaryAuth = getAuth(secondaryApp)
export default app
