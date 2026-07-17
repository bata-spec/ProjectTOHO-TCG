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
    setTimeout(() => {
        endTurn().catch(e => {
            updateDisplay(`<span style="color:red">⚠️ ERROR: AIのターン終了処理で例外：${e && e.message ? e.message : e}</span>`);
        });
    }, 500);
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
            if (aiDifficulty === 'easy' && Math.random() < 0.4) {
                // 弱いAIは、覚醒条件が揃っていてもたまに覚醒を見逃す
                continue;
            }
            useKeyCard(keyIndex);
            progressed = true;
        }
    }
}

// 使えるキャラクター能力（アクティブ・コスト以内・今ターン未使用）があれば1つ使う。
// 弱いAIはたまにサボり、強いAIはとどめが刺せる能力を優先する。
async function playAiAbility(player) {
    if (player.abilitySealedTurns > 0) return;
    const baseCard = cardDatabase[player.currentCard];
    if (!baseCard || !baseCard.abilities) return;

    player.usedAbilitiesThisTurn = player.usedAbilitiesThisTurn || {};

    const usable = baseCard.abilities.filter(a =>
        a.type === 'active' && getAbilityCostToPay(player, a) <= player.od && !player.usedAbilitiesThisTurn[a.abilityId]
    );
    if (usable.length === 0) return;

    if (aiDifficulty === 'easy' && Math.random() < 0.35) return; // 弱いAIは使える能力があってもたまにサボる

    const defender = (player === myPlayer) ? opponent : myPlayer;
    let ability = usable[0];
    if (aiDifficulty === 'hard') {
        const lethal = usable.find(a => estimateDamageAmount(a) >= defender.hp);
        if (lethal) ability = lethal;
    }

    payCost(player, getAbilityCostToPay(player, ability));
    player.usedAbilitiesThisTurn[ability.abilityId] = true;
    updateDisplay(`💫 ${getPlayerLabel(player)}（AI）が能力発動：${ability.text}`);

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

// カード/能力オブジェクトの効果パラメータから、与えるダメージのおおよその量を見積もる
// （とどめが刺せるかどうかの判定に使う。ダメージ系でなければ0）
function estimateDamageAmount(cardLike) {
    const p = cardLike.params || {};
    switch (cardLike.effectId) {
        case 'DAMAGE_ALL_ENEMY':
        case 'PIERCE_DAMAGE':
        case 'UNBLOCKABLE_DAMAGE':
        case 'LIFESTEAL_DAMAGE':
        case 'SELF_DAMAGE_BURST':
            return p.amount || 0;
        case 'RANDOM_BURST':
            return p.max || 0; // 最大値で判定（届く可能性があるなら狙いにいく）
        default:
            return 0;
    }
}

// ダメージ系を優先し、その中では最もコストが高い（強力な）ものを選ぶ簡易評価。
// 難易度によって判断の質を変える：
// ・弱い　　：優先度を考えず、使えるカードからランダムに選ぶ
// ・普通　　：ダメージ系を優先する簡易評価（元の挙動）
// ・強い　　：上記に加えて「とどめが刺せるなら最優先」「コストが余ってるのにOD回復は使わない」を考慮する
function findBestAiMagicIndex(player) {
    const opponentPlayer = (player === myPlayer) ? opponent : myPlayer;

    const affordable = [];
    player.hand.forEach((cardId, idx) => {
        const card = cardDatabase[cardId];
        if (!card || card.type !== 'スペル') return;
        if (getSpellCostToPay(player, card) > player.od) return;
        affordable.push({ idx, card });
    });
    if (affordable.length === 0) return -1;

    if (aiDifficulty === 'easy') {
        const pick = affordable[Math.floor(Math.random() * affordable.length)];
        return pick.idx;
    }

    if (aiDifficulty === 'hard') {
        const lethal = affordable.find(({ card }) => estimateDamageAmount(card) >= opponentPlayer.hp);
        if (lethal) return lethal.idx;
    }

    let bestIndex = -1;
    let bestScore = -1;
    affordable.forEach(({ idx, card }) => {
        const isDamage = ['DAMAGE_ALL_ENEMY', 'PIERCE_DAMAGE', 'UNBLOCKABLE_DAMAGE', 'RANDOM_BURST', 'LIFESTEAL_DAMAGE', 'SELF_DAMAGE_BURST'].includes(card.effectId);
        let score = (isDamage ? 100 : 0) + card.cost;

        if (aiDifficulty === 'hard') {
            // オドがそれなりに残っているのにOD回復を使うのは無駄なので優先度を下げる
            if (card.effectId === 'OD_BOOST' && player.od >= player.maxOd * 0.6) score -= 50;
            // 手札破壊は、相手の手札が多いほど価値が上がる
            if (card.effectId === 'DISCARD_OPPONENT') score += Math.min(opponentPlayer.hand.length, 5);
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndex = idx;
        }
    });

    return bestIndex;
}

// --- ネットワーク対戦 ---
// このデバイスから見て「相手（controllerType: network）」の番になった時に呼ばれる。
// 実際の操作は相手の端末で行われ、Firebase経由で状態が同期されてくるのを待つだけでよいので、
// ここでは何もしない（ボタン類は isHumanControlled() のチェックにより自動的に操作不可になる）。
function runNetworkTurn(player) {
    // 何もしない：相手の端末からの同期を待つ
}
