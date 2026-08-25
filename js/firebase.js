// firebase.js
const firebaseConfig = {
    apiKey: "AIzaSyD7ga31HTOxjjL6zmbQtF7uMyryJtNs8Q",
    authDomain: "alvaras-befe7.firebaseapp.com",
    projectId: "alvaras-befe7",
    storageBucket: "alvaras-befe7.firebasestorage.app",
    messagingSenderId: "483823935404",
    appId: "1:483823935404:web:ce97d1bbb7737c2603a409"
};

// Inicializa o Firebase (compat)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

export { db };