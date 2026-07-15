// assets.js - 画像素材のパスを一元管理する
// カードイラスト・裏面・バトル背景など、パスの文字列はここだけに書く。
// 他のファイルは getCardArtPath() / CARD_BACK_IMAGE などの関数・定数経由で参照する。
//
// フォルダ名・ファイル名はすべて半角英数字にしてある（日本語パスだと環境によっては
// 画像が読み込めないことがあるため）。

const IMAGE_BASE = "images/";
const CARD_ART_DIR = IMAGE_BASE + "cards/";
const BATTLE_BG_DIR = IMAGE_BASE + "battle_bg/";

const CARD_BACK_IMAGE = CARD_ART_DIR + "card_back.jpg";
const SPELL_GENERIC_IMAGE = CARD_ART_DIR + "spell_generic.jpg";
const COUNTERSPELL_GENERIC_IMAGE = CARD_ART_DIR + "counterspell_generic.jpg";
const AREA_GENERIC_IMAGE = CARD_ART_DIR + "area_generic.jpg";
const BATTLE_BG_IMAGE = BATTLE_BG_DIR + "battle_bg.jpg";

// キャラクターカードは名前でイラストに紐付ける。
// 用意してもらったファイルが無いキャラ（例：小悪魔の覚醒後）は、ここに書かず
// getCardArtPath() 側のフォールバックでカード裏面を表示する。
const CHARACTER_ART_MAP = {
    "博麗霊夢": CARD_ART_DIR + "reimu.png",
    "永遠の巫女・博麗霊夢": CARD_ART_DIR + "reimu_ex.jpg",
    "霧雨魔理沙": CARD_ART_DIR + "marisa.png",
    "奇妙な魔法使い・霧雨魔理沙": CARD_ART_DIR + "marisa_ex.jpg",
    "ルーミア": CARD_ART_DIR + "rumia.jpg",
    "宵闇の妖怪・ルーミア": CARD_ART_DIR + "rumia_ex.jpg",
    "チルノ": CARD_ART_DIR + "cirno.jpg",
    "湖上の氷精・チルノ": CARD_ART_DIR + "cirno_ex.jpg",
    "紅美鈴": CARD_ART_DIR + "meiling.jpg",
    "華人小娘・紅美鈴": CARD_ART_DIR + "meiling_ex.jpg",
    "パチュリー・ノーレッジ": CARD_ART_DIR + "patchouli.jpg",
    "知識と日陰の少女・パチュリー": CARD_ART_DIR + "patchouli_ex.jpg",
    "小悪魔": CARD_ART_DIR + "koakuma.jpg",
    "埃っぽい図書館で働く魔物・小悪魔": CARD_ART_DIR + "koakuma_ex.jpg",
    "十六夜咲夜": CARD_ART_DIR + "sakuya.jpg",
    "紅魔館のメイド・十六夜咲夜": CARD_ART_DIR + "sakuya_ex.jpg",
    "レミリア・スカーレット": CARD_ART_DIR + "remilia.jpg",
    "永遠に紅い幼き月・レミリア": CARD_ART_DIR + "remilia_ex.jpg",
    "フランドール・スカーレット": CARD_ART_DIR + "flandre.png",
    "全てを破滅させる吸血鬼・フランドール": CARD_ART_DIR + "flandre_ex.jpg",
    "大妖精": CARD_ART_DIR + "daiyousei.jpg",
    "霧の中で見つかる妖精・大妖精": CARD_ART_DIR + "daiyousei_ex.jpg"
};

// エリアカードの専用イラストは今回未提供のため、AREA_ART_MAPは空にしておく
// （getCardArtPath()が自動でAREA_GENERIC_IMAGEにフォールバックする）
const AREA_ART_MAP = {};

// カード情報からイラストパスを返す。
// スペル/カウンタースペルは名前を問わず一律で汎用画像、エリアは専用（無ければ汎用）、
// キャラは名前で個別紐付け、該当なしはカード裏面（プレースホルダー）にフォールバックする。
function getCardArtPath(card) {
    if (!card) return CARD_BACK_IMAGE;
    if (card.type === "スペル") return SPELL_GENERIC_IMAGE;
    if (card.type === "カウンタースペル") return COUNTERSPELL_GENERIC_IMAGE;
    if (card.type === "エリア") return AREA_ART_MAP[card.name] || AREA_GENERIC_IMAGE;
    return CHARACTER_ART_MAP[card.name] || CARD_BACK_IMAGE;
}
