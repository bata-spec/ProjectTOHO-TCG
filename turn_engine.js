// turn_engine.js - ターン進行の管理、マジック/トラップの使用処理、場のトラップ表示、能力表示

function getActivePlayer() {
    return currentTurnPlayer === 'me' ? myPlayer : opponent;
}
function getDefendingPlayer() {
    return currentTurnPlayer === 'me' ? opponent : myPlayer;
}

function payCost(player, cost) {
    player.od = Math.max(0, player.od - cost);
}

// --- 常時効果（キャラクターのpassive能力／エリアのオーラ）を横断で参照するためのヘルパー ---

// 場に出ているキャラクターが、指定effectIdのpassive能力を持っていればそれを返す
function getCharacterPassive(player, effectId) {
    const baseCard = cardDatabase[player.currentCard];
    if (!baseCard || !baseCard.abilities) return null;
    return baseCard.abilities.find(a => a.type === 'passive' && a.effectId === effectId) || null;
}

// 展開中のエリアカードのオーラ効果（{effectId, params}）を返す。展開していなければnull
function getAreaPassive(player) {
    if (!player.activeArea) return null;
    const areaCard = cardDatabase[player.activeArea];
    return (areaCard && areaCard.passiveEffect) || null;
}

// 場に出ているキャラクターの受動能力(FREE_TRAP_COST)、およびエリアの同種オーラにより、
// カウンタースペルの発動コストが0になるか判定する
function getTrapCostToPay(player, card) {
    const rankOrder = ["I", "II", "III", "IV", "V"];
    const rankIndex = rankOrder.indexOf(card.rank) + 1;

    const charPassive = getCharacterPassive(player, 'FREE_TRAP_COST');
    if (charPassive && rankIndex > 0 && rankIndex <= charPassive.params.maxRank) return 0;

    const area = getAreaPassive(player);
    if (area && area.effectId === 'FREE_TRAP_COST' && rankIndex > 0 && rankIndex <= area.params.maxRank) return 0;

    return card.cost;
}

// キャラクター能力(DISCOUNT_SPELL_COST)、およびエリアの同種オーラにより、
// スペルの発動コストが割引されるか判定する（ランク指定範囲内のみ）
function getSpellCostToPay(player, card) {
    const rankOrder = ["I", "II", "III", "IV", "V"];
    const rankIndex = rankOrder.indexOf(card.rank) + 1;
    let discount = 0;

    const charPassive = getCharacterPassive(player, 'DISCOUNT_SPELL_COST');
    if (charPassive && rankIndex > 0 && rankIndex <= charPassive.params.maxRank) {
        discount += charPassive.params.discount;
    }

    const area = getAreaPassive(player);
    if (area && area.effectId === 'DISCOUNT_SPELL_COST' && rankIndex > 0 && rankIndex <= area.params.maxRank) {
        discount += area.params.discount;
    }

    return Math.max(0, card.cost - discount);
}

// エリアの ABILITY_DISCOUNT_AURA により、キャラクター能力の発動コストが割引されるか判定する
function getAbilityCostToPay(player, ability) {
    let discount = 0;
    const area = getAreaPassive(player);
    if (area && area.effectId === 'ABILITY_DISCOUNT_AURA') {
        discount += area.params.amount;
    }
    return Math.max(0, ability.cost - discount);
}

async function drawCard(player, n) {
    playSE('draw');
    const other = (player === myPlayer) ? opponent : myPlayer;
    const otherBase = cardDatabase[other.currentCard];
    const replaceAbility = otherBase && otherBase.abilities && otherBase.abilities.find(a =>
        a.type === 'triggered' && a.trigger === 'opponentDraws' && a.effectId === 'REPLACE_DRAW_WITH_DISCARD'
    );

    let drewAny = false;
    for (let i = 0; i < n; i++) {
        if (gameOver) return;

        if (replaceAbility) {
            updateDisplay(`🌀 ${getPlayerLabel(other)}の「${otherBase.name}」の能力：${getPlayerLabel(player)}はドローの代わりに手札を1枚捨てる。`);
            await discardCardsFromHand(player, 1);
            drewAny = true;
            continue;
        }

        if (player.deck.length === 0) {
            endGame(player, '山札切れ');
            return;
        }
        const cardId = player.deck.shift();
        player.hand.push(cardId);
        drewAny = true;
    }

    if (drewAny) await checkTrapTriggers('opponentDraws', other, player);
}

async function startTurn() {
    if (gameOver) return;
    turnCount++;
    const player = getActivePlayer();

    // ネット対戦で「相手」の番になった場合、実際の処理は相手の端末側が行い、
    // こちらにはFirebase経由で結果が同期されてくる。ここでは何もせず待つだけにする
    // （でないと、こちらの手元にある不正確な相手情報でドロー等を行ってしまい、
    // 　相手の端末の本物の状態と食い違ってしまう）。
    if (player.controllerType === CONTROLLER_TYPES.NETWORK) {
        turnCount--; // 実際のターン数は同期されてくる値を使うので、ここでは進めない
        updateTurnIndicator();
        maybeSyncNetworkState(); // 「あなたの番になりました」を相手の端末に伝える
        runControllerTurn(player);
        return;
    }

    player.od = player.maxOd;
    player.usedAbilitiesThisTurn = {}; // 能力の「1ターンに1回」制限を、自分の手番開始時にリセット
    if (player.trapSealedTurns > 0) player.trapSealedTurns--;
    if (player.abilitySealedTurns > 0) player.abilitySealedTurns--;
    refreshFieldDisplay(player); // コストを回復した直後、画面にすぐ反映させる

    if (player.firstTurnTaken) {
        await drawCard(player, 1);
        if (gameOver) return;

        const area = getAreaPassive(player);
        if (area && area.effectId === 'EXTRA_DRAW_AURA') {
            await drawCard(player, area.params.amount || 1);
            if (gameOver) return;
        }
        if (area && area.effectId === 'GRAVEYARD_RECOVERY_AURA') {
            recoverRandomMagic(player, area.params.amount || 1);
        }
    } else {
        player.firstTurnTaken = true;
        updateDisplay(`${getPlayerLabel(player)}は初期手札5枚からスタート（このターンはドローなし）`);
    }

    updateTurnIndicator();
    updateHandDisplay();
    updateBattleDeckCounts();
    refreshAbilityDisplay();

    updateDisplay(`--- ${turnCount}ターン目：${getPlayerLabel(player)}の番 ---`);

    maybeSyncNetworkState();
    runControllerTurn(player);
}

async function endTurn() {
    if (gameOver) return;
    if (!isHumanControlled(getActivePlayer())) return; // 自分の番でない時に誤って押しても無視する
    playSE('turnEnd');
    currentTurnPlayer = (currentTurnPlayer === 'me') ? 'opponent' : 'me';

    if (gameMode === 'local2p') {
        await showPassScreen(
            `${getPlayerLabel(getActivePlayer())}に端末を渡してください`,
            `${getPlayerLabel(getActivePlayer())}が準備できたらタップ`
        );
    }

    await startTurn();
}

function handleHandCardClick(index) {
    if (gameOver) return;
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    if (!card) return;

    if (card.type === 'スペル') {
        useMagic(index);
    } else if (card.type === 'カウンタースペル') {
        setTrapFromHand(index);
    } else if (card.type === '素材') {
        useMaterialCard(index);
    } else if (card.type === 'キー') {
        useKeyCard(index);
    } else if (card.type === 'エリア') {
        activateAreaCard(index);
    } else {
        updateDisplay(`⚠️ ${card.name} はまだプレイ方法が実装されていません。`);
    }
}

async function useMagic(index) {
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    if (!card || card.type !== 'スペル') return;

    const costToPay = getSpellCostToPay(player, card);
    if (costToPay > player.od) {
        updateDisplay(`❌ コストが足りません（必要:${costToPay} / 所持:${player.od}）`);
        return;
    }

    payCost(player, costToPay);
    player.hand.splice(index, 1);
    player.graveyard.push(cardId);
    playSE('spell');
    updateDisplay(`✨ ${getPlayerLabel(player)}がスペル発動：${card.name}${costToPay !== card.cost ? `（割引済コスト${costToPay}）` : ''}`);

    const defender = getDefendingPlayer();
    const defenderBase = cardDatabase[defender.currentCard];
    const destroyAbility = defenderBase && defenderBase.abilities && defenderBase.abilities.find(a =>
        a.type === 'triggered' && a.trigger === 'opponentActivatesMagic' && a.effectId === 'REPLACE_MAGIC_WITH_DESTROY'
    );

    if (destroyAbility) {
        updateDisplay(`🌀 ${getPlayerLabel(defender)}の「${defenderBase.name}」の能力：${card.name}は効果を発動せず破壊された。`);
    } else {
        // 無効化（トラップ or キャラ能力）を使うか、防御側に選ばせる
        const negatingSource = await resolveNegateChoice(defender, 'opponentActivatesMagic', card, card.name, true);
        if (negatingSource) {
            // 2段階目：無効化の発動自体を、行動者側の無効化トラップでさらに打ち消せるか確認
            const counterSource = await resolveNegateChoice(player, 'opponentActivatesTrap', negatingSource, negatingSource.name, false);
            if (counterSource) {
                updateDisplay(`↩️ 「${negatingSource.name}」が「${counterSource.name}」でさらに無効化され、${card.name}の効果が発動する！`);
                await applyCardEffect(card.effectId, card.params, player, defender);
            } else {
                updateDisplay(`🚫 ${card.name} は無効化された！`);
            }
        } else {
            await applyCardEffect(card.effectId, card.params, player, defender);
        }
    }

    refreshFieldDisplay(player);
    updateHandDisplay();
    updateGraveyardDisplay(player);
    refreshAbilityDisplay();
    maybeSyncNetworkState();
}

function setTrapFromHand(index) {
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    if (!card || card.type !== 'カウンタースペル') return;

    if (player.trapSealedTurns > 0) {
        updateDisplay(`❌ 現在カウンタースペルは封印されていてセットできません。`);
        return;
    }

    const emptySlot = player.traps.findIndex(t => t === null);
    if (emptySlot === -1) {
        updateDisplay(`❌ カウンタースペルゾーンに空きがありません（最大${MAX_TRAPS}枚）`);
        return;
    }

    player.hand.splice(index, 1);
    player.traps[emptySlot] = cardId;
    player.trapsRevealed[emptySlot] = false;
    playSE('counterspellSet');
    updateDisplay(`🔒 ${getPlayerLabel(player)}がカウンタースペルをセットした。`);

    updateHandDisplay();
    updateTrapDisplay();
    maybeSyncNetworkState();
}

// --- 覚醒システム（素材カード・キーカード） ---

function useMaterialCard(index) {
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    if (!card || card.type !== '素材') return;

    if (card.cost > player.od) {
        updateDisplay(`❌ コストが足りません（必要:${card.cost} / 所持:${player.od}）`);
        return;
    }
    if (player.currentCard !== card.parentCharacterId) {
        updateDisplay(`❌ ${card.name} は今場に出ているキャラクターには使用できません。`);
        return;
    }
    if (player.usedMaterials.includes(cardId)) {
        updateDisplay(`⚠️ ${card.name} はすでに使用済みです。`);
        return;
    }

    payCost(player, card.cost);
    player.hand.splice(index, 1);
    player.graveyard.push(cardId);
    player.usedMaterials.push(cardId);

    updateDisplay(`🔹 ${getPlayerLabel(player)}が「${card.name}」を使用（覚醒の証：${player.usedMaterials.length}/3）`);

    refreshFieldDisplay(player);
    updateHandDisplay();
    updateGraveyardDisplay(player);
    refreshAbilityDisplay();
    maybeSyncNetworkState();
}

function useKeyCard(index) {
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    if (!card || card.type !== 'キー') return;

    if (card.cost > player.od) {
        updateDisplay(`❌ コストが足りません（必要:${card.cost} / 所持:${player.od}）`);
        return;
    }
    if (player.currentCard !== card.parentCharacterId) {
        updateDisplay(`❌ ${card.name} は今場に出ているキャラクターには使用できません。`);
        return;
    }

    const requiredMaterials = card.materials || [];
    const allReady = requiredMaterials.length > 0 &&
        requiredMaterials.every(matId => player.usedMaterials.includes(matId));

    if (!allReady) {
        const done = requiredMaterials.filter(matId => player.usedMaterials.includes(matId)).length;
        updateDisplay(`❌ 覚醒条件を満たしていません（証 ${done}/${requiredMaterials.length}）`);
        return;
    }

    payCost(player, card.cost);
    player.hand.splice(index, 1);
    player.graveyard.push(cardId);

    awakenCharacter(player, card.resultId);
    updateGraveyardDisplay(player);
    maybeSyncNetworkState();
}

function awakenCharacter(player, resultId) {
    const exCard = cardDatabase[resultId];
    if (!exCard) {
        updateDisplay(`❌ 覚醒先カード「${resultId}」が見つかりません`);
        return;
    }

    playSE('awaken');
    player.currentCard = resultId;
    player.hp = exCard.hp;
    player.maxHp = exCard.hp;
    player.od = exCard.od;
    player.maxOd = exCard.od;
    player.usedMaterials = [];
    player.characterNegateCharges = {};
    player.usedAbilitiesThisTurn = {}; // 覚醒したら能力構成が変わるため使用済み状態もリセット

    updateDisplay(`✨✨ ${getPlayerLabel(player)}のキャラクターが覚醒！「${exCard.name}」になった！`);

    refreshFieldDisplay(player);
    updateHandDisplay();
    refreshAbilityDisplay();
}

// --- エリアカード ---
// 発動条件：使用可能コスト(オド)が上限に達している時のみ、それを全て消費して発動できる。
// 発動後はコストの上限が増加する（オド＝キャラ本来の力 ＋ マナ＝場に展開した有利な地形、という上限の内訳が増える）。
// 発動すると、そのキャラのコンセプトに合ったオーラ効果が場に残り続ける（ゲーム中ずっと有効）。
// デッキに1枚までしか入れられないが、場のエリアは自分・相手それぞれ独立している。
// 自分がエリアを展開しても相手のエリアは消えないし、逆に相手が展開しても自分のエリアは消えない。
function activateAreaCard(index) {
    const player = getActivePlayer();
    const cardId = player.hand[index];
    const card = cardDatabase[cardId];
    if (!card || card.type !== 'エリア') return;

    if (player.activeArea) {
        const already = cardDatabase[player.activeArea];
        updateDisplay(`❌ すでにエリアを展開しています：「${already ? already.name : player.activeArea}」`);
        return;
    }
    if (player.maxOd <= 0 || player.od !== player.maxOd) {
        updateDisplay(`❌ エリアの発動には、使用可能コストが上限に達している必要があります（現在:${player.od}/${player.maxOd}）`);
        return;
    }

    player.od = 0; // 上限まで貯めたコストを全て消費して発動
    player.hand.splice(index, 1);
    player.activeArea = cardId;

    const maxOdBoost = (card.params && card.params.maxOdBoost) || 0;
    player.maxOd += maxOdBoost;

    playSE('areaActivate');
    updateDisplay(`🌌 ${getPlayerLabel(player)}がエリア展開：「${card.name}」！ コストの上限が${player.maxOd}に増加した（${card.text || ''}）`);

    refreshFieldDisplay(player);
    updateAreaDisplay();
    updateHandDisplay();
    refreshAbilityDisplay();
    maybeSyncNetworkState();
}

// 場のエリア表示（トラップゾーンと同様、1人1枠）
function renderAreaZone(player, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    if (!player.activeArea) {
        container.classList.add("area-slot-empty");
        return;
    }
    container.classList.remove("area-slot-empty");

    const card = cardDatabase[player.activeArea];
    const img = document.createElement("img");
    img.className = "area-art";
    setImageWithFallback(img, getCardArtPath(card));
    img.onclick = () => showCardDetail(player.activeArea);
    container.appendChild(img);

    const label = document.createElement("div");
    label.className = "area-label";
    label.innerText = card ? card.name : player.activeArea;
    container.appendChild(label);
}

function updateAreaDisplay() {
    renderAreaZone(myPlayer, "my-area-zone");
    renderAreaZone(opponent, "opponent-area-zone");
}

// --- キャラクター能力（① ②）の発動 ---
// 各能力は1ターンに1回まで。使用済みの能力はグレーアウトして再使用できないようにする。
// AI操作のキャラは参照用の一覧表示のみ（ボタンではない）。人間操作のキャラは、
// 自分の手番の時だけ押せるボタンとして表示する（シングルプレイ・ローカル2人対戦どちらにも対応）。

function renderCharacterAbilities(player, areaId) {
    const area = document.getElementById(areaId);
    if (!area) return;
    area.innerHTML = "";

    const baseCard = cardDatabase[player.currentCard];
    if (!baseCard || !baseCard.abilities) return;

    if (!isHumanControlled(player)) {
        area.classList.add("ability-area-readonly");
        const typeLabel = { active: '能力', triggered: '誘発', passive: '常時' };
        baseCard.abilities.forEach(ability => {
            const row = document.createElement("div");
            row.className = "ability-readonly-row";
            let text = `${typeLabel[ability.type] || ability.type}：${ability.text}`;
            if (ability.cost > 0) text += `（コスト${ability.cost}）`;
            row.innerText = text;
            area.appendChild(row);
        });
        return;
    }

    area.classList.remove("ability-area-readonly");
    const isPlayersTurn = getActivePlayer() === player;
    player.usedAbilitiesThisTurn = player.usedAbilitiesThisTurn || {};

    baseCard.abilities.forEach((ability, index) => {
        if (ability.type !== 'active') return; // passive/triggeredはボタン不要（自動判定）

        const used = !!player.usedAbilitiesThisTurn[ability.abilityId];
        const sealed = player.abilitySealedTurns > 0;
        const costToPay = getAbilityCostToPay(player, ability);
        const affordable = costToPay <= player.od;

        const btn = document.createElement("button");
        let label = `能力：${ability.text}${costToPay > 0 ? `（コスト${costToPay}）` : ''}`;
        if (used) label += "（使用済み）";
        else if (!isPlayersTurn) label += "（自分のターンのみ使用可）";
        btn.innerText = label;
        btn.disabled = used || sealed || !affordable || !isPlayersTurn;
        if (used) btn.classList.add("ability-used");
        btn.onclick = () => useCharacterAbility(player, index);
        area.appendChild(btn);
    });

    if (player.abilitySealedTurns > 0) {
        const notice = document.createElement("div");
        notice.innerText = `⚠️ キャラクター能力は封印中（残り${player.abilitySealedTurns}ターン）`;
        area.appendChild(notice);
    }
}

function refreshAbilityDisplay() {
    renderCharacterAbilities(myPlayer, 'my-ability-area');
    renderCharacterAbilities(opponent, 'opponent-ability-area');
}

async function useCharacterAbility(player, abilityIndex) {
    if (gameOver) return;
    if (!isHumanControlled(player) || player !== getActivePlayer()) return; // 使えるのは自分の手番の本人のみ

    if (player.abilitySealedTurns > 0) {
        updateDisplay(`❌ キャラクター能力は現在封印されています。`);
        return;
    }

    const baseCard = cardDatabase[player.currentCard];
    const ability = baseCard && baseCard.abilities && baseCard.abilities[abilityIndex];
    if (!ability || ability.type !== 'active') return;

    player.usedAbilitiesThisTurn = player.usedAbilitiesThisTurn || {};
    if (player.usedAbilitiesThisTurn[ability.abilityId]) {
        updateDisplay(`❌ この能力は今ターン既に使用済みです。`);
        return;
    }

    const costToPay = getAbilityCostToPay(player, ability);
    if (costToPay > player.od) {
        updateDisplay(`❌ コストが足りません（必要:${costToPay} / 所持:${player.od}）`);
        return;
    }

    payCost(player, costToPay);
    player.usedAbilitiesThisTurn[ability.abilityId] = true;
    playSE('ability');
    updateDisplay(`💫 ${getPlayerLabel(player)}が能力発動：${ability.text}`);

    const defender = (player === myPlayer) ? opponent : myPlayer;
    await applyCardEffect(ability.effectId, ability.params, player, defender);

    await checkTrapTriggers('opponentUsesAbility', defender, player);

    refreshFieldDisplay(player);
    refreshAbilityDisplay();
    maybeSyncNetworkState();
}

// --- 場の描画（デッキ枚数・トラップゾーン） ---

function updateBattleDeckCounts() {
    const myCount = document.getElementById('my-deck-count');
    const oppCount = document.getElementById('opponent-deck-count');
    if (myCount) myCount.innerText = `${myPlayer.deck.length}`;
    if (oppCount) oppCount.innerText = `${opponent.deck.length}`;

    const myArt = document.getElementById('my-deck-art');
    const oppArt = document.getElementById('opponent-deck-art');
    if (myArt) {
        myArt.style.visibility = myPlayer.deck.length > 0 ? 'visible' : 'hidden';
        setImageWithFallback(myArt, CARD_BACK_IMAGE);
    }
    if (oppArt) {
        oppArt.style.visibility = opponent.deck.length > 0 ? 'visible' : 'hidden';
        setImageWithFallback(oppArt, CARD_BACK_IMAGE);
    }
}

function renderTrapZone(player, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    // 対象選択モード中で、このゾーンが選択対象になっているかどうか
    const selecting = targetSelectionState && targetSelectionState.targetPlayer === player;

    for (let i = 0; i < player.traps.length; i++) {
        const slot = document.createElement("div");
        slot.className = "trap-slot";
        const cardId = player.traps[i];

        if (!cardId) {
            slot.classList.add("trap-slot-empty");
        } else {
            const img = document.createElement("img");
            img.className = "trap-art";
            const card = cardDatabase[cardId];
            const revealed = player.trapsRevealed[i];

            // シングルプレイ（vs AI）では自分の伏せカードは常に自分に見えていて良いが、
            // ローカル2人対戦では端末を渡し合うため、持ち主の手番の時だけ見せる
            // （そうしないと相手の手番中に画面を見ただけで中身が分かってしまう）。
            const showFace = revealed || (gameMode === 'local2p' ? player === getActivePlayer() : player === myPlayer);
            if (showFace) {
                setImageWithFallback(img, getCardArtPath(card));
            } else {
                setImageWithFallback(img, CARD_BACK_IMAGE);
            }
            slot.appendChild(img);

            if (selecting && targetSelectionState.candidateIndices.includes(i)) {
                slot.classList.add("trap-slot-selectable");
                if (targetSelectionState.selected.includes(i)) slot.classList.add("trap-slot-selected");
                slot.onclick = (e) => {
                    e.stopPropagation();
                    toggleTrapTargetSelect(i);
                };
            } else {
                img.onclick = () => showCardDetail(cardId);
            }
        }
        container.appendChild(slot);
    }
}

function updateTrapDisplay() {
    renderTrapZone(myPlayer, "my-trap-zone");
    renderTrapZone(opponent, "opponent-trap-zone");
}

function updateTurnIndicator() {
    const el = document.getElementById('turn-indicator');
    if (el) el.innerText = `ターン: ${turnCount} / 手番: ${getPlayerLabel(getActivePlayer())}`;
}
