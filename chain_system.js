// chain_system.js - トラップの発動条件監視・割り込み（チェーン）処理
//
// 対応している「多重反応」:
// 1段階目: 攻撃側の行動 → 防御側のトラップ（反応 or 無効化）が発動
// 2段階目: その防御側トラップの発動自体を、攻撃側の「無効化トラップ」でさらに打ち消せる
// （3段階目以降の無限連鎖には対応していない）
//
// 無効化（トラップ／キャラ能力）の判定は resolveNegateChoice に統一している。
// 操作者が人間の場合は候補が複数あってもランダムに決めず、どれを使うか
// （あるいは無効化しない）を選べるようにする。

// defender: トラップを持っている側 / attacker: トリガーを引き起こした側
async function checkTrapTriggers(triggerName, defender, attacker) {
    for (let i = 0; i < defender.traps.length; i++) {
        const cardId = defender.traps[i];
        if (!cardId) continue;
        const card = cardDatabase[cardId];
        if (!card || card.trigger !== triggerName) continue;
        // 無効化系トラップ自体は resolveNegateChoice 側の専用ルートで処理するので、ここでは対象外
        if (card.effectId === 'NEGATE_MAGIC' || card.effectId === 'NEGATE_TRAP') continue;

        // トラップの持ち主が人間の場合は、発動するかどうかを必ず確認する（強制発動にしない）。
        // AIの場合は従来通り、条件を満たしたら自動で発動する。
        if (isHumanControlled(defender)) {
            await ensureViewerIsPlayer(defender); // ローカル2人対戦：持ち主に端末を渡す
            const wantsToActivate = await showActionPrompt(
                `トラップ「${card.name}」の発動条件を満たしました。発動しますか？`,
                [
                    { label: `発動する：${card.name}`, value: true },
                    { label: '発動しない（伏せたままにする）', value: false }
                ]
            );
            await returnViewerToActivePlayer(defender); // 手番のプレイヤーに端末を返す
            if (!wantsToActivate) {
                updateDisplay(`（${getPlayerLabel(defender)}は「${card.name}」の発動を見送った）`);
                continue;
            }
        }

        // 2段階目：このトラップの発動自体を、攻撃側が無効化トラップで打ち消せないか確認
        // （キャラ能力による無効化はここでは対象外＝トラップ同士の応酬のみ、という元の仕様を踏襲）
        if (attacker) {
            const counterTrap = await resolveNegateChoice(attacker, 'opponentActivatesTrap', card, card.name, false);
            if (counterTrap) {
                updateDisplay(`🚫 ${getPlayerLabel(defender)}の「${card.name}」は${getPlayerLabel(attacker)}の「${counterTrap.name}」で無効化された！`);
                defender.traps[i] = null;
                defender.trapsRevealed[i] = false;
                defender.graveyard.push(cardId);
                updateTrapDisplay();
                updateGraveyardDisplay(defender);
                continue;
            }
        }

        await activateTrapAt(defender, i, attacker);
    }
}

async function activateTrapAt(defender, slotIndex, attacker) {
    const cardId = defender.traps[slotIndex];
    const card = cardDatabase[cardId];
    if (!card) return;

    const costToPay = getTrapCostToPay(defender, card);
    defender.od = Math.max(0, defender.od - costToPay);

    updateDisplay(`⚡ ${getPlayerLabel(defender)}のトラップ発動：${card.name}${costToPay === 0 ? '（コスト消費なし）' : ''}`);

    defender.traps[slotIndex] = null;
    defender.trapsRevealed[slotIndex] = false;
    defender.graveyard.push(cardId);

    await applyCardEffect(card.effectId, card.params, defender, attacker);

    refreshFieldDisplay(defender);
    updateTrapDisplay();
    updateGraveyardDisplay(defender);
}

// 無効化（トラップ or キャラ能力）を使うかどうかを解決する統一ルート。
// negator: 無効化する側（sourceCard発動の対象になっている側） / triggerName: 求める発動条件
// sourceCard: 無効化しようとしている対象のカード（マジック or トラップ）
// promptLabel: 人間向けの確認メッセージに使う名前
// abilityAllowed: キャラ能力による無効化も候補に含めるか（トラップ同士の打ち消し合いでは false にする＝元の挙動を踏襲）
//
// 戻り値: 無効化に使われたカード相当のオブジェクト（{name, cost}）。無効化しなかった場合は null。
async function resolveNegateChoice(negator, triggerName, sourceCard, promptLabel, abilityAllowed = true) {
    const options = [];
    const baseCard = cardDatabase[negator.currentCard];

    if (abilityAllowed && baseCard && baseCard.abilities) {
        const charAbility = baseCard.abilities.find(a =>
            a.type === 'triggered' && a.trigger === triggerName && a.effectId === 'NEGATE_TRAP_ONCE'
        );
        if (charAbility) {
            negator.characterNegateCharges = negator.characterNegateCharges || {};
            const used = negator.characterNegateCharges[charAbility.abilityId] || 0;
            if (used < charAbility.params.uses) {
                options.push({ kind: 'ability', ability: charAbility, label: `キャラ能力「${baseCard.name}」で無効化する` });
            }
        }
    }

    for (let i = 0; i < negator.traps.length; i++) {
        const trapId = negator.traps[i];
        if (!trapId) continue;
        const trapCard = cardDatabase[trapId];
        if (!trapCard || trapCard.trigger !== triggerName) continue;
        if (trapCard.params && typeof trapCard.params.maxCost === 'number' && sourceCard.cost > trapCard.params.maxCost) continue;
        options.push({ kind: 'trap', index: i, cardId: trapId, card: trapCard, label: `トラップ「${trapCard.name}」で無効化する` });
    }

    if (options.length === 0) return null;

    let chosen;
    if (isHumanControlled(negator)) {
        await ensureViewerIsPlayer(negator); // ローカル2人対戦：無効化を判断する側に端末を渡す
        const promptOptions = options.map((opt, idx) => ({ label: opt.label, value: idx }));
        promptOptions.push({ label: '無効化しない', value: -1 });
        const choiceIdx = await showActionPrompt(`${getPlayerLabel(negator)}：「${promptLabel}」を無効化しますか？`, promptOptions);
        await returnViewerToActivePlayer(negator); // 手番のプレイヤーに端末を返す
        chosen = (choiceIdx === -1 || choiceIdx === null || choiceIdx === undefined) ? null : options[choiceIdx];
    } else {
        // AIは候補が複数あっても、常に最初に見つかったものを自動使用する（従来通りの簡易挙動）
        chosen = options[0];
    }

    if (!chosen) return null;

    if (chosen.kind === 'ability') {
        negator.characterNegateCharges[chosen.ability.abilityId] =
            (negator.characterNegateCharges[chosen.ability.abilityId] || 0) + 1;
        updateDisplay(`✨ ${getPlayerLabel(negator)}の「${baseCard.name}」の能力が発動：無効化した！`);
        return { name: baseCard.name, cost: 0 };
    }

    const trapCard = chosen.card;
    const i = chosen.index;
    const costToPay = getTrapCostToPay(negator, trapCard);
    negator.od = Math.max(0, negator.od - costToPay);

    updateDisplay(`⚡ ${getPlayerLabel(negator)}のトラップ発動：${trapCard.name}${costToPay === 0 ? '（コスト消費なし）' : ''}`);
    negator.traps[i] = null;
    negator.trapsRevealed[i] = false;
    negator.graveyard.push(chosen.cardId);

    refreshFieldDisplay(negator);
    updateTrapDisplay();
    updateGraveyardDisplay(negator);

    return trapCard;
}
