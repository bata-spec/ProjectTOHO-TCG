// deck_builder.js - デッキ構築画面の処理
// シングルプレイ（vs AI）とローカル2人対戦の両方で共用する。
// ローカル2人対戦の場合は、この画面を「プレイヤー1→（端末を渡す）→プレイヤー2」の順に2回通ってから対戦開始する。

const DECK_STORAGE_KEY = 'walpurgis_tcg_saved_decks';

// --- モード選択 ---

function selectGameMode(mode) {
    gameMode = mode;
    localBuildPhase = (mode === 'local2p') ? 'p1' : null;
    player1Build = null;
    player2Build = null;
    selectedCharacterId = null;
    deckSelection = {};

    if (mode === 'single') {
        const select = document.getElementById('ai-difficulty-select');
        aiDifficulty = select ? select.value : 'normal';
    }

    const modeScreen = document.getElementById('mode-select-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    if (modeScreen) modeScreen.style.display = "none";
    if (builderScreen) builderScreen.style.display = "block";

    playBGM('deckbuilder');
    initDeckBuilder();
}

function backToModeSelect() {
    if (gameMode === 'network') leaveNetworkRoom();
    gameMode = null;
    localBuildPhase = null;
    player1Build = null;
    player2Build = null;

    const modeScreen = document.getElementById('mode-select-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    if (builderScreen) builderScreen.style.display = "none";
    if (modeScreen) modeScreen.style.display = "block";

    playBGM('title');
}

// --- 初期化・画面ごとの見出し/ボタン設定 ---

function initDeckBuilder() {
    renderCharacterSelect();
    renderDeckSelect();
    updateDeckCount();
    renderSavedDeckList();
    checkAwakeningWarning();
    configureBuilderScreenForPhase();
}

// ローカル2人対戦は同じ画面を2回使う（プレイヤー1→プレイヤー2）ため、
// 見出しと下部ボタンの文言・動作をフェーズに応じて切り替える。
function configureBuilderScreenForPhase() {
    const heading = document.getElementById('deckbuilder-heading');
    const btn = document.getElementById('go-to-battle-btn');
    if (!heading || !btn) return;

    if (gameMode === 'local2p' && localBuildPhase === 'p1') {
        heading.innerText = 'プレイヤー1：キャラクターとデッキを選択してください';
        btn.innerText = '次へ（プレイヤー2に交代）';
        btn.onclick = () => confirmLocalBuildStep();
    } else if (gameMode === 'local2p' && localBuildPhase === 'p2') {
        heading.innerText = 'プレイヤー2：キャラクターとデッキを選択してください';
        btn.innerText = '対戦開始';
        btn.onclick = () => confirmLocalBuildStep();
    } else if (gameMode === 'network') {
        heading.innerText = 'ネット対戦：キャラクターとデッキを選択してください';
        btn.innerText = '準備完了（相手を待つ）';
        btn.onclick = () => confirmNetworkBuildStep();
    } else {
        heading.innerText = 'デッキを構築してください';
        btn.innerText = '戦闘画面へ';
        btn.onclick = () => startBattle();
    }
    updateGoButtonState();
}

// ローカル2人対戦：現在のプレイヤーの構築内容を確定し、次のプレイヤーへ（またはそのまま対戦開始へ）進む
function confirmLocalBuildStep() {
    const total = getDeckTotal();
    if (!selectedCharacterId || total < DECK_MIN || total > DECK_MAX) {
        updateDisplay(`❌ キャラクターと${DECK_MIN}〜${DECK_MAX}枚の山札を選択してください。`);
        return;
    }

    if (localBuildPhase === 'p1') {
        player1Build = { characterId: selectedCharacterId, deckSelection: { ...deckSelection } };
        localBuildPhase = 'p2';
        selectedCharacterId = null;
        deckSelection = {};

        // プレイヤー1のデッキが見えないよう、渡す演出を挟んでから次の構築画面を出す
        showPassScreen('プレイヤー2に端末を渡してください', 'プレイヤー2が準備できたらタップ').then(() => {
            initDeckBuilder();
        });
    } else if (localBuildPhase === 'p2') {
        player2Build = { characterId: selectedCharacterId, deckSelection: { ...deckSelection } };
        startBattle();
    }
}

// --- キャラクター選択 ---

function renderCharacterSelect() {
    const container = document.getElementById('character-select-list');
    if (!container) return;
    container.innerHTML = "";

    Object.values(cardDatabase).forEach(card => {
        const isCharacter = !card.type && !card.id.startsWith("EX");
        if (!isCharacter) return;

        const row = document.createElement("div");
        row.className = "character-select-row";

        const label = document.createElement("label");
        label.className = "character-select-option";

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "character-select";
        radio.value = card.id;
        radio.checked = (card.id === selectedCharacterId);
        radio.onchange = () => {
            selectedCharacterId = card.id;
            updateGoButtonState();
            checkAwakeningWarning();
            playCharacterBGM(card.motif);
        };

        const img = document.createElement("img");
        img.className = "character-select-thumb";
        setImageWithFallback(img, getCardArtPath(card));
        img.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCardDetail(card.id);
        };

        label.appendChild(radio);
        label.appendChild(img);
        label.append(` ${card.name}（HP:${card.hp} / コスト:${card.od}）`);
        row.appendChild(label);

        // このキャラのコンセプトに合わせて、デッキを自動で組んでくれるボタン
        const conceptBtn = document.createElement("button");
        conceptBtn.type = "button";
        conceptBtn.className = "concept-deck-btn";
        conceptBtn.innerText = "コンセプトデッキで組む";
        conceptBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            useConceptDeck(card.id);
        };
        row.appendChild(conceptBtn);

        container.appendChild(row);
    });
}

// 汎用カードから、そのキャラの専用カードではないものをランク指定で拾ってくる（頭数を揃える用）
function pickGenericFiller(type, count, rank) {
    return Object.values(cardDatabase)
        .filter(c => c.type === type && !c.conceptCharacterId && (!rank || c.rank === rank))
        .slice(0, count)
        .map(c => c.id);
}

// 指定キャラの「コンセプトデッキ」の選択内容を組み立てる：
// 覚醒素材・キー（各1枚）＋ そのキャラ専用のスペル10種／カウンタースペル5種（各2枚）＋ 汎用の定番数枚で頭数を揃える
function buildConceptDeckSelection(characterId) {
    const selection = {};
    const baseCard = cardDatabase[characterId];

    if (baseCard && baseCard.awakening) {
        (baseCard.awakening.materials || []).forEach(id => { selection[id] = 1; });
        if (baseCard.awakening.keyCard) selection[baseCard.awakening.keyCard] = 1;
    }

    Object.values(cardDatabase).forEach(c => {
        if (c.conceptCharacterId === characterId && (c.type === 'スペル' || c.type === 'カウンタースペル')) {
            selection[c.id] = 2;
        }
    });

    const fillerIds = [
        ...pickGenericFiller('スペル', 3, 'II'),
        ...pickGenericFiller('カウンタースペル', 2, 'I')
    ];
    fillerIds.forEach(id => { selection[id] = 2; });

    return selection;
}

// 「コンセプトデッキで組む」ボタン：キャラを選び、そのコンセプトに沿ったデッキを自動で組む
// （組んだ後も通常のデッキ編集画面でそのまま枚数を調整できる）
function useConceptDeck(characterId) {
    selectedCharacterId = characterId;
    deckSelection = buildConceptDeckSelection(characterId);

    renderCharacterSelect();
    renderDeckSelect();
    updateDeckCount();
    checkAwakeningWarning();

    const charCard = cardDatabase[characterId];
    playCharacterBGM(charCard ? charCard.motif : null);
    updateDisplay(`🎴 ${charCard ? charCard.name : characterId}のコンセプトデッキを組みました。必要なら枚数を調整してから戦闘画面へ進んでください。`);
}

// 選択中のキャラクターが覚醒に必要な素材・キーカードをデッキに入れ忘れていないか警告する
function checkAwakeningWarning() {
    const warningBox = document.getElementById('awakening-warning');
    if (!warningBox) return;

    if (!selectedCharacterId) {
        warningBox.style.display = "none";
        return;
    }

    const charCard = cardDatabase[selectedCharacterId];
    if (!charCard || !charCard.awakening) {
        warningBox.style.display = "none";
        return;
    }

    const required = [...(charCard.awakening.materials || []), charCard.awakening.keyCard].filter(Boolean);
    const missing = required.filter(cardId => !deckSelection[cardId] || deckSelection[cardId] < 1);

    if (missing.length === 0) {
        warningBox.style.display = "none";
        return;
    }

    const missingNames = missing.map(cardId => (cardDatabase[cardId] ? cardDatabase[cardId].name : cardId));
    warningBox.innerText = `⚠️ このキャラクターの覚醒に必要なカードがデッキに入っていません：${missingNames.join('、')}（覚醒できなくても対戦は可能です）`;
    warningBox.style.display = "block";
}

// --- デッキ選択（マジック・トラップ・素材・キー） ---

const TYPE_ORDER = ["スペル", "カウンタースペル", "エリア", "素材", "キー"];

// --- お気に入りカード（この端末のブラウザにだけ保存） ---
const FAVORITES_STORAGE_KEY = 'walpurgis_tcg_favorite_cards';

function loadFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
        return new Set();
    }
}

function saveFavorites(set) {
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...set]));
    } catch (e) { /* 保存できなくても致命的ではないので無視する */ }
}

let favoriteCardIds = loadFavorites();

function isFavoriteCard(cardId) {
    return favoriteCardIds.has(cardId);
}

function toggleFavoriteCard(cardId) {
    if (favoriteCardIds.has(cardId)) favoriteCardIds.delete(cardId);
    else favoriteCardIds.add(cardId);
    saveFavorites(favoriteCardIds);
    renderDeckSelect();
}

function getSortedDeckCards() {
    const cards = Object.values(cardDatabase).filter(c => TYPE_ORDER.includes(c.type));

    switch (deckSortMode) {
        case 'effect':
            cards.sort((a, b) => {
                const ea = a.effectId || a.type;
                const eb = b.effectId || b.type;
                if (ea !== eb) return ea < eb ? -1 : 1;
                return a.cost - b.cost;
            });
            break;
        case 'cost':
            cards.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'ja'));
            break;
        case 'name':
            cards.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
            break;
        case 'type':
        default:
            cards.sort((a, b) => {
                const ta = TYPE_ORDER.indexOf(a.type);
                const tb = TYPE_ORDER.indexOf(b.type);
                if (ta !== tb) return ta - tb;
                return a.cost - b.cost;
            });
    }

    // 並び順は保ったまま、お気に入り登録済みのカードだけ先頭にまとめる
    cards.sort((a, b) => (isFavoriteCard(b.id) ? 1 : 0) - (isFavoriteCard(a.id) ? 1 : 0));
    return cards;
}

function renderDeckSelect() {
    const container = document.getElementById('deck-select-list');
    if (!container) return;
    container.innerHTML = "";

    getSortedDeckCards().forEach(card => {
        deckSelection[card.id] = deckSelection[card.id] || 0;

        const row = document.createElement("div");
        row.className = "deck-select-row";

        const favBtn = document.createElement("button");
        favBtn.className = "fav-btn";
        favBtn.innerText = isFavoriteCard(card.id) ? "★" : "☆";
        favBtn.title = "お気に入りに登録/解除";
        favBtn.onclick = () => toggleFavoriteCard(card.id);

        const img = document.createElement("img");
        img.className = "deck-select-thumb";
        setImageWithFallback(img, getCardArtPath(card));
        img.onclick = () => showCardDetail(card.id);

        const label = document.createElement("span");
        label.className = "deck-select-label";
        label.innerText = `[${card.type}] ${card.name}（${formatCardCost(card)}）`;
        label.onclick = () => showCardDetail(card.id);

        const stepper = document.createElement("div");
        stepper.className = "deck-qty-stepper";

        const minusBtn = document.createElement("button");
        minusBtn.className = "qty-btn";
        minusBtn.innerText = "−";
        minusBtn.onclick = () => stepCardQty(card.id, -1);

        const qtyValue = document.createElement("span");
        qtyValue.className = "qty-value";
        qtyValue.id = `qty-value-${card.id}`;
        qtyValue.innerText = deckSelection[card.id];

        const plusBtn = document.createElement("button");
        plusBtn.className = "qty-btn";
        plusBtn.innerText = "＋";
        plusBtn.onclick = () => stepCardQty(card.id, 1);

        stepper.appendChild(minusBtn);
        stepper.appendChild(qtyValue);
        stepper.appendChild(plusBtn);

        row.appendChild(favBtn);
        row.appendChild(img);
        row.appendChild(label);
        row.appendChild(stepper);
        container.appendChild(row);
    });
}

// +/− ボタンでの枚数変更（リスト側・詳細パネル側の両方をその場で同期）
function stepCardQty(cardId, delta) {
    const card = cardDatabase[cardId];
    const cap = (card && card.type === 'エリア') ? MAX_AREA_COPIES : MAX_COPIES_PER_CARD;

    let v = (deckSelection[cardId] || 0) + delta;
    if (v < 0) v = 0;
    if (v > cap) v = cap;
    deckSelection[cardId] = v;

    const rowValue = document.getElementById(`qty-value-${cardId}`);
    if (rowValue) rowValue.innerText = v;

    const detailValue = document.getElementById('detail-qty-value');
    if (detailValue) detailValue.innerText = v;

    updateDeckCount();
    checkAwakeningWarning();
}

function getDeckTotal() {
    return Object.values(deckSelection).reduce((sum, n) => sum + n, 0);
}

function updateDeckCount() {
    const display = document.getElementById('deck-count-display');
    const total = getDeckTotal();
    if (display) display.innerText = `選択枚数: ${total}枚（${DECK_MIN}〜${DECK_MAX}枚にしてください）`;
    updateGoButtonState();
}

function updateGoButtonState() {
    const btn = document.getElementById('go-to-battle-btn');
    if (!btn) return;
    const total = getDeckTotal();
    const ok = selectedCharacterId !== null && total >= DECK_MIN && total <= DECK_MAX;
    btn.disabled = !ok;
}

function buildDeckArrayFrom(selection) {
    const arr = [];
    Object.entries(selection).forEach(([cardId, qty]) => {
        for (let i = 0; i < qty; i++) arr.push(cardId);
    });
    return arr;
}

// 既存の呼び出し元（グローバルのdeckSelectionを使う版）との互換のために残す
function buildDeckArray() {
    return buildDeckArrayFrom(deckSelection);
}

function shuffleDeck(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function startBattle() {
    if (gameMode === 'local2p') {
        if (!player1Build || !player2Build) {
            updateDisplay('❌ 2人分のデッキ構築が完了していません。');
            return;
        }
    } else {
        const total = getDeckTotal();
        if (!selectedCharacterId || total < DECK_MIN || total > DECK_MAX) {
            updateDisplay(`❌ キャラクターと${DECK_MIN}〜${DECK_MAX}枚の山札を選択してください。`);
            return;
        }
        deck = buildDeckArray();
        shuffleDeck(deck);
    }

    document.getElementById('deckbuilder-screen').style.display = "none";
    document.getElementById('battle-screen').style.display = "block";

    initBattle();
}

// --- デッキの保存・読み込み（localStorage） ---

function loadSavedDecks() {
    try {
        const raw = localStorage.getItem(DECK_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveSavedDecksList(list) {
    try {
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(list));
        return true;
    } catch (e) {
        return false;
    }
}

function saveCurrentDeck() {
    const nameInput = document.getElementById('deck-save-name');
    const name = (nameInput && nameInput.value.trim()) || '';
    if (!name) {
        updateDisplay('❌ デッキ名を入力してください。');
        return;
    }
    if (!selectedCharacterId) {
        updateDisplay('❌ キャラクターを選択してから保存してください。');
        return;
    }
    const total = getDeckTotal();
    if (total < DECK_MIN || total > DECK_MAX) {
        updateDisplay(`❌ ${DECK_MIN}〜${DECK_MAX}枚になるよう調整してから保存してください。`);
        return;
    }

    const list = loadSavedDecks();
    const entry = { name, characterId: selectedCharacterId, deckSelection: { ...deckSelection } };
    const existingIndex = list.findIndex(d => d.name === name);
    if (existingIndex !== -1) {
        list[existingIndex] = entry; // 同名なら上書き保存
    } else {
        list.push(entry);
    }

    if (saveSavedDecksList(list)) {
        updateDisplay(`💾 デッキ「${name}」を保存しました。`);
        if (nameInput) nameInput.value = '';
        renderSavedDeckList();
    } else {
        updateDisplay('❌ デッキの保存に失敗しました（この端末ではブラウザの保存機能が使えない可能性があります）。');
    }
}

function renderSavedDeckList() {
    const container = document.getElementById('saved-deck-list');
    if (!container) return;
    container.innerHTML = "";

    const list = loadSavedDecks();
    if (list.length === 0) {
        container.innerText = '保存されたデッキはまだありません。';
        return;
    }

    list.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'saved-deck-row';

        const charCard = cardDatabase[entry.characterId];
        const total = Object.values(entry.deckSelection).reduce((a, b) => a + b, 0);

        const label = document.createElement('span');
        label.className = 'saved-deck-label';
        label.innerText = `${entry.name}（${charCard ? charCard.name : entry.characterId} / ${total}枚）`;

        const loadBtn = document.createElement('button');
        loadBtn.innerText = '読み込む';
        loadBtn.onclick = () => loadSavedDeck(index);

        const renameBtn = document.createElement('button');
        renameBtn.innerText = '名前変更';
        renameBtn.onclick = () => renameSavedDeck(index);

        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = '削除';
        deleteBtn.onclick = () => deleteSavedDeck(index);

        row.appendChild(label);
        row.appendChild(loadBtn);
        row.appendChild(renameBtn);
        row.appendChild(deleteBtn);
        container.appendChild(row);
    });
}

function loadSavedDeck(index) {
    const list = loadSavedDecks();
    const entry = list[index];
    if (!entry) return;

    selectedCharacterId = entry.characterId;
    deckSelection = { ...entry.deckSelection };

    renderCharacterSelect();
    renderDeckSelect();
    updateDeckCount();
    checkAwakeningWarning();

    updateDisplay(`📂 デッキ「${entry.name}」を読み込みました。`);
}

function deleteSavedDeck(index) {
    const list = loadSavedDecks();
    const entry = list[index];
    if (!entry) return;
    list.splice(index, 1);
    saveSavedDecksList(list);
    renderSavedDeckList();
    updateDisplay(`🗑️ デッキ「${entry.name}」を削除しました。`);
}

function renameSavedDeck(index) {
    const list = loadSavedDecks();
    const entry = list[index];
    if (!entry) return;

    const newName = window.prompt('新しいデッキ名を入力してください', entry.name);
    if (newName === null) return; // キャンセル
    const trimmed = newName.trim();
    if (!trimmed) {
        updateDisplay('❌ デッキ名を入力してください。');
        return;
    }
    if (trimmed === entry.name) return;
    if (list.some((d, i) => i !== index && d.name === trimmed)) {
        updateDisplay(`❌ 「${trimmed}」という名前のデッキは既にあります。`);
        return;
    }

    const oldName = entry.name;
    entry.name = trimmed;
    saveSavedDecksList(list);
    renderSavedDeckList();
    updateDisplay(`✏️ デッキ「${oldName}」を「${trimmed}」に名前変更しました。`);
}
