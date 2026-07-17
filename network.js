// network.js - Firebase Realtime Database を使ったネット対戦
//
// 「ルーム作成→合言葉で参加」で接続した後、両者がデッキを組んで準備完了すると、
// ホスト側が最初の状態（初期手札など）を計算してFirebaseに書き込み、
// 以後は手番側の端末が行動のたびに状態をまるごと同期する（相手側は同期を受け取って表示するだけ）。
//
// 【今回の実装でできないこと（既知の制限）】
// ・相手の手番中に、自分がカウンタースペルを発動するかどうかを「その場で」選ぶことはできない。
// 　（AIと同じ自動判断ロジックで代わりに判断される。ライブでの応酬にはもう一段の作り込みが必要）
// ・通信が切れた・タブを閉じた等からの自動復帰は無い（もう一度同じ合言葉で入り直す想定）

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
let networkReadyListenerRef = null;
let networkStateListenerRef = null;

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

function otherRole(role) {
    return role === 'host' ? 'guest' : 'host';
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
            networkGuestListenerRef.off();
            networkGuestListenerRef = null;
            showNetworkLobbyStatus(`✅ 対戦相手が接続しました！デッキを組んでください。`);
            goToNetworkDeckBuilder();
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
            showNetworkLobbyStatus(`✅ ルーム「${code}」に接続しました！デッキを組んでください。`);
            goToNetworkDeckBuilder();
        });
    }).catch(e => {
        showNetworkLobbyStatus(`❌ 接続に失敗しました：${e.message}`);
    });
}

// ロビー・対戦を抜ける時の後片付け
function leaveNetworkRoom() {
    if (networkGuestListenerRef) { networkGuestListenerRef.off(); networkGuestListenerRef = null; }
    if (networkReadyListenerRef) { networkReadyListenerRef.off(); networkReadyListenerRef = null; }
    if (networkStateListenerRef) { networkStateListenerRef.off(); networkStateListenerRef = null; }
    if (firebaseDb && networkRoomCode && networkRole) {
        firebaseDb.ref(`rooms/${networkRoomCode}/${networkRole}`).remove().catch(() => {});
    }
    networkRole = null;
    networkRoomCode = null;
    gameMode = null;
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

// --- 画面遷移（ロビー） ---
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
    const waitingScreen = document.getElementById('network-waiting-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    if (lobbyScreen) lobbyScreen.style.display = "none";
    if (waitingScreen) waitingScreen.style.display = "none";
    if (builderScreen) builderScreen.style.display = "none";
    if (modeScreen) modeScreen.style.display = "block";
}

// --- デッキ構築フェーズ（両者が自分の端末で個別に組む） ---
function goToNetworkDeckBuilder() {
    gameMode = 'network';
    selectedCharacterId = null;
    deckSelection = {};

    const lobbyScreen = document.getElementById('network-lobby-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    if (lobbyScreen) lobbyScreen.style.display = "none";
    if (builderScreen) builderScreen.style.display = "block";

    playBGM('deckbuilder');
    initDeckBuilder();
}

// 「準備完了」ボタン：自分のデッキ内容をFirebaseに書き込み、相手を待つ画面に切り替える
function confirmNetworkBuildStep() {
    const total = getDeckTotal();
    if (!selectedCharacterId || total < DECK_MIN || total > DECK_MAX) {
        updateDisplay(`❌ キャラクターと${DECK_MIN}〜${DECK_MAX}枚の山札を選択してください。`);
        return;
    }
    if (!networkRole || !networkRoomCode) {
        updateDisplay('❌ ルームに接続していません。');
        return;
    }

    const myBuild = { characterId: selectedCharacterId, deckSelection: { ...deckSelection }, username: myUsername || '' };

    firebaseDb.ref(`rooms/${networkRoomCode}/${networkRole}Ready`).set(myBuild).then(() => {
        showNetworkWaitingScreen();
        listenForBothReady();
    }).catch(e => {
        updateDisplay(`❌ 準備情報の送信に失敗しました：${e.message}`);
    });
}

function showNetworkWaitingScreen() {
    const builderScreen = document.getElementById('deckbuilder-screen');
    const waitingScreen = document.getElementById('network-waiting-screen');
    if (builderScreen) builderScreen.style.display = "none";
    if (waitingScreen) waitingScreen.style.display = "block";
    updateDisplay('対戦相手の準備が完了するのを待っています…');
}

function listenForBothReady() {
    if (networkReadyListenerRef) networkReadyListenerRef.off();
    networkReadyListenerRef = firebaseDb.ref(`rooms/${networkRoomCode}`);
    networkReadyListenerRef.on('value', snapshot => {
        const room = snapshot.val();
        if (!room || !room.hostReady || !room.guestReady) return;

        networkReadyListenerRef.off();
        networkReadyListenerRef = null;

        // 最初の状態（初期手札など）は、ホスト側だけが1回だけ計算して書き込む
        if (networkRole === 'host') {
            hostBeginNetworkBattle(room.hostReady, room.guestReady);
        }
        startNetworkStateListener();
    });
}

// --- 対戦開始（初期状態の計算はホストのみが行う） ---
function hostBeginNetworkBattle(hostBuild, guestBuild) {
    gameOver = false;
    targetSelectionState = null;
    listSelectionState = null;
    hideActionPrompt();

    const hostDeck = buildDeckArrayFrom(hostBuild.deckSelection);
    shuffleDeck(hostDeck);
    resetPlayerForBattle(myPlayer, hostDeck, hostBuild.characterId, CONTROLLER_TYPES.HUMAN, "my-character", "my-status");
    myPlayer.username = hostBuild.username || 'ホスト';

    const guestDeck = buildDeckArrayFrom(guestBuild.deckSelection);
    shuffleDeck(guestDeck);
    resetPlayerForBattle(opponent, guestDeck, guestBuild.characterId, CONTROLLER_TYPES.NETWORK, "opponent-character", "opponent-status");
    opponent.username = guestBuild.username || 'ゲスト';

    goToNetworkBattleScreen();

    // 初期手札
    drawCard(myPlayer, 5).then(() => drawCard(opponent, 5)).then(() => {
        turnCount = 0;
        currentTurnPlayer = 'me'; // ホストが先手

        updateTrapDisplay();
        updateAreaDisplay();
        updateBattleDeckCounts();
        updateGraveyardDisplay(myPlayer);
        updateGraveyardDisplay(opponent);
        updateHandDisplay();
        refreshAbilityDisplay();

        updateDisplay(`山札構築完了：${getPlayerLabel(myPlayer)} ${myPlayer.deck.length}枚 / ${getPlayerLabel(opponent)} ${opponent.deck.length}枚`);

        playBGM('battle');
        startTurn(); // 内部でmaybeSyncNetworkState()が呼ばれ、初期状態がゲストに届く
    });
}

function goToNetworkBattleScreen() {
    const waitingScreen = document.getElementById('network-waiting-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    const battleScreen = document.getElementById('battle-screen');
    if (waitingScreen) waitingScreen.style.display = "none";
    if (builderScreen) builderScreen.style.display = "none";
    if (battleScreen) battleScreen.style.display = "block";
}

// --- 状態の同期 ---

// 自分の行動が終わった直後、トップレベルの操作関数(useMagic等)の最後から呼ばれる。
// ネット対戦でなければ何もしない。
function maybeSyncNetworkState() {
    if (!networkRole || !firebaseDb || !networkRoomCode) return;
    pushNetworkState();
}

function buildNetworkPayload() {
    const hostData = (networkRole === 'host') ? myPlayer : opponent;
    const guestData = (networkRole === 'host') ? opponent : myPlayer;

    // 今、手番はどちら側か（このデバイスから見た currentTurnPlayer を、絶対的な host/guest に変換する）
    const activeRole = (currentTurnPlayer === 'me') ? networkRole : otherRole(networkRole);

    let gameOverInfo = null;
    if (gameOver && lastGameOverLoserPlayer) {
        const loserRole = (lastGameOverLoserPlayer === myPlayer) ? networkRole : otherRole(networkRole);
        gameOverInfo = { loserRole, reason: lastGameOverReason || '' };
    }

    return {
        host: stripForSync(hostData),
        guest: stripForSync(guestData),
        activeRole: activeRole,
        turnCount: turnCount,
        gameOver: gameOver,
        gameOverInfo: gameOverInfo,
        battleLog: battleLogMessages.slice(-200), // ログが際限なく増えないよう直近だけ送る
        lastWriter: networkRole,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
}

// Firebase Realtime Databaseは、配列内のnullを「削除」として扱うため、
// [null, null, ...] のような配列がそのまま送れない（歯抜けになる/消える）。
// そのため traps 配列だけは null を番兵文字列に置き換えてから送り、受信時に戻す。
const EMPTY_TRAP_SENTINEL = "__EMPTY__";

function stripForSync(player) {
    const copy = JSON.parse(JSON.stringify(player));
    if (Array.isArray(copy.traps)) {
        copy.traps = copy.traps.map(t => (t === null || t === undefined) ? EMPTY_TRAP_SENTINEL : t);
    }
    return copy;
}

function restoreFromSync(data) {
    if (Array.isArray(data.traps)) {
        data.traps = data.traps.map(t => (t === EMPTY_TRAP_SENTINEL ? null : t));
    } else {
        data.traps = [null, null, null, null, null];
    }
    if (!Array.isArray(data.trapsRevealed)) {
        data.trapsRevealed = [false, false, false, false, false];
    }
    return data;
}

function pushNetworkState() {
    const payload = buildNetworkPayload();
    firebaseDb.ref(`rooms/${networkRoomCode}/state`).set(payload).catch(e => {
        updateDisplay(`⚠️ 対戦相手との同期に失敗しました：${e.message}`);
    });
}

function startNetworkStateListener() {
    if (networkStateListenerRef) networkStateListenerRef.off();
    networkStateListenerRef = firebaseDb.ref(`rooms/${networkRoomCode}/state`);
    networkStateListenerRef.on('value', snapshot => {
        const payload = snapshot.val();
        if (!payload) return;
        applyNetworkState(payload);
    });
}

// 受け取った状態を、このデバイスのmyPlayer/opponentに反映する
function applyNetworkState(payload) {
    if (!payload || payload.lastWriter === networkRole) return; // 自分自身の書き込みechoは無視する

    const hostData = restoreFromSync(payload.host || {});
    const guestData = restoreFromSync(payload.guest || {});

    if (networkRole === 'host') {
        Object.assign(myPlayer, hostData);
        Object.assign(opponent, guestData);
    } else {
        Object.assign(myPlayer, guestData);
        Object.assign(opponent, hostData);
    }
    // controllerTypeは同期データに引きずられず、常にこのデバイスから見た役割で固定する
    myPlayer.controllerType = CONTROLLER_TYPES.HUMAN;
    opponent.controllerType = CONTROLLER_TYPES.NETWORK;

    turnCount = payload.turnCount || 0;

    const wasMyTurn = (currentTurnPlayer === 'me');
    currentTurnPlayer = (payload.activeRole === networkRole) ? 'me' : 'opponent';

    if (Array.isArray(payload.battleLog)) {
        battleLogMessages = payload.battleLog.slice();
    }

    // 対戦画面がまだ表示されていなければ切り替える（ゲストが初回の状態を受け取った時）
    goToNetworkBattleScreen();

    refreshFieldDisplay(myPlayer);
    refreshFieldDisplay(opponent);
    updateTurnIndicator();
    updateTrapDisplay();
    updateAreaDisplay();
    updateBattleDeckCounts();
    updateGraveyardDisplay(myPlayer);
    updateGraveyardDisplay(opponent);
    updateHandDisplay();
    refreshAbilityDisplay();
    renderBattleLog();

    if (payload.gameOverInfo && !gameOver) {
        const loserLocal = (payload.gameOverInfo.loserRole === networkRole) ? myPlayer : opponent;
        endGame(loserLocal, payload.gameOverInfo.reason);
        return;
    }

    // 今まさに自分の番が始まったところなら、ここで初めてローカルに startTurn() を実行する
    // （ドロー・コスト回復など、本来は手番側の端末が権威を持って行うべき処理のため）
    if (!wasMyTurn && currentTurnPlayer === 'me' && !gameOver) {
        startTurn();
    }
}
