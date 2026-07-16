// effects.js - マジック・トラップ・キャラクター能力の効果解決（effectId + params を元に実行）
//
// 対象を選ぶ必要がある効果（トラップの破壊・公開など）は、発動した側（self）が人間操作なら
// pickTrapTargets() 経由でタップ選択させる。AI操作の場合は先頭から自動で選ぶ（従来の挙動）。

async function applyCardEffect(effectId, params, self, opponent) {
    switch (effectId) {
        case 'DRAW_N':
            await drawCard(self, params.n);
            updateHandDisplay();
            break;

        case 'DAMAGE_ALL_ENEMY':
            await dealDamageTo(opponent, params.amount, self);
            break;

        case 'HEAL':
            healPlayer(self, params.amount);
            break;

        case 'OD_BOOST': {
            playSE('odBoost');
            const before = self.od;
            self.od = Math.min(self.maxOd, self.od + params.amount);
            const actualGain = self.od - before;
            const cappedNote = actualGain < params.amount ? '（上限のため一部無効）' : '';
            updateDisplay(`コストが${actualGain}回復した：${before}→${self.od}${cappedNote}`);
            refreshFieldDisplay(self);
            break;
        }

        case 'DISCARD_OPPONENT':
            await discardCardsFromHand(opponent, params.n);
            break;

        case 'SEAL_TRAP':
            playSE('seal');
            opponent.trapSealedTurns = (opponent.trapSealedTurns || 0) + params.duration;
            updateDisplay(`相手のカウンタースペルが${params.duration}ターン封印された。`);
            break;

        case 'SEAL_ABILITY':
            playSE('seal');
            opponent.abilitySealedTurns = (opponent.abilitySealedTurns || 0) + params.duration;
            updateDisplay(`相手のキャラクター能力が${params.duration}ターン封印された。`);
            break;

        case 'REVEAL_TRAP': {
            // 公開対象は「まだ伏せられているカウンタースペル」のみを選択候補にする
            const indices = await pickTrapTargets(
                self, opponent, params.n,
                '公開するカウンタースペルを選択',
                (cardId, i) => !!cardId && !opponent.trapsRevealed[i]
            );
            revealTrapsAt(opponent, indices);
            break;
        }

        case 'FETCH_FROM_DECK':
            await fetchFromDeckChoice(self, params.n, params.types);
            break;

        case 'DESTROY_TRAP': {
            const indices = await pickTrapTargets(self, opponent, params.n, '破壊するカウンタースペルを選択');
            destroyTrapsAt(opponent, indices);
            break;
        }

        case 'REDUCE_DAMAGE':
            self.damageReduction = (self.damageReduction || 0) + params.amount;
            updateDisplay(`次に受けるダメージが${params.amount}軽減される。`);
            break;

        case 'OD_DRAIN':
            opponent.od = Math.max(0, opponent.od - params.amount);
            updateDisplay(`相手のコストが${params.amount}減少した。`);
            refreshFieldDisplay(opponent);
            break;

        case 'REFLECT_SHIELD':
            self.reflectShield = (self.reflectShield || 0) + params.uses;
            updateDisplay(`破壊を${params.uses}回無効化する効果を得た。`);
            break;

        case 'NEGATE_MAGIC':
        case 'NEGATE_TRAP':
            updateDisplay(`（対象となるカードの発動がなかったため効果は不発だった）`);
            break;

        // --- ここから新規追加の効果 ---

        case 'STEAL_CARD': {
            playSE('steal');
            const n = params.n || 1;
            for (let i = 0; i < n; i++) {
                if (opponent.hand.length === 0) break;
                const idx = Math.floor(Math.random() * opponent.hand.length);
                const cardId = opponent.hand.splice(idx, 1)[0];
                self.hand.push(cardId);
                const c = cardDatabase[cardId];
                updateDisplay(`🃏 ${getPlayerLabel(self)}は${getPlayerLabel(opponent)}の「${c ? c.name : cardId}」を奪った！`);
            }
            updateHandDisplay();
            break;
        }

        case 'LIFESTEAL_DAMAGE': {
            await dealDamageTo(opponent, params.amount, self);
            const ratio = params.healRatio != null ? params.healRatio : 1;
            const healAmount = Math.floor(params.amount * ratio);
            if (healAmount > 0) healPlayer(self, healAmount);
            break;
        }

        case 'RANDOM_BURST': {
            let max = params.max;
            const area = getAreaPassive(self);
            if (area && area.effectId === 'RANDOM_BURST_BOOST_AURA') max += (area.params.amount || 0);
            const amount = Math.floor(Math.random() * (max - params.min + 1)) + params.min;
            updateDisplay(`🎲 ランダムダメージ判定：${amount}`);
            await dealDamageTo(opponent, amount, self);
            break;
        }

        case 'PIERCE_DAMAGE': {
            // 軽減(damageReduction)・反射(reflectShield)を無視する直接ダメージ
            const charId = opponent === myPlayer ? "my-character" : "opponent-character";
            const statusId = opponent === myPlayer ? "my-status" : "opponent-status";
            applyDamage(opponent, params.amount, charId, statusId);
            updateDisplay(`🗡️ 軽減・反射を貫通するダメージ！`);
            await checkTrapTriggers('selfTakesDamage', opponent, self);
            await checkTrapTriggers('opponentAttacks', opponent, self);
            break;
        }

        case 'UNBLOCKABLE_DAMAGE': {
            // 軽減・反射に加え、無効化の対象にもならない直接ダメージ
            // （呼び出し元は無効化チェーンを経由させずここへ直接効果を適用する想定）
            const charId = opponent === myPlayer ? "my-character" : "opponent-character";
            const statusId = opponent === myPlayer ? "my-status" : "opponent-status";
            applyDamage(opponent, params.amount, charId, statusId);
            updateDisplay(`💥 一切の防御を許さないダメージ！`);
            break;
        }

        case 'SELF_DAMAGE_BURST': {
            await dealDamageTo(opponent, params.amount, self);
            const charId = self === myPlayer ? "my-character" : "opponent-character";
            const statusId = self === myPlayer ? "my-status" : "opponent-status";
            applyDamage(self, params.selfDamage, charId, statusId);
            updateDisplay(`⚠️ 制御できない力の反動で、自分も${params.selfDamage}ダメージを受けた。`);
            await checkTrapTriggers('selfTakesDamage', self, null);
            break;
        }

        // DISCOUNT_SPELL_COST / FREE_TRAP_COST / ABILITY_DISCOUNT_AURA / DAMAGE_BOOST_AURA /
        // LIFESTEAL_AURA / EXTRA_DRAW_AURA / GRAVEYARD_RECOVERY_AURA / RANDOM_BURST_BOOST_AURA は
        // 常時効果（passive／エリアのオーラ）としてのみ使われ、ここでは発動しない
        // （turn_engine.jsのgetTrapCostToPay / getSpellCostToPay / getAbilityCostToPay、
        // 　および本ファイルのdealDamageTo・startTurn側で直接参照している）

        // --- ここからキャラクター能力専用の効果 ---
        case 'RECOVER_RANDOM_MAGIC':
            recoverRandomMagic(self, params.n);
            break;

        case 'DRAW_TRAP_FROM_DECK':
            drawTrapFromDeck(self, params.n);
            break;

        case 'DISCARD_THEN_DRAW':
            // カード効果「相手の手札を1枚捨てさせ、1枚ドローする」：
            // 捨てるのは相手（対象）、ドローするのは発動者（self）。
            await discardCardsFromHand(opponent, params.n);
            await drawCard(self, params.n);
            break;

        case 'DISCARD_CHOICE':
            await discardChoice(self, opponent, params.n);
            break;

        default:
            updateDisplay(`（${effectId} の効果は未実装です）`);
    }

    updateTrapDisplay();
    updateBattleDeckCounts();
    updateGraveyardDisplay(myPlayer);
    updateGraveyardDisplay(opponent);
}

// トラップを対象に取る効果の共通ヘルパー。
// chooser（発動した側）が人間操作なら対象選択UIを、AI操作なら自動選択（先頭からn件）を行う。
// filterFn(cardId, index) を渡すと選択候補を絞り込める（省略時は「置かれているもの全て」）。
async function pickTrapTargets(chooser, targetPlayer, n, message, filterFn) {
    if (!n || n <= 0) return [];

    if (isHumanControlled(chooser)) {
        return await beginTrapTargetSelection(targetPlayer, n, message, filterFn);
    }

    const filter = filterFn || ((cardId) => !!cardId);
    const indices = [];
    for (let i = 0; i < targetPlayer.traps.length && indices.length < n; i++) {
        if (filter(targetPlayer.traps[i], i)) indices.push(i);
    }
    return indices;
}

// attacker: このダメージを発生させた側（反撃・被弾トリガーの判定や、エリアのオーラ効果の参照に使う。省略可）
async function dealDamageTo(player, amount, attacker) {
    let dmg = amount;

    // エリアのオーラ：DAMAGE_BOOST_AURA（自分が与えるダメージを底上げする）
    if (attacker) {
        const atkArea = getAreaPassive(attacker);
        if (atkArea && atkArea.effectId === 'DAMAGE_BOOST_AURA') {
            dmg += (atkArea.params.amount || 0);
        }
    }

    if (player.damageReduction) {
        const reduced = Math.min(player.damageReduction, dmg);
        dmg -= reduced;
        player.damageReduction = 0;
        updateDisplay(`ダメージ軽減効果で${reduced}軽減！`);
    }
    const charId = player === myPlayer ? "my-character" : "opponent-character";
    const statusId = player === myPlayer ? "my-status" : "opponent-status";
    applyDamage(player, dmg, charId, statusId);

    if (attacker) {
        // エリアのオーラ：LIFESTEAL_AURA（実際に与えたダメージの一部を自分の回復に変える）
        const atkArea = getAreaPassive(attacker);
        if (atkArea && atkArea.effectId === 'LIFESTEAL_AURA' && dmg > 0) {
            const healAmount = Math.floor(dmg * (atkArea.params.ratio || 0));
            if (healAmount > 0) healPlayer(attacker, healAmount);
        }

        // 「相手の攻撃を受けた時」に反応するトラップ（反撃・被弾回復）をここでまとめて判定する
        await checkTrapTriggers('selfTakesDamage', player, attacker);
        await checkTrapTriggers('opponentAttacks', player, attacker);
    }
}

function healPlayer(player, amount) {
    player.hp = Math.min(player.maxHp, player.hp + amount);
    playSE('heal');
    updateDisplay(`HPが${amount}回復した。`);
    refreshFieldDisplay(player);
}

function discardRandom(player, n) {
    const label = getPlayerLabel(player);
    for (let i = 0; i < n; i++) {
        if (player.hand.length === 0) break;
        const idx = Math.floor(Math.random() * player.hand.length);
        const cardId = player.hand.splice(idx, 1)[0];
        player.graveyard.push(cardId);
        const card = cardDatabase[cardId];
        updateDisplay(`${label}は${card ? card.name : cardId}を捨てた。`);
    }
    updateHandDisplay();
}

// 「相手か自分の手札の任意のカードを選び捨てる」を実現する版。
// caster: 能力の発動者（この効果でいう「自分」） / defender: もう片方のプレイヤー（「相手」の手札も対象にできる）
// 人間操作なら、自分・相手どちらの手札のカードでも一覧から選んで捨てられる。
// AI操作の場合は簡易AIのまま：自分の手札からランダムに捨てる（相手の手札を狙う判断はしない）。
async function discardChoice(caster, defender, n) {
    if (!n || n <= 0) return;

    if (!isHumanControlled(caster)) {
        discardRandom(caster, n);
        return;
    }

    const casterHasCards = caster.hand.length > 0;
    const defenderHasCards = !!defender && defender.hand.length > 0;
    if (!casterHasCards && !defenderHasCards) return;

    const buildCounts = (player) => {
        const counts = {};
        player.hand.forEach(cardId => { counts[cardId] = (counts[cardId] || 0) + 1; });
        return counts;
    };

    const items = [];
    Object.entries(buildCounts(caster)).forEach(([cardId, max]) => {
        const c = cardDatabase[cardId];
        items.push({ id: `self:${cardId}`, label: `【自分】${c ? `${c.name}[${c.type}]` : cardId}`, max });
    });
    if (defender) {
        Object.entries(buildCounts(defender)).forEach(([cardId, max]) => {
            const c = cardDatabase[cardId];
            items.push({ id: `opp:${cardId}`, label: `【相手】${c ? `${c.name}[${c.type}]` : cardId}`, max });
        });
    }

    const selected = await beginListSelection(items, n, '捨てさせるカードを選択（自分・相手どちらの手札からでも可）');

    Object.entries(selected).forEach(([key, count]) => {
        const sep = key.indexOf(':');
        const owner = key.slice(0, sep);
        const cardId = key.slice(sep + 1);
        const targetPlayer = owner === 'self' ? caster : defender;
        if (!targetPlayer) return;

        for (let i = 0; i < count; i++) {
            const idx = targetPlayer.hand.indexOf(cardId);
            if (idx === -1) continue;
            targetPlayer.hand.splice(idx, 1);
            targetPlayer.graveyard.push(cardId);
            const c = cardDatabase[cardId];
            updateDisplay(`${getPlayerLabel(targetPlayer)}は${c ? c.name : cardId}を捨てた。`);
        }
    });

    updateHandDisplay();
    updateGraveyardDisplay(caster);
    if (defender) updateGraveyardDisplay(defender);
}

// 指定したスロット番号のトラップをまとめて公開する
function revealTrapsAt(player, indices) {
    indices.forEach(i => {
        if (!player.traps[i] || player.trapsRevealed[i]) return;
        player.trapsRevealed[i] = true;
        const card = cardDatabase[player.traps[i]];
        updateDisplay(`トラップが公開された：${card ? card.name : player.traps[i]}`);
    });
}

// 山札から手札に加えるカードを選ぶ（人間操作なら選択UI、AIならランダムに自動で選ぶ）
// types が指定されていれば、その種類のカードだけが対象になる（EX003の能力などで使用）
async function fetchFromDeckChoice(player, n, types) {
    if (!n || n <= 0) return;
    const label = getPlayerLabel(player);

    const matches = (cardId) => {
        if (!types) return true;
        const c = cardDatabase[cardId];
        return c && types.includes(c.type);
    };

    if (!player.deck.some(matches)) {
        updateDisplay(`${label}の山札に対象となるカードがなかった。`);
        return;
    }

    let selected; // { cardId: 選んだ枚数 }

    if (isHumanControlled(player)) {
        // デッキ内の対象カードを種類ごとにまとめ、+/−で選べるようにする
        const counts = {};
        player.deck.forEach(cardId => {
            if (matches(cardId)) counts[cardId] = (counts[cardId] || 0) + 1;
        });
        const items = Object.entries(counts).map(([cardId, max]) => {
            const c = cardDatabase[cardId];
            return { id: cardId, label: c ? `[${c.type}] ${c.name}（コスト${c.cost}）` : cardId, max };
        });
        selected = await beginListSelection(items, n, '山札から手札に加えるカードを選択');
    } else {
        // AI/自動：対象からランダムにn枚選ぶ
        const pool = player.deck.filter(matches);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        selected = {};
        pool.slice(0, n).forEach(cardId => {
            selected[cardId] = (selected[cardId] || 0) + 1;
        });
    }

    Object.entries(selected).forEach(([cardId, count]) => {
        for (let i = 0; i < count; i++) {
            const idx = player.deck.indexOf(cardId);
            if (idx === -1) continue;
            player.deck.splice(idx, 1);
            player.hand.push(cardId);
            const c = cardDatabase[cardId];
            updateDisplay(`${label}は山札から${c ? c.name : cardId}を手札に加えた。`);
        }
    });

    updateHandDisplay();
    updateBattleDeckCounts();
}

// 指定したスロット番号のトラップをまとめて破壊する
function destroyTrapsAt(player, indices) {
    indices.forEach(i => {
        if (!player.traps[i]) return;
        const card = cardDatabase[player.traps[i]];
        updateDisplay(`トラップを破壊した：${card ? card.name : player.traps[i]}`);
        player.graveyard.push(player.traps[i]);
        player.traps[i] = null;
        player.trapsRevealed[i] = false;
    });
}

function recoverRandomMagic(player, n) {
    const label = getPlayerLabel(player);
    for (let i = 0; i < n; i++) {
        const magicIds = player.graveyard.filter(id => cardDatabase[id] && cardDatabase[id].type === 'スペル');
        if (magicIds.length === 0) break;
        const cardId = magicIds[Math.floor(Math.random() * magicIds.length)];
        const gIdx = player.graveyard.indexOf(cardId);
        player.graveyard.splice(gIdx, 1);
        player.hand.push(cardId);
        updateDisplay(`${label}は墓地から${cardDatabase[cardId].name}を回収した。`);
    }
    updateHandDisplay();
}

function drawTrapFromDeck(player, n) {
    const label = getPlayerLabel(player);
    let moved = 0;
    for (let i = 0; i < player.deck.length && moved < n; i++) {
        const card = cardDatabase[player.deck[i]];
        if (card && card.type === 'カウンタースペル') {
            const cardId = player.deck.splice(i, 1)[0];
            player.hand.push(cardId);
            updateDisplay(`${label}は山札からカウンタースペル「${card.name}」をドローした。`);
            moved++;
            i--;
        }
    }
    updateHandDisplay();
    updateBattleDeckCounts();
}

// 強制的な手札破棄（対象は既に決まっている）で、「どのカードを捨てるか」を対象プレイヤー自身に選ばせる版。
// 人間操作なら選択UIで自分の手札から選べる、AI操作の場合は従来通りランダムに捨てる（簡易AI）。
async function discardCardsFromHand(player, n) {
    if (!n || n <= 0) return;
    if (player.hand.length === 0) return;

    if (!isHumanControlled(player)) {
        discardRandom(player, n);
        return;
    }

    await ensureViewerIsPlayer(player); // ローカル2人対戦：捨てる本人に端末を渡す

    const label = getPlayerLabel(player);
    const counts = {};
    player.hand.forEach(cardId => { counts[cardId] = (counts[cardId] || 0) + 1; });
    const items = Object.entries(counts).map(([cardId, max]) => {
        const c = cardDatabase[cardId];
        return { id: cardId, label: c ? `${c.name}[${c.type}]` : cardId, max };
    });

    const selected = await beginListSelection(items, n, `${label}の手札から捨てるカードを選択`);

    await returnViewerToActivePlayer(player); // 手番のプレイヤーに端末を返す

    Object.entries(selected).forEach(([cardId, count]) => {
        for (let i = 0; i < count; i++) {
            const idx = player.hand.indexOf(cardId);
            if (idx === -1) continue;
            player.hand.splice(idx, 1);
            player.graveyard.push(cardId);
            const c = cardDatabase[cardId];
            updateDisplay(`${label}は${c ? c.name : cardId}を捨てた。`);
        }
    });

    updateHandDisplay();
}
