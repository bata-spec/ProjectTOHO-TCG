// network.js - Firebase Realtime Database を使ったネット対戦（現在は「合言葉で接続する」ところまで）
//
// 対戦データそのものの同期（手札・トラップ・ターン進行など）はまだ実装していません。
// まずはこの「ルーム作成→合言葉で参加→お互いの接続を検知する」までを確実に動かしてから、
// 対戦本体の同期を積み上げていきます。

const firebaseConfig = {
    apiKey: "AIzaSyAvtfJASMkq6nc9mX-Qqx0j94pHGCecrDk",
    authDomain: "tcg-yoybf-654a1.firebaseapp.com",
    databaseURL: "https://tcg-yoybf-654a1-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "tcg-yoybf-654a1",
    storageBucket: "tcg-yoybf-654a1.firebasestorage.app",
    messagingSenderId: "5715068649",
    appId: "1:5715068649:web:2d78af78c24c69d7c91278",
    measurementId: "G-WDD1WC421M"
};

let firebaseApp = null;
let firebaseDb = null;
let networkRole = null;       // 'host' | 'guest' | null
let networkRoomCode = null;
let networkClientId = null;   // この端末を識別するランダムID
let networkGuestListenerRef = null;

function initFirebase() {
    if (firebaseApp) return true;
    if (typeof firebase === 'undefined') {
        showNetworkLobbyStatus('❌ Firebaseの読み込みに失敗しました（通信環境をご確認ください）。');
        return false;
    }
    try {
        firebaseApp = firebase.initializeApp(firebaseConfig);
        firebaseDb = firebase.database();
        return true;
    } catch (e) {
        showNetworkLobbyStatus(`❌ Firebaseの初期化に失敗しました：${e.message}`);
        return false;
    }
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O、1/I など紛らわしい文字は除外
    let code = "";
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function generateClientId() {
    return 'c_' + Math.random().toString(36).slice(2, 10);
}

// --- ルーム作成（ホスト側） ---
function createNetworkRoom() {
    if (!initFirebase()) return;

    networkClientId = generateClientId();
    networkRole = 'host';
    const code = generateRoomCode();
    networkRoomCode = code;

    showNetworkLobbyStatus('ルームを作成しています…');

    firebaseDb.ref(`rooms/${code}`).set({
        host: { clientId: networkClientId, online: true },
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        status: 'waiting'
    }).then(() => {
        showRoomCodeDisplay(code);
        showNetworkLobbyStatus(`ルームを作成しました。この合言葉を相手に伝えてください：「${code}」`);
        listenForGuestJoin(code);
    }).catch(e => {
        showNetworkLobbyStatus(`❌ ルーム作成に失敗しました：${e.message}`);
    });
}

function listenForGuestJoin(code) {
    if (networkGuestListenerRef) networkGuestListenerRef.off();
    networkGuestListenerRef = firebaseDb.ref(`rooms/${code}/guest`);
    networkGuestListenerRef.on('value', snapshot => {
        const guest = snapshot.val();
        if (guest && guest.online) {
            showNetworkLobbyStatus(`✅ プレイヤー2が接続しました！（対戦本体の同期は準備中です）`);
        }
    });
}

// --- ルーム参加（ゲスト側） ---
function joinNetworkRoom(codeInput) {
    if (!initFirebase()) return;

    const code = (codeInput || '').trim().toUpperCase();
    if (!code) {
        showNetworkLobbyStatus('❌ 合言葉を入力してください。');
        return;
    }

    networkClientId = generateClientId();
    networkRole = 'guest';
    networkRoomCode = code;

    showNetworkLobbyStatus('接続しています…');

    const roomRef = firebaseDb.ref(`rooms/${code}`);
    roomRef.get().then(snapshot => {
        if (!snapshot.exists()) {
            showNetworkLobbyStatus('❌ その合言葉のルームは見つかりませんでした。合言葉を確認してください。');
            networkRole = null;
            networkRoomCode = null;
            return;
        }
        return roomRef.child('guest').set({ clientId: networkClientId, online: true }).then(() => {
            showNetworkLobbyStatus(`✅ ルーム「${code}」に接続しました！（対戦本体の同期は準備中です）`);
        });
    }).catch(e => {
        showNetworkLobbyStatus(`❌ 接続に失敗しました：${e.message}`);
    });
}

// ロビー画面を抜ける時の後片付け
function leaveNetworkRoom() {
    if (networkGuestListenerRef) {
        networkGuestListenerRef.off();
        networkGuestListenerRef = null;
    }
    if (firebaseDb && networkRoomCode && networkRole) {
        firebaseDb.ref(`rooms/${networkRoomCode}/${networkRole}`).remove().catch(() => {});
    }
    networkRole = null;
    networkRoomCode = null;
}

// --- 画面表示ヘルパー ---
function showNetworkLobbyStatus(message) {
    const el = document.getElementById('network-lobby-status');
    if (el) el.innerText = message;
    updateDisplay(message);
}

function showRoomCodeDisplay(code) {
    const el = document.getElementById('network-room-code-display');
    if (el) {
        el.innerText = `合言葉：${code}`;
        el.style.display = 'block';
    }
}

// --- 画面遷移 ---
function goToNetworkLobby() {
    const modeScreen = document.getElementById('mode-select-screen');
    const lobbyScreen = document.getElementById('network-lobby-screen');
    if (modeScreen) modeScreen.style.display = "none";
    if (lobbyScreen) lobbyScreen.style.display = "block";

    const statusEl = document.getElementById('network-lobby-status');
    if (statusEl) statusEl.innerText = '';
    const codeDisplay = document.getElementById('network-room-code-display');
    if (codeDisplay) codeDisplay.style.display = 'none';
}

function leaveNetworkLobby() {
    leaveNetworkRoom();
    const modeScreen = document.getElementById('mode-select-screen');
    const lobbyScreen = document.getElementById('network-lobby-screen');
    if (lobbyScreen) lobbyScreen.style.display = "none";
    if (modeScreen) modeScreen.style.display = "block";
}
