import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { UserProfile } from './shared/types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function getUserProfile(uid: string): Promise<UserProfile> {
  if (uid.startsWith("guest_")) {
    const localData = localStorage.getItem("guestProfile_" + uid);
    if (localData) {
      return JSON.parse(localData);
    } else {
      const defaultProfile: UserProfile = {
        uid,
        coins: 0,
        inventory: [],
        equippedSkin: null
      };
      localStorage.setItem("guestProfile_" + uid, JSON.stringify(defaultProfile));
      return defaultProfile;
    }
  }

  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return docSnap.data() as UserProfile;
  } else {
    const defaultProfile: UserProfile = {
      uid,
      coins: 0,
      inventory: [],
      equippedSkin: null
    };
    await setDoc(docRef, defaultProfile);
    return defaultProfile;
  }
}

export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  if (uid.startsWith("guest_")) {
    const localData = localStorage.getItem("guestProfile_" + uid);
    if (localData) {
      const profile = JSON.parse(localData);
      const newProfile = { ...profile, ...updates };
      localStorage.setItem("guestProfile_" + uid, JSON.stringify(newProfile));
    }
    return;
  }

  const docRef = doc(db, "users", uid);
  await updateDoc(docRef, updates);
}
