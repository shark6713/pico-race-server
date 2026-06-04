import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, arrayUnion } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { UserProfile } from './shared/types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence]
});

export const googleProvider = new GoogleAuthProvider();

function generateFriendCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function getUserProfile(uid: string): Promise<UserProfile> {
  const localFallback = () => {
    const localData = localStorage.getItem("profile_" + uid);
    if (localData) {
      const profile = JSON.parse(localData) as UserProfile;
      let needsUpdate = false;
      if (!profile.friendCode) {
        profile.friendCode = generateFriendCode();
        if (!profile.friends) profile.friends = [];
        needsUpdate = true;
      }
      if (profile.energy === undefined) {
        profile.energy = 100;
        profile.lastEnergyUpdateTime = Date.now();
        needsUpdate = true;
      }
      if (needsUpdate) {
        localStorage.setItem("profile_" + uid, JSON.stringify(profile));
      }
      return profile;
    } else {
      const defaultProfile: UserProfile = {
        uid,
        coins: 0,
        inventory: [],
        equippedSkin: null,
        friendCode: generateFriendCode(),
        friends: [],
        energy: 100,
        lastEnergyUpdateTime: Date.now()
      };
      localStorage.setItem("profile_" + uid, JSON.stringify(defaultProfile));
      return defaultProfile;
    }
  };

  try {
    const docRef = doc(db, "users", uid);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const profile = docSnap.data() as UserProfile;
      let needsUpdate = false;
      if (!profile.friendCode) {
        profile.friendCode = generateFriendCode();
        if (!profile.friends) profile.friends = [];
        needsUpdate = true;
      }
      if (profile.energy === undefined) {
        profile.energy = 100;
        profile.lastEnergyUpdateTime = Date.now();
        needsUpdate = true;
      }
      if (needsUpdate) {
        await updateDoc(docRef, { 
          friendCode: profile.friendCode, 
          friends: profile.friends,
          energy: profile.energy,
          lastEnergyUpdateTime: profile.lastEnergyUpdateTime
        });
      }
      return profile;
    } else {
      const defaultProfile: UserProfile = {
        uid,
        coins: 0,
        inventory: [],
        equippedSkin: null,
        friendCode: generateFriendCode(),
        friends: [],
        energy: 100,
        lastEnergyUpdateTime: Date.now()
      };
      await setDoc(docRef, defaultProfile);
      return defaultProfile;
    }
  } catch (error) {
    console.error("Firestore error in getUserProfile, using fallback:", error);
    return localFallback();
  }
}

export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  try {
    const docRef = doc(db, "users", uid);
    await updateDoc(docRef, updates);
  } catch (error) {
    console.error("Firestore error in updateUserProfile, using fallback:", error);
  }
  
  // Always update local storage too, so if we fall back later, it's fresh.
  const localData = localStorage.getItem("profile_" + uid);
  if (localData) {
    const profile = JSON.parse(localData);
    const newProfile = { ...profile, ...updates };
    localStorage.setItem("profile_" + uid, JSON.stringify(newProfile));
  }
}

export async function addFriendByCode(myUid: string, code: string): Promise<{ success: boolean; message: string }> {
  try {
    // Cannot add self
    const myProfile = await getUserProfile(myUid);
    if (myProfile.friendCode === code) {
      return { success: false, message: "Kendi kodunuzu ekleyemezsiniz." }; // You cannot add your own code
    }

    // Find user with friendCode
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("friendCode", "==", code));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return { success: false, message: "Kullanıcı bulunamadı." }; // User not found
    }

    const friendDoc = querySnapshot.docs[0];
    const friendUid = friendDoc.id;

    if (myProfile.friends?.includes(friendUid)) {
      return { success: false, message: "Bu kullanıcı zaten arkadaş listenizde." }; // Already in friends list
    }

    // Since guest users don't have docs in firestore by default unless we save them,
    // this currently works for actual logged in users.
    // Let's assume friend is a real user.
    
    try {
       const myDocRef = doc(db, "users", myUid);
       await updateDoc(myDocRef, {
         friends: arrayUnion(friendUid)
       });
    } catch (e) {}

    // local storage update for safety
    myProfile.friends = [...(myProfile.friends || []), friendUid];
    localStorage.setItem("profile_" + myUid, JSON.stringify(myProfile));

    const friendDocRef = doc(db, "users", friendUid);
    await updateDoc(friendDocRef, {
      friends: arrayUnion(myUid)
    });

    return { success: true, message: "Arkadaş eklendi!" };
  } catch (error) {
    console.error("Error adding friend:", error);
    return { success: false, message: "Bir hata oluştu." };
  }
}
