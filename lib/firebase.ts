import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyAxIQfE2eYSEVvYkfL-KJ1TcJfxOdw3Nw4",
    authDomain: "calendrierconnecter.firebaseapp.com",
    databaseURL: "https://calendrierconnecter-default-rtdb.firebaseio.com",
    projectId: "calendrierconnecter",
    storageBucket: "calendrierconnecter.firebasestorage.app",
    messagingSenderId: "883066090334",
    appId: "1:883066090334:web:682a8bac7a68eef12015cf"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

export { app, db };
