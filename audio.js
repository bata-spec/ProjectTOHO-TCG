// audio.js - 効果音(SE)・BGMの再生を管理する
//
// SEはWeb Audio APIでその場で生成する電子音（ファイル不要ですぐ鳴る）。
// BGMは音声ファイルを想定。audio/bgm/ に mp3 を置けば自動で鳴るが、
// まだファイルが無い間は何も鳴らさず、エラーも出さずに静かに無視する。

let audioCtx = null;
let sfxEnabled = true;
let bgmEnabled = true;
let currentBgm = null;
let currentBgmKey = null;

function getAudioContext() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
    }
    // スマホブラウザは、何かしらのユーザー操作の後でないと音が鳴らないことがあるため、
    // 呼ばれるたびにresumeを試みる（すでに動いていれば何もしない）。
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// オシレーター1本 + 簡単な音量エンベロープで、単発の「ピロッ」を鳴らす
function playTone(freq, duration, type, startDelay, gainPeak) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + (startDelay || 0);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);

    const peak = gainPeak != null ? gainPeak : 0.18;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
}

// 複数の音を連ねて「フレーズ」にする。notes: [{freq, duration, type, delay, gain}, ...]
function playPhrase(notes) {
    if (!sfxEnabled) return;
    notes.forEach(n => playTone(n.freq, n.duration, n.type, n.delay, n.gain));
}

// --- SEカタログ ---
// 効果ごとに鳴らす音を定義する。ここに書き足せば新しいSEを増やせる。
const SE = {
    draw:             () => playPhrase([{ freq: 880, duration: 0.08, type: 'triangle', delay: 0 }]),
    spell:            () => playPhrase([{ freq: 660, duration: 0.10, type: 'square', delay: 0 }, { freq: 990, duration: 0.12, type: 'square', delay: 0.06 }]),
    counterspellSet:  () => playPhrase([{ freq: 440, duration: 0.10, type: 'sine', delay: 0 }]),
    counterspellFire: () => playPhrase([{ freq: 520, duration: 0.09, type: 'sawtooth', delay: 0 }, { freq: 330, duration: 0.14, type: 'sawtooth', delay: 0.05 }]),
    ability:          () => playPhrase([{ freq: 740, duration: 0.10, type: 'triangle', delay: 0 }, { freq: 988, duration: 0.10, type: 'triangle', delay: 0.05 }]),
    damage:           () => playPhrase([{ freq: 180, duration: 0.16, type: 'sawtooth', delay: 0, gain: 0.22 }]),
    heal:             () => playPhrase([{ freq: 523, duration: 0.10, type: 'sine', delay: 0 }, { freq: 659, duration: 0.10, type: 'sine', delay: 0.07 }, { freq: 784, duration: 0.14, type: 'sine', delay: 0.14 }]),
    odBoost:          () => playPhrase([{ freq: 392, duration: 0.08, type: 'triangle', delay: 0 }, { freq: 523, duration: 0.10, type: 'triangle', delay: 0.05 }]),
    negate:           () => playPhrase([{ freq: 300, duration: 0.06, type: 'square', delay: 0 }, { freq: 200, duration: 0.10, type: 'square', delay: 0.05 }]),
    seal:             () => playPhrase([{ freq: 220, duration: 0.20, type: 'sine', delay: 0, gain: 0.14 }]),
    steal:            () => playPhrase([{ freq: 988, duration: 0.06, type: 'square', delay: 0 }, { freq: 740, duration: 0.08, type: 'square', delay: 0.05 }]),
    areaActivate:     () => playPhrase([
        { freq: 392, duration: 0.12, type: 'triangle', delay: 0 },
        { freq: 494, duration: 0.12, type: 'triangle', delay: 0.10 },
        { freq: 659, duration: 0.20, type: 'triangle', delay: 0.20 },
    ]),
    awaken:           () => playPhrase([
        { freq: 392, duration: 0.14, type: 'sawtooth', delay: 0, gain: 0.16 },
        { freq: 523, duration: 0.14, type: 'sawtooth', delay: 0.12, gain: 0.16 },
        { freq: 659, duration: 0.14, type: 'sawtooth', delay: 0.24, gain: 0.16 },
        { freq: 880, duration: 0.35, type: 'sawtooth', delay: 0.36, gain: 0.18 },
    ]),
    turnEnd:          () => playPhrase([{ freq: 494, duration: 0.10, type: 'sine', delay: 0 }]),
    victory:          () => playPhrase([
        { freq: 523, duration: 0.14, type: 'triangle', delay: 0 },
        { freq: 659, duration: 0.14, type: 'triangle', delay: 0.14 },
        { freq: 784, duration: 0.14, type: 'triangle', delay: 0.28 },
        { freq: 1047, duration: 0.30, type: 'triangle', delay: 0.42 },
    ]),
    defeat:           () => playPhrase([
        { freq: 392, duration: 0.18, type: 'sawtooth', delay: 0 },
        { freq: 330, duration: 0.18, type: 'sawtooth', delay: 0.16 },
        { freq: 262, duration: 0.35, type: 'sawtooth', delay: 0.32 },
    ]),
    tap:              () => playPhrase([{ freq: 1046, duration: 0.04, type: 'sine', delay: 0, gain: 0.08 }]),
};

function playSE(name) {
    if (!sfxEnabled) return;
    const fn = SE[name];
    if (fn) fn();
}

// --- BGM ---
// 音声ファイルは audio/bgm/ に置く想定（無くても壊れない）。
const BGM_TRACKS = {
    title: "audio/bgm/title.mp3",
    deckbuilder: "audio/bgm/deckbuilder.mp3",
    battle: "audio/bgm/battle.mp3",
    victory: "audio/bgm/victory.mp3",
    defeat: "audio/bgm/defeat.mp3",
};

function playBGM(key) {
    if (currentBgmKey === key && currentBgm && !currentBgm.paused) return;
    stopBGM();
    currentBgmKey = key;
    if (!bgmEnabled) return;

    const src = BGM_TRACKS[key];
    if (!src) return;

    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0.4;
    audio.onerror = () => { /* ファイル未提供の間は静かに無視する */ };
    audio.play().catch(() => { /* 自動再生ブロック等は無視。次のタップ操作後に再度呼ばれれば鳴る */ });

    currentBgm = audio;
}

function stopBGM() {
    if (currentBgm) {
        currentBgm.pause();
        currentBgm.currentTime = 0;
        currentBgm = null;
    }
}

// --- ミュート切り替え（画面上のボタンから呼ぶ） ---
function toggleSfx() {
    sfxEnabled = !sfxEnabled;
    updateAudioButtons();
}

function toggleBgm() {
    bgmEnabled = !bgmEnabled;
    if (!bgmEnabled) {
        stopBGM();
    } else if (currentBgmKey) {
        playBGM(currentBgmKey);
    }
    updateAudioButtons();
}

function updateAudioButtons() {
    const sfxBtn = document.getElementById('sfx-toggle-btn');
    const bgmBtn = document.getElementById('bgm-toggle-btn');
    if (sfxBtn) sfxBtn.innerText = sfxEnabled ? '🔊 SE' : '🔇 SE';
    if (bgmBtn) bgmBtn.innerText = bgmEnabled ? '🎵 BGM' : '🎵 BGM(OFF)';
}
