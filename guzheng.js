'use strict';
// 古箏定弦資料（21 弦，五聲音階 1 2 3 5 6）
// idx 0 = 最低音（第 21 弦，離身體最遠）；idx 20 = 最高音（第 1 弦）
const Guzheng = (() => {
  // 各調主音的音級（pitch class，C = 0）
  const KEYS = [
    { id: 'D', name: 'D 調', pc: 2 },
    { id: 'G', name: 'G 調', pc: 7 },
    { id: 'C', name: 'C 調', pc: 0 },
    { id: 'F', name: 'F 調', pc: 5 },
    { id: 'A', name: 'A 調', pc: 9 },
    { id: 'E', name: 'E 調', pc: 4 },
    { id: 'Bb', name: '降 B 調', pc: 10 },
  ];
  const SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
  const PENTA = [1, 2, 3, 5, 6];
  const SOLFEGE = { 1: 'Do', 2: 'Re', 3: 'Mi', 4: 'Fa', 5: 'Sol', 6: 'La', 7: 'Si' };
  const OCTAVE_NAMES = { '-2': '倍低音', '-1': '低音', '0': '中音', '1': '高音', '2': '倍高音' };
  const LETTERS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  // 綠弦：第 3、8、13、18 弦（D 調中為 5 / Sol）
  const GREEN = [3, 8, 13, 18];
  // 按音：3 弦按小二度得 4，6 弦按大二度得 7
  const PRESS = { 3: { degree: 4, add: 1 }, 6: { degree: 7, add: 2 } };

  const keyInfo = id => KEYS.find(k => k.id === id) || KEYS[0];
  const letter = midi => LETTERS[midi % 12] + (Math.floor(midi / 12) - 1);
  // 不含八度的音名，升記號寫在前面（#F），和國內古箏教材的寫法一致
  const NOTE_NAMES = ['C', '#C', 'D', '♭E', 'E', 'F', '#F', 'G', '#G', 'A', '♭B', 'B'];
  // 首調：某調中某個簡譜音的音名，例如 D 調的 3 = #F
  const noteName = (keyId, degree) => NOTE_NAMES[(keyInfo(keyId).pc + SEMITONES[degree]) % 12];

  function buildStrings(keyId) {
    const tonic = keyInfo(keyId).pc;
    // 中音 1 的音高落在 E3(52)～Eb4(63)，讓 21 弦剛好涵蓋倍低音～倍高音
    const middleTonic = 52 + ((tonic - 4 + 12) % 12);
    const degreeOf = {};
    PENTA.forEach(d => { degreeOf[(tonic + SEMITONES[d]) % 12] = d; });

    const list = [];
    // 從 C#2(37) 往上取 21 個五聲音，最低弦會落在 C#2 或 D2，和一般轉調移柱的做法一致
    for (let midi = 37; list.length < 21; midi++) {
      const degree = degreeOf[midi % 12];
      if (!degree) continue;
      const idx = list.length;
      const num = 21 - idx;
      list.push({
        idx, num, midi, degree,
        octave: Math.floor((midi - middleTonic) / 12),
        green: GREEN.includes(num),
      });
    }
    return list;
  }

  return { KEYS, PENTA, SEMITONES, SOLFEGE, OCTAVE_NAMES, PRESS, keyInfo, letter, noteName, buildStrings };
})();
