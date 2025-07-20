export const noteOffsets = { 'C': 0, 'C♯': 1, 'D♭': 1, 'D': 2, 'D♯': 3, 'E♭': 3, 'E': 4, 'F': 5, 'F♯': 6, 'G♭': 6, 'G': 7, 'G♯': 8, 'A♭': 8, 'A': 9, 'A♯': 10, 'B♭': 10, 'B': 11 };
export const displayNotes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const octaves = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const waveforms = { 'sine': '正弦波', 'square': '矩形波', 'sawtooth': 'ノコギリ波', 'triangle': '三角波' };
export const noteDurations = [{ value: 0.25, label: "16分" }, { value: 1 / 3, label: "1拍3連" }, { value: 0.5, label: "8分" }, { value: 2 / 3, label: "2拍3連" }, { value: 1, label: "4分" }, { value: 2, label: "2分" }, { value: 4, label: "全音符" }];
export const chordTypes = { 'major': { name: 'メジャー', intervals: [0, 4, 7] }, 'minor': { name: 'マイナー', intervals: [0, 3, 7] }, 'dominant7th': { name: 'ドミナント7th', intervals: [0, 4, 7, 10] }, 'major7th': { name: 'メジャー7th', intervals: [0, 4, 7, 11] }, 'minor7th': { name: 'マイナー7th', intervals: [0, 3, 7, 10] }, 'diminished': { name: 'ディミニッシュ', intervals: [0, 3, 6] }, 'augmented': { name: 'オーギュメント', intervals: [0, 4, 8] }, 'sus4': { name: 'サスフォー', intervals: [0, 5, 7] }, 'majorPentatonic': { name: 'メジャーペンタ', intervals: [0, 2, 4, 7, 9] }, 'minorPentatonic': { name: 'マイナーペンタ', intervals: [0, 3, 5, 7, 10] } };
export const LOCAL_BACKUP_KEY = 'oscbot_local_backup';
