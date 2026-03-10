import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAUScJ2I6C1L-cn-qNKMAa0g-8qguYMj3w",
  authDomain: "beatpulse-c3630.firebaseapp.com",
  projectId: "beatpulse-c3630",
  storageBucket: "beatpulse-c3630.firebasestorage.app",
  messagingSenderId: "505897986841",
  appId: "1:505897986841:web:ef23065e34f8d06838b388",
  measurementId: "G-EST424JFHG"
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
export const storage = getStorage(app);
export const auth = getAuth(app);
