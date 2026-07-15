// main.js - 初期化処理(司令塔役)

function onDataLoaded() {
    updateDisplay("モードを選択してください。");
    const modeScreen = document.getElementById('mode-select-screen');
    const builderScreen = document.getElementById('deckbuilder-screen');
    if (modeScreen) modeScreen.style.display = "block";
    if (builderScreen) builderScreen.style.display = "none";
}

function summonCharacter(player, cardId, charElementId, statusElementId) {
    const card = cardDatabase[cardId];
    if (!card) {
        updateDisplay(`❌ カードID「${cardId}」が見つかりません`);
        return;
    }
    player.currentCard = cardId;
    player.hp = card.hp;
    player.maxHp = card.hp;
    player.od = card.od;
    player.maxOd = card.od;
    updateFieldDisplay(player, charElementId, statusElementId);
    updateDisplay(`[召喚] ${card.name} 配置！`);
}

function buildRandomOpponentDeck(characterId) {
    const pool = Object.values(cardDatabase).filter(c => c.type === "スペル" || c.type === "カウンタースペル");
    const areaPool = Object.values(cardDatabase).filter(c => c.type === "エリア");
    const counts = {};
    const result = [];

    // キャラクターの覚醒に必要な素材・キーカードは、AIも覚醒を狙えるよう確定で1枚ずつ入れる
    const baseCard = cardDatabase[characterId];
    if (baseCard && baseCard.awakening) {
        [...baseCard.awakening.materials, baseCard.awakening.keyCard].forEach(id => {
            if (cardDatabase[id]) {
                result.push(id);
                counts[id] = 1;
            }
        });
    }

    // エリアカードもAIが使えるよう、ランダムに1種類だけ確定で1枚入れる（デッキに1枚までのルールを厳守）
    if (areaPool.length > 0) {
        const areaCard = areaPool[Math.floor(Math.random() * areaPool.length)];
        result.push(areaCard.id);
        counts[areaCard.id] = 1;
    }

    const targetSize = DECK_MIN + Math.floor(Math.random() * (DECK_MAX - DECK_MIN + 1));

    let safety = 0;
    while (result.length < targetSize && safety < targetSize * 20) {
        safety++;
        const card = pool[Math.floor(Math.random() * pool.length)];
        counts[card.id] = counts[card.id] || 0;
        if (counts[card.id] >= MAX_COPIES_PER_CARD) continue; // 1種類3枚までのルールを厳守
        counts[card.id]++;
        result.push(card.id);
    }
    return result;
}

function pickRandomOpponentCharacter() {
    const characterIds = Object.keys(cardDatabase).filter(id => !cardDatabase[id].type && !id.startsWith("EX"));
    return characterIds[Math.floor(Math.random() * characterIds.length)];
}

// 対戦開始時のプレイヤー状態リセット＋キャラクター召喚をまとめた共通処理
// （シングルプレイのmyPlayer/AI、ローカル2人対戦のプレイヤー1/2、すべてここを通る）
function resetPlayerForBattle(player, deckArray, characterId, controllerType, charElementId, statusElementId) {
    player.deck = deckArray;
    player.hand = [];
    player.graveyard = [];
    player.traps = [null, null, null, null, null];
    player.trapsRevealed = [false, false, false, false, false];
    player.trapSealedTurns = 0;
    player.damageReduction = 0;
    player.reflectShield = 0;
    player.activeArea = null;
    player.deathCount = 0;
    player.firstTurnTaken = false;
    player.usedMaterials = [];
    player.abilitySealedTurns = 0;
    player.usedAbilitiesThisTurn = {};
    player.characterNegateCharges = {};
    player.controllerType = controllerType;

    summonCharacter(player, characterId, charElementId, statusElementId);
}

async function initBattle() {
    // 前回の対戦が終了状態(gameOver=true)のまま呼ばれることがある（再戦時）ため、
    // 何よりも先にリセットしておく。ここが後回しだと、直後のドロー処理が
    // 「ゲーム終了済み」と誤判定されて即座に中断してしまう。
    gameOver = false;
    targetSelectionState = null;
    listSelectionState = null;
    hideActionPrompt();

    if (gameMode === 'local2p') {
        // --- ローカル2人対戦：プレイヤー1・プレイヤー2ともに人間操作 ---
        const p1Deck = buildDeckArrayFrom(player1Build.deckSelection);
        shuffleDeck(p1Deck);
        resetPlayerForBattle(myPlayer, p1Deck, player1Build.characterId, CONTROLLER_TYPES.HUMAN, "my-character", "my-status");

        const p2Deck = buildDeckArrayFrom(player2Build.deckSelection);
        shuffleDeck(p2Deck);
        resetPlayerForBattle(opponent, p2Deck, player2Build.characterId, CONTROLLER_TYPES.HUMAN, "opponent-character", "opponent-status");
    } else {
        // --- シングルプレイ：自分 vs AI（相手デッキは毎回ランダム生成） ---
        resetPlayerForBattle(myPlayer, deck.slice(), selectedCharacterId, CONTROLLER_TYPES.HUMAN, "my-character", "my-status");

        const opponentCharacterId = pickRandomOpponentCharacter();
        const opponentDeck = buildRandomOpponentDeck(opponentCharacterId);
        shuffleDeck(opponentDeck);
        resetPlayerForBattle(opponent, opponentDeck, opponentCharacterId, CONTROLLER_TYPES.AI, "opponent-character", "opponent-status");
    }

    // --- 初期手札 ---
    await drawCard(myPlayer, 5);
    await drawCard(opponent, 5);
    if (gameOver) return;

    turnCount = 0;
    currentTurnPlayer = 'me';

    updateTrapDisplay();
    updateAreaDisplay();
    updateBattleDeckCounts();
    updateGraveyardDisplay(myPlayer);
    updateGraveyardDisplay(opponent);
    updateHandDisplay();
    refreshAbilityDisplay();

    updateDisplay(`山札構築完了：${getPlayerLabel(myPlayer)} ${myPlayer.deck.length}枚 / ${getPlayerLabel(opponent)} ${opponent.deck.length}枚`);

    if (gameMode === 'local2p') {
        // デッキ構築を終えたばかりの端末はプレイヤー2側が持っているはずなので、
        // 最初の手番であるプレイヤー1に一度渡してもらう
        await showPassScreen('プレイヤー1に端末を渡してください', 'プレイヤー1が準備できたらタップ');
    }

    await startTurn();
}
