
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  projectId: "recruitement-5778d",
  appId: "1:981478859499:web",
  apiKey: "AIzaSyBIjXu79TYwuJumzblA5o69hiluaX1UfSA",
  authDomain: "recruitement-5778d.firebaseapp.com",
  storageBucket: "recruitement-5778d.firebasestorage.app",
  messagingSenderId: "981478859499",
  measurementId: "G-WBRJ25N5EX"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
