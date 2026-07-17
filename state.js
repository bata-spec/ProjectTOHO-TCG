// state.js - ゲームの状態を一元管理する(ここだけで宣言)

// エラー表示はアプリ全体でここ1箇所だけに定義する。
// 他のファイルでは絶対に window.onerror を再定義しないこと。
// （過去に複数ファイルで再定義され、最後に読まれたファイルの alert() 版で
// 　上書きされてしまい、エラー発生時に画面が固まる不具合があったため）
window.onerror = function (msg, url, line) {
    const errMsg = `<span style="color:red">⚠️ ERROR: ${msg} (line ${line})</span>`;
    if (typeof battleLogMessages !== 'undefined' && typeof renderBattleLog === 'function') {
        battleLogMessages.push(errMsg);
        renderBattleLog();
    } else {
        // utils.js 読み込み前など、まだログ機構が無い早い段階でのエラー用フォールバック
        const output = document.getElementById('output');
        if (output) output.innerHTML += `<br>${errMsg}`;
    }
    return false;
};

// window.onerror は「同期的なエラー」しか拾わない。async関数の中で起きて誰もcatchしなかった
// エラー（Promiseのunhandled rejection）はこちらでないと拾えず、今まで完全に無音で処理が
// 止まる原因になっていた可能性があるため、同じ仕組みでログに出す。
window.onunhandledrejection = function (event) {
    const reason = event && event.reason;
    const text = (reason && (reason.stack || reason.message)) ? (reason.stack || reason.message) : String(reason);
    const errMsg = `<span style="color:red">⚠️ ERROR(非同期): ${text}</span>`;
    if (typeof battleLogMessages !== 'undefined' && typeof renderBattleLog === 'function') {
        battleLogMessages.push(errMsg);
        renderBattleLog();
    } else {
        const output = document.getElementById('output');
        if (output) output.innerHTML += `<br>${errMsg}`;
    }
};

let cardDatabase = {};

function createPlayer() {
    return {
        currentCard: null, hp: 0, maxHp: 0,
        od: 0, maxOd: 0,
        deathCount: 0,
        firstTurnTaken: false, // false のうちは初期手札分のみ（ターン開始時ドローをスキップ）
        deck: [], hand: [], graveyard: [],
        usedMaterials: [], // 使用済みの覚醒素材カードID一覧（現在のキャラクター用）
        traps: [null, null, null, null, null],
        trapsRevealed: [false, false, false, false, false],
        trapSealedTurns: 0,
        abilitySealedTurns: 0, // キャラクター能力が使用不可な残りターン数
        usedAbilitiesThisTurn: {}, // このターン中に使用済みのキャラクター能力（abilityId単位、自分の手番開始時にリセット）
        characterNegateCharges: {}, // キャラ能力による無効化の使用回数（abilityId単位）
        damageReduction: 0,
        reflectShield: 0,
        activeArea: null, // 展開中のエリアカードID（1人1枚まで。展開後は基本ゲーム終了まで残り続ける）
        controllerType: null,      // 'human' | 'ai' | 'network'
        username: '',              // 表示用のユーザー名（任意）
        selectedCharacterId: null,
        builtDeck: [],
        // --- ネットワーク対戦用（未実装・項目のみ） ---
        networkPlayerId: null,
        networkSessionId: null
    };
}

let myPlayer = createPlayer();
let opponent = createPlayer();

let gameMode = null; // 'single' | 'local2p'

// ローカル2人対戦のデッキ構築フェーズ管理（'p1'→'p2' の順で入力してもらう）
let localBuildPhase = null; // null | 'p1' | 'p2'
let player1Build = null;    // { characterId, deckSelection } プレイヤー1が確定した内容
let player2Build = null;    // { characterId, deckSelection } プレイヤー2が確定した内容

let turnCount = 0;
let currentTurnPlayer = 'me';
let gameOver = false;
let aiDifficulty = 'normal'; // 'easy' | 'normal' | 'hard'（AI対戦時のみ使用）
let lastGameOverLoserPlayer = null; // ネット対戦の同期用：直近のendGame()呼び出しで負けた側（myPlayer/opponentの参照）
let lastGameOverReason = null;

// --- ユーザー名（この端末のブラウザだけに保存。対戦相手にも表示される） ---
const USERNAME_STORAGE_KEY = 'walpurgis_tcg_username';

function loadUsername() {
    try {
        return localStorage.getItem(USERNAME_STORAGE_KEY) || '';
    } catch (e) {
        return '';
    }
}

function saveUsername(name) {
    try {
        localStorage.setItem(USERNAME_STORAGE_KEY, name);
        return true;
    } catch (e) {
        return false;
    }
}

let myUsername = loadUsername();

// --- デッキ構築セッション用の一時状態（今構築中のプレイヤーの選択） ---
let selectedCharacterId = null;
let deckSelection = {};
let deckSortMode = 'type';
let deck = [];

const DECK_MIN = 40;
const DECK_MAX = 60;
const MAX_COPIES_PER_CARD = 3;
const MAX_TRAPS = 5;
const MAX_AREA_COPIES = 1; // エリアカードはデッキに1枚まで

// --- バトルログ表示用の状態 ---
let battleLogMessages = ['準備完了']; // これまでのログ本文を全て保持（表示モード切替時に再描画するため）
let battleLogMode = 'full';      // 'full'（全部） | 'recent'（直近のみ） | 'collapsed'（折りたたみ）
const BATTLE_LOG_RECENT_COUNT = 8;

// --- 対象選択（トラップ破壊・公開などのターゲティングUI）用の一時状態 ---
// 一度に1件しか進行しない前提。null のときは選択モードではない。
let targetSelectionState = null;

// --- カードリストからの選択（山札サーチ・手札の任意カード破棄など）用の一時状態 ---
// こちらも一度に1件しか進行しない前提。
let listSelectionState = null;
