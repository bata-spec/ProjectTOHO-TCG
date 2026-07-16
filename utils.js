// utils.js - 画面表示・ダメージ処理・カード詳細表示・対象選択UIなどの共通処理
// window.onerror はここでは定義しない（state.js の1箇所のみ）

function updateDisplay(message) {
    battleLogMessages.push(message);
    renderBattleLog();
}

// カードのコスト表示用文字列。エリアカードは固定コストを持たない（上限到達時に全消費）ため専用表記にする。
function formatCardCost(card) {
    if (!card) return '-';
    if (card.type === 'エリア') return 'コスト上限到達時に全消費';
    return `コスト${card.cost}`;
}

function renderBattleLog() {
    const output = document.getElementById('output');
    if (!output) return;

    let toShow = battleLogMessages;
    if (battleLogMode === 'recent') {
        toShow = battleLogMessages.slice(-BATTLE_LOG_RECENT_COUNT);
    } else if (battleLogMode === 'collapsed') {
        toShow = battleLogMessages.slice(-1); // 折りたたみ時は直近1件だけ見せる
    }

    output.innerHTML = toShow.map(m => `<div class="log-line">${m}</div>`).join('');
    output.scrollTop = output.scrollHeight; // 常に最新行が見える位置までスクロール
}

// ログ表示モードの切り替え（全部／直近のみ／折りたたみ）
function setBattleLogMode(mode) {
    battleLogMode = mode;
    document.querySelectorAll('.log-mode-btn').forEach(btn => {
        btn.classList.toggle('log-mode-btn-active', btn.dataset.mode === mode);
    });
    renderBattleLog();
}

// モードに応じてプレイヤーの呼び名を返す
function getPlayerLabel(player) {
    if (gameMode === 'local2p') {
        return player === myPlayer ? 'プレイヤー1' : 'プレイヤー2';
    }
    if (gameMode === 'network') {
        // 「自分/相手」は表示している端末ごとに意味が変わってしまい、ログを同期すると
        // 主語がねじれて見えるため、ネット対戦ではどちらの画面でも同じ意味になる
        // キャラクター名を主語として使う。
        const card = cardDatabase[player.currentCard];
        return card ? card.name : (player === myPlayer ? '自分' : '相手');
    }
    return player === myPlayer ? '自分' : '相手';
}

// 画像読み込み失敗時にカード裏面へフォールバックする共通ハンドラ
function setImageWithFallback(imgEl, path) {
    if (!imgEl) return;
    imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = CARD_BACK_IMAGE;
    };
    imgEl.src = path;
}

function updateFieldDisplay(player, charElementId, statusElementId) {
    const charArea = document.getElementById(charElementId);
    const statusArea = document.getElementById(statusElementId);
    const artEl = document.getElementById(charElementId + "-art");
    if (!charArea || !statusArea) return;

    const originalCard = cardDatabase[player.currentCard];
    if (player.currentCard && originalCard) {
        charArea.innerText = originalCard.name;
        statusArea.innerText = `HP: ${player.hp}/${player.maxHp} / コスト: ${player.od}/${player.maxOd}`;
        if (artEl) {
            setImageWithFallback(artEl, getCardArtPath(originalCard));
            artEl.onclick = () => showCardDetail(player.currentCard);
        }
    } else {
        charArea.innerText = "召喚されていません";
        statusArea.innerText = "HP: - / コスト: -";
        if (artEl) setImageWithFallback(artEl, CARD_BACK_IMAGE);
    }
}

// player: myPlayer/opponent を渡すと自動でどちらの表示か判定して更新する
function refreshFieldDisplay(player) {
    if (player === myPlayer) {
        updateFieldDisplay(myPlayer, "my-character", "my-status");
    } else {
        updateFieldDisplay(opponent, "opponent-character", "opponent-status");
    }
}

function updateHandDisplay() {
    const handArea = document.getElementById('hand-area');
    if (!handArea) return;

    const activePlayer = getActivePlayer();
    if (!isHumanControlled(activePlayer)) {
        handArea.innerHTML = `手札: （${getPlayerLabel(activePlayer)}が操作中）`;
        return;
    }

    handArea.innerHTML = "";

    const label = document.createElement("div");
    label.className = "hand-area-label";
    label.innerText = `${getPlayerLabel(activePlayer)}の手札`;
    handArea.appendChild(label);

    const strip = document.createElement("div");
    strip.className = "hand-card-strip";

    activePlayer.hand.forEach((cardId, index) => {
        const card = cardDatabase[cardId];

        const mini = document.createElement("div");
        mini.className = "hand-card-mini";
        mini.onclick = () => confirmHandCard(index);

        const nameEl = document.createElement("div");
        nameEl.className = "hand-card-name";
        nameEl.innerText = card ? card.name : cardId;

        const img = document.createElement("img");
        img.className = "hand-card-art";
        setImageWithFallback(img, getCardArtPath(card));

        const textEl = document.createElement("div");
        textEl.className = "hand-card-text";
        textEl.innerText = card ? (card.text || card.flavor || "") : "";

        mini.appendChild(nameEl);
        mini.appendChild(img);
        mini.appendChild(textEl);
        strip.appendChild(mini);
    });

    handArea.appendChild(strip);
}

// 手札のカードをタップした時：即使用せず、詳細と「使用する/キャンセル」を表示する
function confirmHandCard(index) {
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    const content = document.getElementById('card-detail-content');
    if (!card || !content) return;

    let html = `<img src="${getCardArtPath(card)}" class="detail-art" onerror="this.src='${CARD_BACK_IMAGE}'"><br>`;
    html += `<strong>${card.name}</strong>（${formatCardCost(card)}）<br>`;
    if (card.text) html += `${card.text}<br>`;
    if (card.flavor) html += `<em>${card.flavor}</em><br>`;
    html += `<button onclick="playHandCardConfirmed(${index})">このカードを使用する</button>`;
    html += `<button onclick="clearCardDetail()">キャンセル</button>`;
    content.innerHTML = html;
    openCardDetailPanel();
}

// 「使用する」が押された時だけ、実際にカードを使用する
function playHandCardConfirmed(index) {
    handleHandCardClick(index);
    clearCardDetail();
}

// --- カード詳細パネルの開閉 ---
// カードをタップ→開く／右上の✕をタップ（またはパネル外のカードをタップ）→閉じる、という単純な仕様。

function openCardDetailPanel() {
    const panel = document.getElementById('card-detail-panel');
    if (panel) panel.style.display = "block";
}

function openRulesPanel() {
    const panel = document.getElementById('rules-panel');
    if (panel) panel.style.display = "block";
}

function closeRulesPanel() {
    const panel = document.getElementById('rules-panel');
    if (panel) panel.style.display = "none";
}

function clearCardDetail() {
    const panel = document.getElementById('card-detail-panel');
    const content = document.getElementById('card-detail-content');
    if (content) content.innerHTML = "カードをタップすると詳細が表示されます";
    if (panel) panel.style.display = "none";
}

function showCardDetail(cardId) {
    const card = cardDatabase[cardId];
    const content = document.getElementById('card-detail-content');
    if (!content) return;
    if (!card) {
        content.innerHTML = "カード情報が見つかりません";
        openCardDetailPanel();
        return;
    }

    let html = `<img src="${getCardArtPath(card)}" class="detail-art" onerror="this.src='${CARD_BACK_IMAGE}'"><br>`;
    html += `<strong>${card.name}</strong><br>`;
    if (card.text) html += `${card.text}<br>`;
    if (card.abilities) {
        card.abilities.forEach(a => { html += `${a.text}<br>`; });
    }
    if (card.flavor) html += `<em>${card.flavor}</em>`;

    // デッキ構築画面で、かつデッキに入れられる種類のカードなら、説明と同じ場所で枚数を編集できるようにする
    const builderScreen = document.getElementById('deckbuilder-screen');
    const inBuilder = builderScreen && builderScreen.style.display !== 'none';
    const deckable = ["スペル", "カウンタースペル", "エリア", "素材", "キー"].includes(card.type);
    if (inBuilder && deckable) {
        const qty = deckSelection[cardId] || 0;
        html += `<div class="detail-qty-control">
            <span>デッキ枚数：</span>
            <button onclick="stepCardQty('${cardId}', -1)">−</button>
            <span id="detail-qty-value">${qty}</span>
            <button onclick="stepCardQty('${cardId}', 1)">＋</button>
        </div>`;
    }

    content.innerHTML = html;
    openCardDetailPanel();
}

// 墓地の枚数・一番上のカード画像を更新する（見た目は重なったカードのスタック風にする）
function updateGraveyardDisplay(player) {
    const prefix = player === myPlayer ? "my" : "opponent";
    const countEl = document.getElementById(`${prefix}-graveyard-count`);
    const artEl = document.getElementById(`${prefix}-graveyard-art`);
    const slotEl = document.getElementById(`${prefix}-graveyard-slot`);
    if (countEl) countEl.innerText = `${player.graveyard.length}`;
    if (slotEl) slotEl.classList.toggle("graveyard-slot-stacked", player.graveyard.length > 1);
    if (artEl) {
        if (player.graveyard.length === 0) {
            artEl.style.visibility = "hidden";
        } else {
            artEl.style.visibility = "visible";
            const topCard = cardDatabase[player.graveyard[player.graveyard.length - 1]];
            setImageWithFallback(artEl, getCardArtPath(topCard));
        }
    }
}

// 墓地の中身を一覧表示する（自分・相手どちらの墓地も、双方が確認できる）
function showGraveyardList(player) {
    const content = document.getElementById('card-detail-content');
    if (!content) return;

    const label = getPlayerLabel(player);
    let html = `<strong>${label}の墓地（${player.graveyard.length}枚）</strong><br>`;

    if (player.graveyard.length === 0) {
        html += `<div>まだ何もありません。</div>`;
    } else {
        html += `<div class="graveyard-list-grid">`;
        // 最後に墓地へ送られたカードが先頭に来るよう、逆順に並べる
        [...player.graveyard].reverse().forEach(cardId => {
            const card = cardDatabase[cardId];
            html += `<div class="graveyard-list-item" onclick="showCardDetail('${cardId}')">
                <img src="${getCardArtPath(card)}" onerror="this.src='${CARD_BACK_IMAGE}'">
                <div class="graveyard-list-item-name">${card ? card.name : cardId}</div>
            </div>`;
        });
        html += `</div>`;
    }

    content.innerHTML = html;
    openCardDetailPanel();
}

function applyDamage(player, damage, charElementId, statusElementId) {
    if (!player.currentCard) {
        updateDisplay("⚠️ 対象が召喚されていません！");
        return;
    }
    if (player.hp <= 0) return;

    const card = cardDatabase[player.currentCard];
    player.hp -= damage;
    playSE('damage');
    updateDisplay(`${card.name} に ダメージ ${damage}！`);

    if (player.hp <= 0) {
        if (player.reflectShield > 0) {
            player.reflectShield -= 1;
            player.hp = 1;
            updateDisplay(`🛡️ 破壊無効効果で ${card.name} は破壊を免れた！`);
        } else {
            player.hp = 0;
            player.deathCount += 1;
            updateDisplay(`!!! ${card.name} 破壊（${player.deathCount}回目） !!!`);

            if (player.deathCount >= 3) {
                endGame(player, '3回破壊');
            } else {
                player.hp = player.maxHp;
                player.od = player.maxOd;
                updateDisplay(`${card.name} が復活しました。HP:${player.hp}`);
            }
        }
    }

    updateFieldDisplay(player, charElementId, statusElementId);
}

// 試合を終了させる（多重呼び出し防止つき）。以後の行動を全て止める。
function endGame(loserPlayer, reason) {
    if (gameOver) return;
    gameOver = true;
    lastGameOverLoserPlayer = loserPlayer;
    lastGameOverReason = reason;

    const isMyLoss = (loserPlayer === myPlayer);
    playSE(isMyLoss ? 'defeat' : 'victory');
    playBGM(isMyLoss ? 'defeat' : 'victory');

    updateDisplay(`🏁 GAME SET！${getPlayerLabel(loserPlayer)}の敗北（${reason}）`);

    document.querySelectorAll('#battle-screen button').forEach(btn => btn.disabled = true);
    const handArea = document.getElementById('hand-area');
    if (handArea) handArea.innerHTML = "ゲーム終了";

    // 進行中の対象選択・確認プロンプトが残っていたら、待機中のPromiseを解決してから閉じる
    if (targetSelectionState) { targetSelectionState.resolve([]); targetSelectionState = null; }
    if (listSelectionState) { listSelectionState.resolve({}); listSelectionState = null; }
    hideActionPrompt();

    showGameOverPanel(loserPlayer, reason);
    maybeSyncNetworkState();
}

// --- 勝敗確定後：再戦 or デッキ構築へ戻る ---

function showGameOverPanel(loserPlayer, reason) {
    const backdrop = document.getElementById('modal-backdrop');
    const panel = document.getElementById('game-over-panel');
    const msgEl = document.getElementById('game-over-message');
    if (!panel || !msgEl) return;

    const isMyLoss = (loserPlayer === myPlayer);
    msgEl.innerText = `${isMyLoss ? '😢 敗北……' : '🎉 勝利！'}（${getPlayerLabel(loserPlayer)}が${reason}）`;

    if (backdrop) backdrop.style.display = "block";
    panel.style.display = "block";
}

function hideGameOverPanel() {
    const backdrop = document.getElementById('modal-backdrop');
    const panel = document.getElementById('game-over-panel');
    if (backdrop) backdrop.style.display = "none";
    if (panel) panel.style.display = "none";
}

// 同じデッキ・同じキャラクターのまま、山札を組み直してもう一度対戦する
async function rematchBattle() {
    if (gameMode === 'network') {
        updateDisplay('❌ ネット対戦の再戦は未対応です。一度ロビーに戻って、もう一度ルームを作り直してください。');
        return;
    }

    hideGameOverPanel();
    document.querySelectorAll('#battle-screen button').forEach(btn => btn.disabled = false);
    battleLogMessages = ['同じデッキで再戦します。'];
    renderBattleLog();

    // シングルプレイは`deck`配列を使い回すため、再戦のたびに明示的に組み直す。
    // ローカル2人対戦は毎回 player1Build/player2Build から組み直すので自動的に新しい順番になる。
    if (gameMode !== 'local2p') {
        shuffleDeck(deck);
    }

    await initBattle();
}

// デッキ構築画面へ戻る（デッキ内容・キャラクター選択はそのまま残る。ローカル2人対戦は最初からやり直し）
function returnToDeckBuilder() {
    hideGameOverPanel();

    const battleScreen = document.getElementById('battle-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    if (battleScreen) battleScreen.style.display = "none";
    if (builderScreen) builderScreen.style.display = "block";

    battleLogMessages = ['デッキを構築してください。'];
    renderBattleLog();

    if (gameMode === 'local2p') {
        // 2人分の構築をもう一度やり直してもらう（お互いのデッキが見える状態で片方だけ編集させないため）
        localBuildPhase = 'p1';
        player1Build = null;
        player2Build = null;
        selectedCharacterId = null;
        deckSelection = {};
    }

    initDeckBuilder();
}

// =====================================================================
// パス画面（ローカル2人対戦：1台の端末を渡し合うための「画面を渡してください」演出）
// =====================================================================
// showPassScreen(message, buttonLabel) は Promise<void> を返し、
// 「タップして続行」ボタンが押されたタイミングで解決される。
// シングルプレイ（vs AI）では呼び出されない想定（呼び出し側で gameMode を見て判定する）。

function showPassScreen(message, buttonLabel) {
    return new Promise(resolve => {
        const screen = document.getElementById('pass-screen');
        const msgEl = document.getElementById('pass-screen-message');
        const btn = document.getElementById('pass-screen-button');
        if (!screen || !msgEl || !btn) {
            resolve(); // UI要素が無い環境でもゲームが止まらないよう安全に倒す
            return;
        }

        msgEl.innerText = message;
        btn.innerText = buttonLabel || 'タップして続行';
        btn.onclick = () => {
            screen.style.display = 'none';
            resolve();
        };
        screen.style.display = 'block';
    });
}

// ローカル2人対戦中、今画面を見ているのが手番のプレイヤーとは違う人（例えばトラップの持ち主）
// である必要がある場面の前に呼ぶ。手番のプレイヤーのままなら何もしない（渡す必要が無いため）。
async function ensureViewerIsPlayer(player) {
    if (gameMode !== 'local2p') return; // シングルプレイでは常に自分だけが見ているので不要
    if (player === getActivePlayer()) return;
    await showPassScreen(
        `${getPlayerLabel(player)}に端末を渡してください`,
        `${getPlayerLabel(player)}が準備できたらタップ`
    );
}

// 上記で他プレイヤーに渡していた場合、手番のプレイヤーに端末を返してもらう。
async function returnViewerToActivePlayer(otherPlayer) {
    if (gameMode !== 'local2p') return;
    if (otherPlayer === getActivePlayer()) return; // そもそも渡していない
    await showPassScreen(
        `${getPlayerLabel(getActivePlayer())}に端末を返してください`,
        `${getPlayerLabel(getActivePlayer())}が準備できたらタップ`
    );
}
// showActionPrompt(message, options) は Promise を返し、ユーザーがどれかのボタンを
// 押した時点で options 内の value が resolve される。
// options: [{ label: '表示文言', value: 任意の値 }, ...]

function showActionPrompt(message, options) {
    return new Promise(resolve => {
        const backdrop = document.getElementById('modal-backdrop');
        const panel = document.getElementById('action-prompt-panel');
        const msgEl = document.getElementById('action-prompt-message');
        const optsEl = document.getElementById('action-prompt-options');
        if (!panel || !msgEl || !optsEl) {
            resolve(null); // UI要素が無い環境でもゲームが止まらないよう安全に倒す
            return;
        }

        msgEl.innerText = message;
        optsEl.innerHTML = "";
        options.forEach(opt => {
            const btn = document.createElement("button");
            btn.innerText = opt.label;
            btn.onclick = () => {
                hideActionPrompt();
                resolve(opt.value);
            };
            optsEl.appendChild(btn);
        });

        if (backdrop) backdrop.style.display = "block";
        panel.style.display = "block";
    });
}

function hideActionPrompt() {
    const backdrop = document.getElementById('modal-backdrop');
    const panel = document.getElementById('action-prompt-panel');
    if (backdrop) backdrop.style.display = "none";
    if (panel) panel.style.display = "none";
}

// =====================================================================
// トラップの対象選択UI（破壊・公開などで「どのトラップに使うか」を選ぶ）
// =====================================================================
// beginTrapTargetSelection(targetPlayer, count, message, filterFn) は Promise<number[]> を返す。
// 解決される配列は選ばれたスロット番号（targetPlayer.traps のインデックス）のリスト。
// filterFn(cardId, index) が true を返すスロットだけが選択対象になる（省略時は「置かれているもの全て」）。

function beginTrapTargetSelection(targetPlayer, count, message, filterFn) {
    return new Promise(resolve => {
        const filter = filterFn || ((cardId) => !!cardId);
        const candidateIndices = targetPlayer.traps
            .map((cardId, i) => (filter(cardId, i) ? i : -1))
            .filter(i => i !== -1);

        const need = Math.min(count, candidateIndices.length);

        if (need <= 0) {
            resolve([]);
            return;
        }

        targetSelectionState = {
            targetPlayer,
            need,
            candidateIndices,
            selected: [],
            message,
            resolve
        };

        renderTargetSelectionPrompt();
        updateTrapDisplay();
    });
}

function renderTargetSelectionPrompt() {
    const backdrop = document.getElementById('modal-backdrop');
    const panel = document.getElementById('action-prompt-panel');
    const msgEl = document.getElementById('action-prompt-message');
    const optsEl = document.getElementById('action-prompt-options');
    if (!targetSelectionState || !panel || !msgEl || !optsEl) return;

    const remaining = targetSelectionState.need - targetSelectionState.selected.length;
    msgEl.innerText = `${targetSelectionState.message}（あと${Math.max(remaining, 0)}枚／場のトラップをタップして選択）`;

    optsEl.innerHTML = "";

    const confirmBtn = document.createElement("button");
    confirmBtn.innerText = "決定";
    confirmBtn.disabled = targetSelectionState.selected.length < targetSelectionState.need;
    confirmBtn.onclick = () => confirmTargetSelection();
    optsEl.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "自動選択に任せる";
    cancelBtn.onclick = () => cancelTargetSelection();
    optsEl.appendChild(cancelBtn);

    if (backdrop) backdrop.style.display = "block";
    panel.style.display = "block";
}

// トラップスロットがタップされた時（選択モード中のみ呼ばれる）
function toggleTrapTargetSelect(slotIndex) {
    if (!targetSelectionState) return;
    if (!targetSelectionState.candidateIndices.includes(slotIndex)) return;

    const pos = targetSelectionState.selected.indexOf(slotIndex);
    if (pos !== -1) {
        targetSelectionState.selected.splice(pos, 1);
    } else {
        if (targetSelectionState.selected.length >= targetSelectionState.need) return;
        targetSelectionState.selected.push(slotIndex);
    }

    renderTargetSelectionPrompt();
    updateTrapDisplay();
}

function confirmTargetSelection() {
    if (!targetSelectionState) return;
    const { resolve, selected } = targetSelectionState;
    targetSelectionState = null;
    hideActionPrompt();
    updateTrapDisplay();
    resolve(selected);
}

// 選択を面倒に感じた場合の逃げ道：候補の先頭から自動で必要枚数を選ぶ
function cancelTargetSelection() {
    if (!targetSelectionState) return;
    const { need, candidateIndices, resolve } = targetSelectionState;
    const auto = candidateIndices.slice(0, need);
    targetSelectionState = null;
    hideActionPrompt();
    updateTrapDisplay();
    resolve(auto);
}

// =====================================================================
// カードリストからの選択UI（山札サーチ・手札の任意カード破棄などで使う）
// =====================================================================
// beginListSelection(items, count, message) は Promise<{cardId: 選んだ枚数}> を返す。
// items: [{ id: カードID, label: 表示文言, max: 選べる上限枚数 }]
// デッキ構築画面の枚数ステッパーと同じ +/− の操作感で、必要枚数に達するまで選べる。

function beginListSelection(items, count, message) {
    return new Promise(resolve => {
        const need = Math.min(count, items.reduce((sum, it) => sum + it.max, 0));

        if (need <= 0 || items.length === 0) {
            resolve({});
            return;
        }

        listSelectionState = { items, need, selected: {}, message, resolve };
        renderListSelectionPrompt();
    });
}

function getListSelectionTotal() {
    if (!listSelectionState) return 0;
    return Object.values(listSelectionState.selected).reduce((a, b) => a + b, 0);
}

function renderListSelectionPrompt() {
    const backdrop = document.getElementById('modal-backdrop');
    const panel = document.getElementById('action-prompt-panel');
    const msgEl = document.getElementById('action-prompt-message');
    const optsEl = document.getElementById('action-prompt-options');
    if (!listSelectionState || !panel || !msgEl || !optsEl) return;

    const total = getListSelectionTotal();
    msgEl.innerText = `${listSelectionState.message}（${total}/${listSelectionState.need}枚選択中）`;
    optsEl.innerHTML = "";

    listSelectionState.items.forEach(item => {
        const row = document.createElement("div");
        row.className = "list-select-row";

        const label = document.createElement("span");
        label.className = "list-select-label";
        label.innerText = item.label;

        const stepper = document.createElement("div");
        stepper.className = "list-select-stepper";

        const minusBtn = document.createElement("button");
        minusBtn.className = "qty-btn";
        minusBtn.innerText = "−";
        minusBtn.onclick = () => adjustListSelect(item.id, -1);

        const count = listSelectionState.selected[item.id] || 0;
        const countSpan = document.createElement("span");
        countSpan.className = "qty-value";
        countSpan.innerText = `${count}/${item.max}`;

        const plusBtn = document.createElement("button");
        plusBtn.className = "qty-btn";
        plusBtn.innerText = "＋";
        plusBtn.onclick = () => adjustListSelect(item.id, 1);

        stepper.appendChild(minusBtn);
        stepper.appendChild(countSpan);
        stepper.appendChild(plusBtn);

        row.appendChild(label);
        row.appendChild(stepper);
        optsEl.appendChild(row);
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.innerText = "決定";
    confirmBtn.disabled = total < listSelectionState.need;
    confirmBtn.onclick = () => confirmListSelection();
    optsEl.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "自動選択に任せる";
    cancelBtn.onclick = () => cancelListSelection();
    optsEl.appendChild(cancelBtn);

    if (backdrop) backdrop.style.display = "block";
    panel.style.display = "block";
}

function adjustListSelect(itemId, delta) {
    if (!listSelectionState) return;
    const item = listSelectionState.items.find(it => it.id === itemId);
    if (!item) return;

    const current = listSelectionState.selected[itemId] || 0;
    if (delta > 0 && getListSelectionTotal() >= listSelectionState.need) return; // 合計の上限に到達済み

    let next = current + delta;
    if (next < 0) next = 0;
    if (next > item.max) next = item.max;
    listSelectionState.selected[itemId] = next;

    renderListSelectionPrompt();
}

function confirmListSelection() {
    if (!listSelectionState) return;
    const { resolve, selected } = listSelectionState;
    listSelectionState = null;
    hideActionPrompt();
    resolve(selected);
}

// 面倒に感じた場合の逃げ道：先頭のカードから必要枚数を自動で割り当てる
function cancelListSelection() {
    if (!listSelectionState) return;
    const { items, need, resolve } = listSelectionState;
    const auto = {};
    let remaining = need;
    for (const item of items) {
        if (remaining <= 0) break;
        const take = Math.min(item.max, remaining);
        if (take > 0) {
            auto[item.id] = take;
            remaining -= take;
        }
    }
    listSelectionState = null;
    hideActionPrompt();
    resolve(auto);
}
