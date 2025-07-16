document.addEventListener('DOMContentLoaded', async () => {
    // =================================================================================
    // 1. 初期設定とグローバル変数
    // =================================================================================

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioCtx) {
        alert("Web Audio API not supported.");
        return;
    }

    // Firebase SDKの初期化
    let firebaseConfig = null;
    try {
        const response = await fetch('/api/firebase-config');
        firebaseConfig = await response.json();
        firebase.initializeApp(firebaseConfig);
    } catch (error) {
        console.error('Firebase config error:', error);
        alert('設定ファイルの読み込みに失敗しました。');
        return;
    }
    const db = firebase.firestore();
    const auth = firebase.auth();

    // DOM要素の取得
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const loadDataButton = document.getElementById('load-data-button');
    const playbackGrid = document.getElementById('playback-grid');
    const sequenceMaxButtonsContainer = document.getElementById('sequence-max-buttons');
    const noteDurationButtonsContainer = document.getElementById('note-duration-buttons');
    const bpmInput = document.getElementById('bpm');
    const bpmAdjustButtons = document.querySelectorAll('.bpm-adjust');
    const playOnceButton = document.getElementById('play-once-button');
    const playLoopButton = document.getElementById('play-loop-button');
    const stopButton = document.getElementById('stop-button');
    const bulkEditTriggerButton = document.getElementById('bulk-edit-button');
    const randomGenerateTriggerButton = document.getElementById('random-generate-trigger-button');
    const toastContainer = document.getElementById('toast-container');
    const presetStatusContainer = document.getElementById('preset-status-container');
    const currentPresetStatus = document.getElementById('current-preset-status');
    const fxSlotsContainer = document.getElementById('fx-slots-container');
    const presetMenuButton = document.getElementById('preset-menu-button');
    const presetActionMenu = document.getElementById('preset-action-menu');

    // モーダル関連のDOM要素
    const editModal = document.getElementById('edit-modal');
    const fxEditModal = document.getElementById('fx-edit-modal');
    const bulkEditModal = document.getElementById('bulk-edit-modal');
    const randomGenerateModal = document.getElementById('random-generate-modal');
    const loadPresetModal = document.getElementById('load-preset-modal');
    const renamePresetModal = document.getElementById('rename-preset-modal');
    const confirmationModal = document.getElementById('confirmation-modal');

    // アプリケーションの状態変数
    let sequenceData = [];
    let currentUser = null;
    let currentStep = 0;
    let isPlaying = false;
    let isLooping = false;
    let sequenceTimeoutId = null;
    let activeOscillators = [];
    let currentlyEditingStepId = null;
    let dragSrcElement = null;
    let currentSequenceMax = 16;
    let currentNoteDuration = 1;
    let currentlyLoadedPresetDocId = null;
    let currentlyEditingFxSlot = null;
    let autoSaveTimer = null;

    // オーディオ関連
    const masterGain = audioCtx.createGain();
    let fxSlots = [
        { id: 'B', name: 'FX B', node: null, bypassNode: null, isActive: false, effectType: 'delay', params: { mix: 0.5, time: 0.25, feedback: 0.4, syncMode: 'bpm', rate: 4 } },
        { id: 'C', name: 'FX C', node: null, bypassNode: null, isActive: false, effectType: 'reverb', params: { mix: 0.5 } },
        { id: 'D', name: 'FX D', node: null, bypassNode: null, isActive: false, effectType: 'none', params: {} }
    ];

    // データ定義
    const effectDefinitions = {
        'none': { name: 'エフェクトなし', params: {} },
        'reverb': {
            name: 'リバーブ',
            params: { mix: { label: 'Mix', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 } },
            createNode: async (ctx) => {
                const convolver = ctx.createConvolver();
                const wetGain = ctx.createGain();
                const dryGain = ctx.createGain();
                const sampleRate = ctx.sampleRate, length = sampleRate * 2, impulse = ctx.createBuffer(2, length, sampleRate);
                const left = impulse.getChannelData(0), right = impulse.getChannelData(1);
                for (let i = 0; i < length; i++) {
                    left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
                    right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
                }
                convolver.buffer = impulse;
                return { convolver, wetGain, dryGain };
            }
        },
        'delay': {
            name: 'ディレイ',
            params: {
                mix: { label: 'Mix', type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 },
                feedback: { label: 'Feedback', type: 'range', min: 0, max: 0.9, step: 0.01, value: 0.4 },
                time: { label: 'Time', type: 'range', min: 0.01, max: 2, step: 0.01, value: 0.25 },
                rate: {
                    label: 'Rate', type: 'buttons', value: 4, 
                    options: [
                        { value: 0.5, label: '1/2' }, { value: 0.75, label: '1/2 3' }, { value: 1, label: '1/4' },
                        { value: 1 / 1.5, label: '1/4.'}, { value: 1.5, label: '1/4 3' }, { value: 2, label: '1/8' },
                        { value: 2 / 1.5, label: '1/8.'}, { value: 3, label: '1/8 3' }, { value: 4, label: '1/16' }
                    ]
                }
            },
            createNode: (ctx) => ({ delay: ctx.createDelay(5.0), feedback: ctx.createGain(), wetGain: ctx.createGain(), dryGain: ctx.createGain() })
        },
        'slicer': {
            name: 'スライサー',
            params: {
                depth: { label: 'Depth', type: 'range', min: 0, max: 1, step: 0.01, value: 1.0 },
                rate: {
                    label: 'Rate', type: 'buttons', value: 4, 
                    options: [
                        { value: 1, label: '1/4' }, { value: 1.5, label: '1/4 3' }, { value: 2, label: '1/8' },
                        { value: 2 / 1.5, label: '1/8.'}, { value: 3, label: '1/8 3' }, { value: 4, label: '1/16' },
                        { value: 4 / 1.5, label: '1/16.'}, { value: 6, label: '1/16 3' }, { value: 8, label: '1/32' }
                    ]
                }
            },
            createNode: (ctx) => {
                const slicerGain = ctx.createGain();
                const lfo = ctx.createOscillator();
                const lfoGain = ctx.createGain();
                const dcOffset = ctx.createConstantSource();
                lfo.type = 'square';
                slicerGain.gain.value = 0;
                lfo.connect(lfoGain).connect(slicerGain.gain);
                dcOffset.connect(slicerGain.gain);
                lfo.start();
                dcOffset.start();
                return { slicerGain, lfo, lfoGain, dcOffset };
            }
        }
    };
    const noteOffsets = { 'C': 0, 'C♯': 1, 'D♭': 1, 'D': 2, 'D♯': 3, 'E♭': 3, 'E': 4, 'F': 5, 'F♯': 6, 'G♭': 6, 'G': 7, 'G♯': 8, 'A♭': 8, 'A': 9, 'A♯': 10, 'B♭': 10, 'B': 11 };
    const displayNotes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const octaves = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const waveforms = { 'sine': '正弦波', 'square': '矩形波', 'sawtooth': 'ノコギリ波', 'triangle': '三角波' };
    const noteDurations = [{ value: 0.25, label: "16分" }, { value: 1 / 3, label: "1拍3連" }, { value: 0.5, label: "8分" }, { value: 2 / 3, label: "2拍3連" }, { value: 1, label: "4分" }, { value: 2, label: "2分" }, { value: 4, label: "全音符" }];
    const chordTypes = { 'major': { name: 'メジャー', intervals: [0, 4, 7] }, 'minor': { name: 'マイナー', intervals: [0, 3, 7] }, 'dominant7th': { name: 'ドミナント7th', intervals: [0, 4, 7, 10] }, 'major7th': { name: 'メジャー7th', intervals: [0, 4, 7, 11] }, 'minor7th': { name: 'マイナー7th', intervals: [0, 3, 7, 10] }, 'diminished': { name: 'ディミニッシュ', intervals: [0, 3, 6] }, 'augmented': { name: 'オーギュメント', intervals: [0, 4, 8] }, 'sus4': { name: 'サスフォー', intervals: [0, 5, 7] }, 'majorPentatonic': { name: 'メジャーペンタ', intervals: [0, 2, 4, 7, 9] }, 'minorPentatonic': { name: 'マイナーペンタ', intervals: [0, 3, 5, 7, 10] } };

    // =================================================================================
    // 2. コア・ユーティリティ関数
    // =================================================================================

    function updateSliderFill(slider) {
        if (!slider) return;
        const min = slider.min ? parseFloat(slider.min) : 0;
        const max = slider.max ? parseFloat(slider.max) : 100;
        const value = parseFloat(slider.value);
        const percentage = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--fill-percent', `${percentage}%`);
    }

    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast-message ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, duration);
    }

    function openModal(modalElement) {
        modalElement.style.display = "flex";
        setTimeout(() => modalElement.classList.add('active'), 10);
    }

    function closeModalHelper(modalElement) {
        modalElement.classList.remove('active');
        setTimeout(() => modalElement.style.display = "none", 300);
    }

    function setupModalListeners(modalElement, closeFn) {
        modalElement.querySelector('.close-button').onclick = closeFn;
        window.addEventListener('click', (event) => {
            if (event.target == modalElement) closeFn();
        });
    }

    function showConfirmationModal(message, onConfirm, options = {}) {
        const confirmModal = document.getElementById('confirmation-modal');
        const messageEl = confirmModal.querySelector('#confirmation-modal-message');
        const confirmBtn = confirmModal.querySelector('#confirmation-modal-confirm-button');
        const cancelBtn = confirmModal.querySelector('#confirmation-modal-cancel-button');
        const altBtn = confirmModal.querySelector('#confirmation-modal-alternative-button');

        messageEl.textContent = message;
        confirmBtn.onclick = () => { if (onConfirm) onConfirm(); closeModalHelper(confirmModal); };
        cancelBtn.onclick = () => closeModalHelper(confirmModal);

        if (options.onAlternative) {
            altBtn.style.display = 'inline-block';
            altBtn.textContent = options.alternativeText || '選択肢';
            altBtn.onclick = () => { options.onAlternative(); closeModalHelper(confirmModal); };
        } else {
            altBtn.style.display = 'none';
        }

        confirmBtn.textContent = options.confirmText || 'OK';
        cancelBtn.textContent = options.cancelText || 'キャンセル';
        confirmBtn.classList.toggle('danger', !!options.isDanger);
        openModal(confirmModal);
    }

    function showLoginPromptModal() {
        showConfirmationModal('この機能を利用するにはGoogleアカウントでのログインが必要です。', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(error => {
                if (error.code !== 'auth/popup-closed-by-user') showToast(`ログインに失敗しました: ${error.message}`, 'error');
            });
        }, { confirmText: 'Googleでログイン', cancelText: 'キャンセル' });
    }

    // =================================================================================
    // 3. 状態管理 (State Management) & データ処理
    // =================================================================================

    function getCurrentState() {
        return {
            sequenceData: sequenceData.map(({ note, octave, waveform, volume }) => ({ note, octave, waveform, volume })),
            bpm: parseInt(bpmInput.value),
            noteDuration: currentNoteDuration,
            sequenceMax: currentSequenceMax,
            fxSlots: fxSlots.map(slot => ({ isActive: slot.isActive, effectType: slot.effectType, params: slot.params }))
        };
    }

    async function applyState(state) {
        state.sequenceData.forEach((step, i) => {
            if (sequenceData[i]) {
                Object.assign(sequenceData[i], step);
                updatePlaybackBlockDisplay(i);
            }
        });
        bpmInput.value = state.bpm;
        currentNoteDuration = state.noteDuration;
        setActiveButtonInGroup(noteDurationButtonsContainer, currentNoteDuration);
        currentSequenceMax = state.sequenceMax;
        setActiveButtonInGroup(sequenceMaxButtonsContainer, currentSequenceMax);

        if (state.fxSlots) {
            for (let i = 0; i < fxSlots.length; i++) {
                if (state.fxSlots[i]) {
                    const oldSlot = fxSlots[i];
                    const newSlotState = state.fxSlots[i];
                    oldSlot.isActive = newSlotState.isActive;
                    oldSlot.effectType = newSlotState.effectType;
                    const paramDefs = effectDefinitions[newSlotState.effectType]?.params || {};
                    const defaultParams = Object.fromEntries(Object.entries(paramDefs).map(([key, val]) => [key, val.value]));
                    oldSlot.params = { ...defaultParams, ...newSlotState.params };
                }
            }
            await initializeFxNodes();
            fxSlots.forEach(slot => updateFxSlotButton(slot.id));
        }
    }

    function markAsDirty() {
        saveLocalBackup();
        updatePresetStatus(currentPresetStatus.textContent, false, true);
        if (!currentUser) return;
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(performAutoSave, 2500);
    }

    async function performAutoSave() {
        if (!currentUser) return;
        updatePresetStatus('保存中...', false);
        try {
            const state = getCurrentState();
            let presetName;
            if (currentlyLoadedPresetDocId) {
                const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(currentlyLoadedPresetDocId);
                await docRef.update({ ...state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                presetName = (await docRef.get()).data().name;
            } else {
                presetName = `無題 ${new Date().toLocaleString()}`;
                const docRef = await db.collection('users').doc(currentUser.uid).collection('presets').add({
                    ...state, name: presetName, description: '', tags: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                currentlyLoadedPresetDocId = docRef.id;
            }
            updatePresetStatus(presetName, true);
            clearLocalBackup();
        } catch (error) {
            showToast(`自動保存に失敗: ${error.message}`, 'error');
            console.error("Auto-save error: ", error);
            updatePresetStatus(currentPresetStatus.textContent.replace('保存中...', ''), false, true);
        }
    }

    // =================================================================================
    // 4. オーディオ処理
    // =================================================================================

    function getFrequency(noteName, octave) {
        const noteVal = noteOffsets[noteName.replace('#', '♯')];
        if (noteVal === undefined) return 0;
        const midiNote = (octave + 1) * 12 + noteVal;
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function applyFxParams(slot) {
        if (!slot.node || slot.effectType === 'none') return;
        const params = slot.params;
        const now = audioCtx.currentTime;
        if (slot.effectType === 'reverb') {
            slot.node.wetGain.gain.setValueAtTime(params.mix, now);
            slot.node.dryGain.gain.setValueAtTime(1 - params.mix, now);
        } else if (slot.effectType === 'delay') {
            slot.node.wetGain.gain.setValueAtTime(params.mix, now);
            slot.node.dryGain.gain.setValueAtTime(1 - params.mix, now);
            let delayTimeValue;
            if (params.syncMode === 'bpm') {
                const bpm = parseFloat(bpmInput.value);
                delayTimeValue = 60 / (bpm * params.rate);
            } else {
                delayTimeValue = params.time;
            }
            delayTimeValue = Math.max(0.001, Math.min(delayTimeValue, 5.0));
            slot.node.delay.delayTime.setValueAtTime(delayTimeValue, now);
            slot.node.feedback.gain.setValueAtTime(params.feedback, now);
        } else if (slot.effectType === 'slicer') {
            const { lfo, lfoGain, dcOffset } = slot.node;
            const bpm = parseFloat(bpmInput.value);
            const frequencyInHz = (bpm / 60) * params.rate;
            const depth = params.depth;
            lfo.frequency.setValueAtTime(frequencyInHz, now);
            lfoGain.gain.setValueAtTime(depth / 2, now);
            dcOffset.offset.setValueAtTime(depth / 2, now);
        }
    }

    function updateActiveBpmSyncFx() {
        const activeBpmFx = fxSlots.filter(s => s.isActive && (s.effectType === 'slicer' || (s.effectType === 'delay' && s.params.syncMode === 'bpm')));
        activeBpmFx.forEach(applyFxParams);
    }

    function playSound(data, duration, startTime = audioCtx.currentTime) {
        if (data.volume === 0) return;
        const freq = getFrequency(data.note, data.octave);
        if (freq === 0) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = data.waveform;
        osc.frequency.setValueAtTime(freq, startTime);
        const attack = 0.01, release = Math.min(0.04, duration * 0.3);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(data.volume, startTime + attack);
        if (startTime + duration - release > startTime + attack) {
            gain.gain.setValueAtTime(data.volume, startTime + duration - release);
        }
        gain.gain.linearRampToValueAtTime(0, startTime + duration);
        osc.connect(gain).connect(masterGain);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
        const active = { oscillator: osc, gainNode: gain, blockId: data.id };
        activeOscillators.push(active);
        setTimeout(() => activeOscillators = activeOscillators.filter(o => o !== active), (duration + 0.1) * 1000);
    }

    function playSoundWithResume(data, duration) {
        if (audioCtx.state === 'suspended') audioCtx.resume().then(() => playSound(data, duration));
        else playSound(data, duration);
    }

    function scheduleNextStep() {
        if (!isPlaying) return;
        if (currentStep >= currentSequenceMax) {
            if (isLooping) currentStep = 0;
            else { stopAllSounds(); return; }
        }
        const data = sequenceData[currentStep];
        const bpmVal = parseFloat(bpmInput.value);
        const stepDurSec = (60 / bpmVal) * currentNoteDuration;
        highlightPlaybackBlock(currentStep, stepDurSec);
        playSound(data, stepDurSec);
        currentStep++;
        if (isPlaying) sequenceTimeoutId = setTimeout(scheduleNextStep, stepDurSec * 1000);
    }

    function handlePlay(loop) {
        if (isPlaying) stopAllSounds();
        const start = () => {
            isPlaying = true; isLooping = loop; currentStep = 0;
            document.querySelectorAll('.playback-block.playing').forEach(el => el.classList.remove('playing'));
            scheduleNextStep();
        };
        if (audioCtx.state === 'suspended') audioCtx.resume().then(start);
        else start();
    }

    function stopAllSounds() {
        isPlaying = false; isLooping = false;
        if (sequenceTimeoutId) clearTimeout(sequenceTimeoutId);
        sequenceTimeoutId = null;
        const now = audioCtx.currentTime;
        activeOscillators.forEach(({ gainNode }) => {
            try {
                gainNode.gain.cancelScheduledValues(now);
                gainNode.gain.setValueAtTime(gainNode.gain.value, now);
                gainNode.gain.linearRampToValueAtTime(0, now + 0.02);
            } catch (e) { /* ignore */ }
        });
        activeOscillators = [];
        document.querySelectorAll('.playback-block.playing').forEach(el => el.classList.remove('playing'));
        currentStep = 0;
    }

    // =================================================================================
    // 5. UI更新とコンポーネント生成
    // =================================================================================

    function updatePlaybackBlockDisplay(id) {
        const data = sequenceData[id];
        const el = data.playbackElements;
        el.noteDisplay.textContent = `${data.note.replace('♯', '#')}${data.octave}`;
        el.waveDisplay.textContent = waveforms[data.waveform] || data.waveform;
        el.volumeBar.style.width = `${data.volume * 100}%`;
    }

    function createPlaybackBlocks() {
        playbackGrid.innerHTML = '';
        sequenceData = [];
        for (let i = 0; i < 16; i++) {
            const block = document.createElement('div');
            block.className = 'playback-block';
            block.dataset.id = i;
            block.draggable = true;
            block.onclick = () => openEditModal(i);
            const stepNumEl = document.createElement('span');
            stepNumEl.className = 'step-number-pb';
            stepNumEl.textContent = i + 1;
            const noteEl = document.createElement('div'); noteEl.className = 'pb-note';
            const waveEl = document.createElement('div'); waveEl.className = 'pb-wave';
            const volContainerEl = document.createElement('div'); volContainerEl.className = 'pb-volume-container';
            const volBarEl = document.createElement('div'); volBarEl.className = 'pb-volume-bar';
            volContainerEl.appendChild(volBarEl);
            block.append(stepNumEl, noteEl, waveEl, volContainerEl);
            playbackGrid.appendChild(block);
            sequenceData.push({
                id: i, note: 'A', octave: 4, waveform: 'sawtooth', volume: 0.5,
                playbackElements: { blockElement: block, noteDisplay: noteEl, waveDisplay: waveEl, volumeBar: volBarEl }
            });
            updatePlaybackBlockDisplay(i);
        }
    }

    function updateFxSlotButton(fxId) {
        const slot = fxSlots.find(s => s.id === fxId);
        const button = fxSlotsContainer.querySelector(`[data-fx-id="${fxId}"]`);
        if (!slot || !button) return;
        button.classList.toggle('active', slot.isActive);
        button.querySelector('.fx-type-name').textContent = effectDefinitions[slot.effectType].name;
    }

    function createFxSlotButtons() {
        fxSlotsContainer.innerHTML = '';
        fxSlots.forEach(slot => {
            const button = document.createElement('button');
            button.className = 'fx-slot-button';
            button.dataset.fxId = slot.id;
            button.innerHTML = `<span class="fx-slot-name">${slot.name}</span><span class="fx-type-name"></span>`;
            let pressTimer = null;
            const startPress = (e) => {
                e.preventDefault();
                pressTimer = setTimeout(() => { openFxEditModal(slot.id); pressTimer = null; }, 500);
            };
            const cancelPress = () => {
                if (pressTimer) clearTimeout(pressTimer);
                pressTimer = null;
            };
            const clickHandler = () => {
                if (pressTimer !== null) toggleFxSlot(slot.id);
                cancelPress();
            };
            button.addEventListener('mousedown', startPress);
            button.addEventListener('touchstart', startPress, { passive: false });
            button.addEventListener('mouseup', clickHandler);
            button.addEventListener('mouseleave', cancelPress);
            button.addEventListener('touchend', clickHandler);
            fxSlotsContainer.appendChild(button);
            updateFxSlotButton(slot.id);
        });
    }

    function populateFxParams() {
        const slot = currentlyEditingFxSlot;
        const fxParamsContainer = document.getElementById('fx-params-container');
        fxParamsContainer.innerHTML = '';
        if (!slot || slot.effectType === 'none') return;
        const paramDefs = effectDefinitions[slot.effectType].params;
        if (slot.effectType === 'delay') {
            const currentParams = slot.params;
            const createSlider = (paramKey, def) => {
                const val = currentParams[paramKey] ?? def.value;
                const wrapper = document.createElement('div');
                wrapper.className = 'fx-param-control';
                wrapper.innerHTML = `<label>${def.label}</label><div class="slider-wrapper"><input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param-key="${paramKey}"><span>${val}</span></div>`;
                const slider = wrapper.querySelector('input');
                const valueDisplay = wrapper.querySelector('span');
                slider.oninput = () => { valueDisplay.textContent = slider.value; updateSliderFill(slider); };
                updateSliderFill(slider);
                return wrapper;
            };
            fxParamsContainer.appendChild(createSlider('mix', paramDefs.mix));
            fxParamsContainer.appendChild(createSlider('feedback', paramDefs.feedback));
            const switchWrapper = document.createElement('div');
            switchWrapper.className = 'fx-param-control toggle-switch-container';
            switchWrapper.innerHTML = `<span class="toggle-label">Time (秒数で指定)</span><label class="toggle-switch"><input type="checkbox" data-param-key="syncMode"><span class="toggle-slider"></span></label>`;
            const switchInput = switchWrapper.querySelector('input');
            fxParamsContainer.appendChild(switchWrapper);
            const timeSliderContainer = document.createElement('div');
            timeSliderContainer.dataset.syncControl = 'time';
            timeSliderContainer.appendChild(createSlider('time', paramDefs.time));
            fxParamsContainer.appendChild(timeSliderContainer);
            const rateButtonsContainer = document.createElement('div');
            rateButtonsContainer.dataset.syncControl = 'bpm';
            const rateDef = paramDefs.rate;
            const rateVal = currentParams.rate ?? rateDef.value;
            const rateControlWrapper = document.createElement('div');
            rateControlWrapper.className = 'fx-param-control';
            rateControlWrapper.innerHTML = `<label>${rateDef.label}</label>`;
            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'button-selector-group fx-param-buttons';
            buttonGroup.dataset.paramKey = 'rate';
            rateDef.options.forEach(opt => {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.value = opt.value;
                button.textContent = opt.label;
                if (opt.value == rateVal) button.classList.add('active');
                button.onclick = () => {
                    buttonGroup.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                };
                buttonGroup.appendChild(button);
            });
            rateControlWrapper.appendChild(buttonGroup);
            rateButtonsContainer.appendChild(rateControlWrapper);
            fxParamsContainer.appendChild(rateButtonsContainer);
            const updateVisibility = () => {
                const isTimeMode = switchInput.checked;
                timeSliderContainer.style.display = isTimeMode ? '' : 'none';
                rateButtonsContainer.style.display = isTimeMode ? 'none' : '';
            };
            switchInput.onchange = updateVisibility;
            switchInput.checked = currentParams.syncMode === 'time';
            updateVisibility();
        } else {
            for (const paramKey in paramDefs) {
                const paramDef = paramDefs[paramKey];
                const currentValue = slot.params[paramKey] ?? paramDef.value;
                const controlWrapper = document.createElement('div');
                controlWrapper.className = 'fx-param-control';
                const label = document.createElement('label');
                label.textContent = paramDef.label;
                controlWrapper.appendChild(label);
                if (paramDef.type === 'range') {
                    const sliderWrapper = document.createElement('div');
                    sliderWrapper.className = 'slider-wrapper';
                    sliderWrapper.innerHTML = `<input type="range" min="${paramDef.min}" max="${paramDef.max}" step="${paramDef.step}" value="${currentValue}" data-param-key="${paramKey}"><span>${currentValue}</span>`;
                    const slider = sliderWrapper.querySelector('input[type="range"]');
                    const valueDisplay = sliderWrapper.querySelector('span');
                    slider.oninput = () => { valueDisplay.textContent = slider.value; updateSliderFill(slider); };
                    controlWrapper.appendChild(sliderWrapper);
                    updateSliderFill(slider);
                } else if (paramDef.type === 'buttons') {
                    const buttonGroup = document.createElement('div');
                    buttonGroup.className = 'button-selector-group fx-param-buttons';
                    buttonGroup.dataset.paramKey = paramKey;
                    paramDef.options.forEach(opt => {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.dataset.value = opt.value;
                        button.textContent = opt.label;
                        if (opt.value == currentValue) button.classList.add('active');
                        button.onclick = () => {
                            buttonGroup.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                            button.classList.add('active');
                        };
                        buttonGroup.appendChild(button);
                    });
                    controlWrapper.appendChild(buttonGroup);
                }
                fxParamsContainer.appendChild(controlWrapper);
            }
        }
    }

    function populateRandomGenerateModalControls() {
        const stepsOptions = Array.from({ length: 16 }, (_, i) => i + 1);
        generateButtonSelectors(document.getElementById('rg-root-note-buttons'), displayNotes, 'rg-root', (val) => val.replace('♯', '#'));
        setActiveButtonInGroup(document.getElementById('rg-root-note-buttons'), 'C');
        const chordSelect = document.getElementById('rg-chord-type');
        chordSelect.innerHTML = Object.keys(chordTypes).map(k => `<option value="${k}">${chordTypes[k].name}</option>`).join('');
        generateButtonSelectors(document.getElementById('rg-octave-min-buttons'), octaves, 'rg-octave-min');
        setActiveButtonInGroup(document.getElementById('rg-octave-min-buttons'), 3);
        generateButtonSelectors(document.getElementById('rg-octave-max-buttons'), octaves, 'rg-octave-max');
        setActiveButtonInGroup(document.getElementById('rg-octave-max-buttons'), 5);
        generateButtonSelectors(document.getElementById('rg-steps-buttons'), stepsOptions, 'rg-steps');
        setActiveButtonInGroup(document.getElementById('rg-steps-buttons'), currentSequenceMax);
    }

    function updatePresetStatus(text, isSaved, isDirty = false) {
        let statusText = text || '新規シーケンス';
        const baseName = statusText.replace(/\s\*$/, '').replace(/^[\u2713\s]*/, '').replace(/^保存中.../, '');

        if (isSaved) {
            statusText = `✓ ${baseName}`;
        } else if (text === '保存中...') {
            statusText = '保存中...';
        } else if (isDirty) {
            statusText = `${baseName} *`;
        }

        if (text === null) {
            presetStatusContainer.style.display = 'none';
            presetMenuButton.style.display = 'none';
        } else {
            currentPresetStatus.textContent = statusText;
            presetStatusContainer.style.display = 'flex';
            presetMenuButton.style.display = currentlyLoadedPresetDocId ? 'flex' : 'none';
        }
    }

    // =================================================================================
    // 6. イベントハンドラとアクション関数
    // =================================================================================

    function closeEditModal() { closeModalHelper(editModal); currentlyEditingStepId = null; }
    function closeBulkEditModal() { closeModalHelper(bulkEditModal); }
    function closeRandomGenerateModal() { closeModalHelper(randomGenerateModal); }
    function closeLoadPresetModal() { closeModalHelper(loadPresetModal); }
    function closeFxEditModal() { closeModalHelper(fxEditModal); currentlyEditingFxSlot = null; }

    function saveSingleStepChanges() {
        if (currentlyEditingStepId === null) return;
        const id = currentlyEditingStepId;
        const getActiveValue = (container) => container.querySelector('button.active')?.dataset.value;
        sequenceData[id].note = getActiveValue(document.getElementById('modal-note-buttons')) || sequenceData[id].note;
        sequenceData[id].octave = parseInt(getActiveValue(document.getElementById('modal-octave-buttons'))) || sequenceData[id].octave;
        sequenceData[id].waveform = getActiveValue(document.getElementById('modal-waveform-buttons')) || sequenceData[id].waveform;
        sequenceData[id].volume = parseInt(document.getElementById('modal-volume').value) / 100;
        updatePlaybackBlockDisplay(id);
        closeEditModal();
        markAsDirty();
    }

    function playTestFromSingleEditModal() {
        if (currentlyEditingStepId === null) return;
        const getActiveValue = (container) => container.querySelector('button.active')?.dataset.value;
        const testData = {
            note: getActiveValue(document.getElementById('modal-note-buttons')),
            octave: parseInt(getActiveValue(document.getElementById('modal-octave-buttons'))),
            waveform: getActiveValue(document.getElementById('modal-waveform-buttons')),
            volume: parseInt(document.getElementById('modal-volume').value) / 100,
        };
        playSoundWithResume(testData, 0.5);
    }

    function applyBulkChanges() {
        const getActiveValue = (container) => container.querySelector('button.active')?.dataset.value;
        const changes = {
            note: getActiveValue(document.getElementById('bulk-modal-note-buttons')),
            octave: parseInt(getActiveValue(document.getElementById('bulk-modal-octave-buttons'))),
            waveform: getActiveValue(document.getElementById('bulk-modal-waveform-buttons')),
        };
        if (document.getElementById('bulk-modal-volume').dataset.isSetForBulk === "true") {
            changes.volume = parseInt(document.getElementById('bulk-modal-volume').value) / 100;
        }
        for (let i = 0; i < 16; i++) {
            if (changes.note) sequenceData[i].note = changes.note;
            if (!isNaN(changes.octave)) sequenceData[i].octave = changes.octave;
            if (changes.waveform) sequenceData[i].waveform = changes.waveform;
            if (changes.volume !== undefined) sequenceData[i].volume = changes.volume;
            updatePlaybackBlockDisplay(i);
        }
        closeBulkEditModal();
        markAsDirty();
    }

    function executeRandomGeneration() {
        currentlyLoadedPresetDocId = null;
        updatePresetStatus(null, false);
        const getActiveValue = (container) => container.querySelector('button.active')?.dataset.value;
        const rootNoteName = getActiveValue(document.getElementById('rg-root-note-buttons'));
        const octaveMin = parseInt(getActiveValue(document.getElementById('rg-octave-min-buttons')));
        const octaveMax = parseInt(getActiveValue(document.getElementById('rg-octave-max-buttons')));
        const stepsToGen = parseInt(getActiveValue(document.getElementById('rg-steps-buttons')));
        if (!rootNoteName || !octaveMin || !octaveMax || !stepsToGen) {
            showToast("ランダム生成の全項目を選択してください。", "error"); return;
        }
        if (octaveMin > octaveMax) {
            showToast("最小オクターブは最大以下にしてください。", "error"); return;
        }
        const chord = chordTypes[document.getElementById('rg-chord-type').value];
        const rootNoteOffset = noteOffsets[rootNoteName];
        const availableNotes = [];
        for (let oct = octaveMin; oct <= octaveMax; oct++) {
            chord.intervals.forEach(interval => {
                const midi = (oct + 1) * 12 + rootNoteOffset + interval;
                const noteIndex = midi % 12;
                const actualOctave = Math.floor(midi / 12) - 1;
                let noteName = displayNotes.find(n => noteOffsets[n] === noteIndex && !n.includes('♭')) || displayNotes[noteIndex];
                if (actualOctave >= 1 && actualOctave <= 9) availableNotes.push({ note: noteName, octave: actualOctave });
            });
        }
        if (availableNotes.length === 0) {
            showToast("指定範囲で生成可能な音がありません。", "error"); return;
        }
        for (let i = 0; i < stepsToGen; i++) {
            const randomNote = availableNotes[Math.floor(Math.random() * availableNotes.length)];
            sequenceData[i].note = randomNote.note;
            sequenceData[i].octave = randomNote.octave;
            updatePlaybackBlockDisplay(i);
        }
        currentSequenceMax = stepsToGen;
        setActiveButtonInGroup(sequenceMaxButtonsContainer, currentSequenceMax);
        closeRandomGenerateModal();
        showToast("ランダム生成を実行しました。", "success");
        markAsDirty();
    }

    function swapStepData(sourceId, targetId) {
        const sourceData = { ...sequenceData[sourceId] };
        const targetData = { ...sequenceData[targetId] };
        ['note', 'octave', 'waveform', 'volume'].forEach(key => {
            sequenceData[sourceId][key] = targetData[key];
            sequenceData[targetId][key] = sourceData[key];
        });
        updatePlaybackBlockDisplay(sourceId);
        updatePlaybackBlockDisplay(targetId);
        markAsDirty();
    }

    function copyStepData(sourceId, targetId) {
        const sourceData = { ...sequenceData[sourceId] };
        ['note', 'octave', 'waveform', 'volume'].forEach(key => {
            sequenceData[targetId][key] = sourceData[key];
        });
        updatePlaybackBlockDisplay(targetId);
        markAsDirty();
    }

    function toggleFxSlot(fxId) {
        const slot = fxSlots.find(s => s.id === fxId);
        if (!slot) return;
        slot.isActive = !slot.isActive;
        updateFxSlotButton(fxId);
        connectFxSlot(slot);
        markAsDirty();
    }

    async function handleFxTypeChange() {
        const newType = fxTypeSelect.value;
        const slot = currentlyEditingFxSlot;
        if (!slot || slot.effectType === newType) return;
        slot.effectType = newType;
        const paramDefs = effectDefinitions[newType].params;
        slot.params = {};
        for (const paramKey in paramDefs) {
            slot.params[paramKey] = paramDefs[paramKey].value;
        }
        if (effectDefinitions[newType].createNode) {
            slot.node = await effectDefinitions[newType].createNode(audioCtx);
            slot.node.type = newType;
        } else {
            slot.node = null;
        }
        populateFxParams();
    }

    async function saveFxSlotChanges() {
        const slot = currentlyEditingFxSlot;
        if (!slot) return;
    
        if (slot.effectType === 'delay') {
            const switchInput = fxParamsContainer.querySelector('input[data-param-key="syncMode"]');
            slot.params.syncMode = switchInput.checked ? 'time' : 'bpm';
    
            slot.params.mix = parseFloat(fxParamsContainer.querySelector('input[data-param-key="mix"]').value);
            slot.params.feedback = parseFloat(fxParamsContainer.querySelector('input[data-param-key="feedback"]').value);
    
            if (slot.params.syncMode === 'time') {
                slot.params.time = parseFloat(fxParamsContainer.querySelector('input[data-param-key="time"]').value);
            } else { // 'bpm'
                const rateGroup = fxParamsContainer.querySelector('.button-selector-group[data-param-key="rate"]');
                const activeButton = rateGroup.querySelector('button.active');
                if (activeButton) {
                    slot.params.rate = parseFloat(activeButton.dataset.value);
                }
            }
        } else {
            fxParamsContainer.querySelectorAll('input[type="range"]').forEach(slider => {
                slot.params[slider.dataset.paramKey] = parseFloat(slider.value);
            });
            fxParamsContainer.querySelectorAll('.button-selector-group').forEach(group => {
                const paramKey = group.dataset.paramKey;
                const activeButton = group.querySelector('button.active');
                if (activeButton) {
                    slot.params[paramKey] = parseFloat(activeButton.dataset.value);
                }
            });
        }
    
        if (!slot.node || slot.node.type !== slot.effectType) {
            if (effectDefinitions[slot.effectType].createNode) {
                slot.node = await effectDefinitions[slot.effectType].createNode(audioCtx);
                slot.node.type = slot.effectType;
            } else {
                slot.node = null;
            }
        }
        
        applyFxParams(slot);
        updateAllFxConnections();
        updateFxSlotButton(slot.id);
        closeFxEditModal();
        markAsDirty();
    }

    function adjustBpm(step) {
        let newValue = (parseInt(bpmInput.value) || 120) + step;
        bpmInput.value = Math.max(20, Math.min(300, newValue));
    }

    function navigateButtonGroup(container, direction) {
        const buttons = Array.from(container.querySelectorAll('button'));
        const activeButton = container.querySelector('button.active');
        let currentIndex = buttons.findIndex(btn => btn === activeButton);
        if (currentIndex === -1) currentIndex = 0; else currentIndex += direction;
        if (currentIndex >= buttons.length) currentIndex = 0; else if (currentIndex < 0) currentIndex = buttons.length - 1;
        buttons[currentIndex].click();
    }

    // =================================================================================
    // 7. 初期化処理
    // =================================================================================

    function setupEventListeners() {
        playOnceButton.onclick = () => handlePlay(false);
        playLoopButton.onclick = () => handlePlay(true);
        stopButton.onclick = stopAllSounds;
        bulkEditTriggerButton.onclick = openBulkEditModal;
        randomGenerateTriggerButton.onclick = openRandomGenerateModal;
        loadDataButton.onclick = openLoadPresetModal;
        bpmAdjustButtons.forEach(button => button.addEventListener('click', () => {
            adjustBpm(parseInt(button.dataset.step));
            updateActiveBpmSyncFx();
            markAsDirty();
        }));
        bpmInput.addEventListener('change', () => {
            bpmInput.value = Math.max(20, Math.min(300, parseInt(bpmInput.value) || 120));
            updateActiveBpmSyncFx();
            markAsDirty();
        });
        setupDragAndDropListeners();
        setupModalListeners(editModal, closeEditModal);
        setupModalListeners(bulkEditModal, closeBulkEditModal);
        setupModalListeners(randomGenerateModal, closeRandomGenerateModal);
        setupModalListeners(loadPresetModal, closeLoadPresetModal);
        setupModalListeners(fxEditModal, closeFxEditModal);
        setupModalListeners(renamePresetModal, () => closeModalHelper(renamePresetModal));
        fxModalCompleteButton.onclick = saveFxSlotChanges;
        fxTypeSelect.onchange = handleFxTypeChange;
        document.getElementById('modal-complete-button').onclick = saveSingleStepChanges;
        document.getElementById('modal-play-test-button').onclick = playTestFromSingleEditModal;
        document.getElementById('bulk-modal-apply-button').onclick = applyBulkChanges;
        document.getElementById('rg-execute-button').onclick = executeRandomGeneration;
        document.getElementById('search-box').addEventListener('input', populatePresetListFromFirestore);
        presetMenuButton.addEventListener('click', togglePresetActionMenu);
        document.getElementById('rename-preset-save-button').onclick = handleRenamePreset;
        presetActionMenu.addEventListener('click', handlePresetAction);
        document.addEventListener('click', (e) => {
            if (!presetActionMenu.contains(e.target) && !presetMenuButton.contains(e.target)) {
                presetActionMenu.style.display = 'none';
            }
        });
        setupKeyboardShortcuts();
    }

    init();
});