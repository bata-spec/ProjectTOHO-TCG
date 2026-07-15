// data_loader.js - cards_data.json を読み込む(失敗したら必ず画面に表示)

fetch('cards_data.json')
    .then(response => {
        if (!response.ok) throw new Error(`HTTPエラー: ${response.status}`);
        return response.json();
    })
    .then(data => {
        cardDatabase = data;
        updateDisplay(`カードデータ読み込み完了：${Object.keys(cardDatabase).length}枚`);
        onDataLoaded();
    })
    .catch(error => {
        updateDisplay(`❌ JSON読み込みエラー: ${error.message}`);
    });
