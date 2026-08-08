// Firebase init — shared Firestore instance used by every module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB3nNmDjR-DzDNAowP86oF2IKhtuUvpc7U",
  authDomain: "toeic-flashcard-4c6da.firebaseapp.com",
  projectId: "toeic-flashcard-4c6da",
  storageBucket: "toeic-flashcard-4c6da.firebasestorage.app",
  messagingSenderId: "986833803151",
  appId: "1:986833803151:web:b20dcaeb32ac32ebdc5dfa"
};
export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);

// ── Auth ─────────────────────────────────────────────────────────

