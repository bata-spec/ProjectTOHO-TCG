// controllers.js - 操作主体（人間 / AI / ネットワーク）の抽象化

const CONTROLLER_TYPES = {
    HUMAN: 'human',
    AI: 'ai',
    NETWORK: 'network' // 今後実装予定
};

function isHumanControlled(player) {
    return player.controllerType === CONTROLLER_TYPES.HUMAN;
}

// 手番プレイヤーの操作主体に応じて処理を振り分ける
function runControllerTurn(player) {
    switch (player.controllerType) {
        case CONTROLLER_TYPES.AI:
            runAiTurn(player);
            break;
        case CONTROLLER_TYPES.NETWORK:
            runNetworkTurn(player);
            break;
        case CONTROLLER_TYPES.HUMAN:
        default:
            // 人間の操作を待つ（手札ボタン・ターンエンドボタンから続行）
            break;
    }
}

// --- AI操作 ---
// 自分のターン中：使えるマジックを優先度順に使い切り、出せるならトラップを1枚セットして終了する。
// （相手＝人間側のトラップ発動・無効化選択は、それとは別に chain_system.js が行動のたびに判定している）
function runAiTurn(player) {
    if (gameOver) return;
    setTimeout(() => aiPlayTurn(player), 600);
}

async function aiPlayTurn(player) {
    if (gameOver) return;

    // エリアはコスト上限を全部使う大きな投資なので、そのターンの他の行動より先に判断する
    playAiAreaCard(player);
    if (gameOver) return;

    await playAllAffordableAiMagic(player);
    if (gameOver) return;

    playAiMaterialsAndKey(player);
    if (gameOver) return;

    await playAiAbility(player);
    if (gameOver) return;

    const trapIndex = player.hand.findIndex(id => cardDatabase[id] && cardDatabase[id].type === 'カウンタースペル');
    const hasEmptySlot = player.traps.includes(null);
    if (trapIndex !== -1 && hasEmptySlot && player.trapSealedTurns === 0) {
        setTrapFromHand(trapIndex);
    }

    updateDisplay(`${getPlayerLabel(player)}（AI）のターンを終了します。`);
    setTimeout(() => endTurn(), 500);
}

// エリアカードを持っていて、コストが上限に達していて、まだ何も展開していなければ発動する簡易AI
function playAiAreaCard(player) {
    if (player.activeArea) return;
    if (player.maxOd <= 0 || player.od !== player.maxOd) return;
    const areaIndex = player.hand.findIndex(id => cardDatabase[id] && cardDatabase[id].type === 'エリア');
    if (areaIndex !== -1) activateAreaCard(areaIndex);
}

// 手札にある自分のキャラクター用の素材カードを使い切り、条件を満たしていればキーカードで覚醒する
function playAiMaterialsAndKey(player) {
    let progressed = true;
    let safety = 0;
    while (progressed && safety < 10) {
        progressed = false;
        safety++;

        const matIndex = player.hand.findIndex(id => {
            const c = cardDatabase[id];
            return c && c.type === '素材' && c.parentCharacterId === player.currentCard &&
                c.cost <= player.od && !player.usedMaterials.includes(id);
        });
        if (matIndex !== -1) {
            useMaterialCard(matIndex);
            progressed = true;
            continue;
        }

        const keyIndex = player.hand.findIndex(id => {
            const c = cardDatabase[id];
            if (!c || c.type !== 'キー' || c.parentCharacterId !== player.currentCard || c.cost > player.od) return false;
            return (c.materials || []).every(matId => player.usedMaterials.includes(matId));
        });
        if (keyIndex !== -1) {
            useKeyCard(keyIndex);
            progressed = true;
        }
    }
}

// 使えるキャラクター能力（アクティブ・コスト以内・今ターン未使用）があれば1つ使う
async function playAiAbility(player) {
    if (player.abilitySealedTurns > 0) return;
    const baseCard = cardDatabase[player.currentCard];
    if (!baseCard || !baseCard.abilities) return;

    player.usedAbilitiesThisTurn = player.usedAbilitiesThisTurn || {};

    const index = baseCard.abilities.findIndex(a =>
        a.type === 'active' && getAbilityCostToPay(player, a) <= player.od && !player.usedAbilitiesThisTurn[a.abilityId]
    );
    if (index === -1) return;

    const ability = baseCard.abilities[index];
    payCost(player, getAbilityCostToPay(player, ability));
    player.usedAbilitiesThisTurn[ability.abilityId] = true;
    updateDisplay(`💫 ${getPlayerLabel(player)}（AI）が能力発動：${ability.text}`);

    const defender = (player === myPlayer) ? opponent : myPlayer;
    await applyCardEffect(ability.effectId, ability.params, player, defender);
    await checkTrapTriggers('opponentUsesAbility', defender, player);
    refreshFieldDisplay(player);
    refreshAbilityDisplay();
}

async function playAllAffordableAiMagic(player) {
    let played = true;
    let safety = 0; // 無限ループ防止
    while (played && safety < 20) {
        played = false;
        safety++;
        const index = findBestAiMagicIndex(player);
        if (index !== -1) {
            await useMagic(index);
            played = true;
        }
    }
}

// ダメージ系を優先し、その中では最もコストが高い（強力な）ものを選ぶ簡易評価
function findBestAiMagicIndex(player) {
    let bestIndex = -1;
    let bestScore = -1;

    player.hand.forEach((cardId, idx) => {
        const card = cardDatabase[cardId];
        if (!card || card.type !== 'スペル') return;
        if (getSpellCostToPay(player, card) > player.od) return;

        const isDamage = ['DAMAGE_ALL_ENEMY', 'PIERCE_DAMAGE', 'UNBLOCKABLE_DAMAGE', 'RANDOM_BURST', 'LIFESTEAL_DAMAGE', 'SELF_DAMAGE_BURST'].includes(card.effectId);
        const score = (isDamage ? 100 : 0) + card.cost;

        if (score > bestScore) {
            bestScore = score;
            bestIndex = idx;
        }
    });

    return bestIndex;
}

// --- ネットワーク対戦用（未実装・項目のみ用意） ---
function runNetworkTurn(player) {
    // TODO: サーバー/DBから相手の行動を受信して同期する処理を実装する
    updateDisplay('（ネットワーク対戦は未実装です）');
}

function sendActionToServer(action) {
    // TODO: 自分の行動（マジック使用・トラップセット・ターンエンド等）をサーバーに送信する
}

function receiveActionFromServer() {
    // TODO: サーバーから相手の行動を受信してゲーム状態に反映する
}

function connectToNetworkSession(sessionId, playerId) {
    // TODO: サーバー/DBに接続し、対戦セッションに参加する処理を実装する
}
