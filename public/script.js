document.addEventListener('DOMContentLoaded', async () => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioCtx) {
        alert("Web Audio API not supported.");
        return;
    }

    // Firebase configuration from server
    let firebaseConfig = null;
    try {
        const response = await fetch('/api/firebase-config');
        if (response.ok) {
            firebaseConfig = await response.json();
        } else {
            const errorData = await response.json();
            console.error('Firebase configuration error:', errorData);
            alert('Firebase設定の取得に失敗しました。管理者にお問い合わせください。');
            return;
        }
    } catch (error) {
        console.error('Failed to fetch Firebase config:', error);
        alert('Firebase設定の取得に失敗しました。ネットワーク接続を確認してください。');
        return;
    }

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const auth = firebase.auth();

    // DOM Elements
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const saveDataButton = document.getElementById('save-data-button');
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

    // Effects DOM Elements
    const reverbSwitch = document.getElementById('reverb-switch');
    const reverbMixSlider = document.getElementById('reverb-mix');
    const delaySwitch = document.getElementById('delay-switch');
    const delayMixSlider = document.getElementById('delay-mix');
    const delaySettingsContainer = document.getElementById('delay-settings');
    const delayTimeSlider = document.getElementById('delay-time');
    const delayFeedbackSlider = document.getElementById('delay-feedback');

    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationModalMessage = document.getElementById('confirmation-modal-message');
    const confirmButton = document.getElementById('confirmation-modal-confirm-button');
    const cancelButton = document.getElementById('confirmation-modal-cancel-button');
    const alternativeButton = document.getElementById('confirmation-modal-alternative-button');

    let currentOnConfirm = null;

    function updateSliderFill(slider) {
        if (!slider) return;
        const min = slider.min ? parseFloat(slider.min) : 0;
        const max = slider.max ? parseFloat(slider.max) : 100;
        const value = parseFloat(slider.value);
        const percentage = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--fill-percent', `${percentage}%`);
    }

    function showConfirmationModal(message, onConfirm, options = {}) {
        confirmationModalMessage.textContent = message;
        
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            closeConfirmationModal();
        };

        if (options.onAlternative) {
            alternativeButton.style.display = 'inline-block';
            alternativeButton.textContent = options.alternativeText || '選択肢';
            alternativeButton.onclick = () => {
                options.onAlternative();
                closeConfirmationModal();
            };
        } else {
            alternativeButton.style.display = 'none';
        }

        confirmButton.textContent = options.confirmText || 'OK';
        cancelButton.textContent = options.cancelText || 'キャンセル';

        if (options.isDanger) {
            confirmButton.classList.add('danger');
        } else {
            confirmButton.classList.remove('danger');
        }

        openModal(confirmationModal);
    }

    function closeConfirmationModal() {
        closeModalHelper(confirmationModal);
        alternativeButton.style.display = 'none';
        alternativeButton.onclick = null;
    }

    function showLoginPromptModal() {
        showConfirmationModal(
            'この機能を利用するにはGoogleアカウントでのログインが必要です。',
            () => {
                const provider = new firebase.auth.GoogleAuthProvider();
                auth.signInWithPopup(provider).catch(error => {
                    if (error.code !== 'auth/popup-closed-by-user') {
                        showToast(`ログインに失敗しました: ${error.message}`, 'error');
                    }
                });
            },
            { confirmText: 'Googleでログイン', cancelText: 'キャンセル' }
        );
    }

    cancelButton.onclick = closeConfirmationModal;
    setupModalListeners(confirmationModal, closeConfirmationModal);

    // Modals
    const editModal = document.getElementById('edit-modal');
    const bulkEditModal = document.getElementById('bulk-edit-modal');
    const randomGenerateModal = document.getElementById('random-generate-modal');
    const savePresetModal = document.getElementById('save-preset-modal');
    const loadPresetModal = document.getElementById('load-preset-modal');

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

    // Audio Effects Nodes
    const effects = {
        masterGain: null,
        reverb: { node: null, wetGain: null, dryGain: null },
        delay: { node: null, wetGain: null, dryGain: null, feedback: null }
    };

    const noteOffsets = { 'C': 0, 'C♯': 1, 'D♭': 1, 'D': 2, 'D♯': 3, 'E♭': 3, 'E': 4, 'F': 5, 'F♯': 6, 'G♭': 6, 'G': 7, 'G♯': 8, 'A♭': 8, 'A': 9, 'A♯': 10, 'B♭': 10, 'B': 11 };
    const displayNotes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const octaves = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const waveforms = { 'sine': '正弦波', 'square': '矩形波', 'sawtooth': 'ノコギリ波', 'triangle': '三角波' };
    const noteDurations = [
        { value: 0.25, label: "16分" }, { value: 1 / 3, label: "1拍3連" }, { value: 0.5, label: "8分" },
        { value: 2 / 3, label: "2拍3連" }, { value: 1, label: "4分" }, { value: 2, label: "2分" }, { value: 4, label: "全音符" }
    ];
    const chordTypes = {
        'major': { name: 'メジャー', intervals: [0, 4, 7] }, 'minor': { name: 'マイナー', intervals: [0, 3, 7] },
        'dominant7th': { name: 'ドミナント7th', intervals: [0, 4, 7, 10] }, 'major7th': { name: 'メジャー7th', intervals: [0, 4, 7, 11] },
        'minor7th': { name: 'マイナー7th', intervals: [0, 3, 7, 10] }, 'diminished': { name: 'ディミニッシュ', intervals: [0, 3, 6] },
        'augmented': { name: 'オーギュメント', intervals: [0, 4, 8] }, 'sus4': { name: 'サスフォー', intervals: [0, 5, 7] },
        'majorPentatonic': { name: '���ジャーペンタ', intervals: [0, 2, 4, 7, 9] }, 'minorPentatonic': { name: 'マイナーペンタ', intervals: [0, 3, 5, 7, 10] },
    };

    async function init() {
        await setupAudioEffects();
        createPlaybackBlocks();
        setupUIComponents();
        setupEventListeners();
        initAuth();
        loadLocalBackup();
        document.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
    }

    async function setupAudioEffects() {
        effects.masterGain = audioCtx.createGain();
        const destination = audioCtx.createGain();
        destination.connect(audioCtx.destination);

        // --- Reverb Setup ---
        effects.reverb.node = audioCtx.createConvolver();
        effects.reverb.wetGain = audioCtx.createGain();
        effects.reverb.dryGain = audioCtx.createGain();
        effects.reverb.node.buffer = await createReverbIR();
        effects.masterGain.connect(effects.reverb.dryGain);
        effects.masterGain.connect(effects.reverb.node).connect(effects.reverb.wetGain);
        effects.reverb.dryGain.connect(destination);
        effects.reverb.wetGain.connect(destination);

        // --- Delay Setup ---
        effects.delay.node = audioCtx.createDelay(1.0);
        effects.delay.wetGain = audioCtx.createGain();
        effects.delay.dryGain = audioCtx.createGain();
        effects.delay.feedback = audioCtx.createGain();
        effects.reverb.wetGain.connect(effects.delay.dryGain);
        effects.reverb.dryGain.connect(effects.delay.dryGain);
        effects.delay.dryGain.connect(destination);
        effects.delay.dryGain.connect(effects.delay.node);
        effects.delay.node.connect(effects.delay.feedback);
        effects.delay.feedback.connect(effects.delay.node);
        effects.delay.node.connect(effects.delay.wetGain);
        effects.delay.wetGain.connect(destination);

        // Initial gain values
        effects.reverb.wetGain.gain.value = 0;
        effects.delay.wetGain.gain.value = 0;
        effects.delay.node.delayTime.value = parseFloat(delayTimeSlider.value);
        effects.delay.feedback.gain.value = parseFloat(delayFeedbackSlider.value);
    }

    async function createReverbIR() {
        const sampleRate = audioCtx.sampleRate;
        const length = sampleRate * 2;
        const impulse = audioCtx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        for (let i = 0; i < length; i++) {
            left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
            right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
        }
        return impulse;
    }

    function setupUIComponents() {
        const waveformKeys = Object.keys(waveforms);
        generateButtonSelectors(document.getElementById('modal-note-buttons'), displayNotes, 'note', (val) => val.replace('♯', '#'));
        generateButtonSelectors(document.getElementById('modal-octave-buttons'), octaves, 'octave');
        generateButtonSelectors(document.getElementById('modal-waveform-buttons'), waveformKeys, 'waveform', (key) => waveforms[key]);
        generateButtonSelectors(document.getElementById('bulk-modal-note-buttons'), displayNotes, 'note', (val) => val.replace('♯', '#'));
        generateButtonSelectors(document.getElementById('bulk-modal-octave-buttons'), octaves, 'octave');
        generateButtonSelectors(document.getElementById('bulk-modal-waveform-buttons'), waveformKeys, 'waveform', (key) => waveforms[key]);
        createSettingsButtonGroup(sequenceMaxButtonsContainer, Array.from({ length: 16 }, (_, i) => i + 1), (val) => { currentSequenceMax = parseInt(val); }, currentSequenceMax);
        createSettingsButtonGroup(noteDurationButtonsContainer, noteDurations, (val) => { currentNoteDuration = parseFloat(val); }, currentNoteDuration, 'value', 'label');
        populateRandomGenerateModalControls();
    }

    function setupEventListeners() {
        playOnceButton.onclick = () => handlePlay(false);
        playLoopButton.onclick = () => handlePlay(true);
        stopButton.onclick = stopAllSounds;
        bulkEditTriggerButton.onclick = openBulkEditModal;
        randomGenerateTriggerButton.onclick = openRandomGenerateModal;
        saveDataButton.onclick = openSavePresetModal;
        loadDataButton.onclick = openLoadPresetModal;

        bpmAdjustButtons.forEach(button => button.addEventListener('click', () => adjustBpm(parseInt(button.dataset.step))));
        bpmInput.addEventListener('change', () => bpmInput.value = Math.max(20, Math.min(300, parseInt(bpmInput.value) || 120)));

        setupDragAndDropListeners();
        setupEffectEventListeners();

        setupModalListeners(editModal, closeEditModal);
        setupModalListeners(bulkEditModal, closeBulkEditModal);
        setupModalListeners(randomGenerateModal, closeRandomGenerateModal);
        setupModalListeners(savePresetModal, closeSavePresetModal);
        setupModalListeners(loadPresetModal, closeLoadPresetModal);

        document.getElementById('modal-volume').oninput = (e) => {
            document.getElementById('modal-volume-display').textContent = `${e.target.value}%`;
            updateSliderFill(e.target);
        };
        document.getElementById('modal-complete-button').onclick = saveSingleStepChanges;
        document.getElementById('modal-play-test-button').onclick = playTestFromSingleEditModal;
        
        const bulkVolumeSlider = document.getElementById('bulk-modal-volume');
        const bulkVolumeDisplay = document.getElementById('bulk-modal-volume-display');
        bulkVolumeSlider.oninput = () => {
            bulkVolumeDisplay.textContent = `${bulkVolumeSlider.value}%`;
            bulkVolumeSlider.dataset.isSetForBulk = "true";
            bulkVolumeSlider.style.opacity = 1;
            bulkVolumeDisplay.style.opacity = 1;
            updateSliderFill(bulkVolumeSlider);
        };
        document.getElementById('bulk-modal-apply-button').onclick = applyBulkChanges;
        document.getElementById('bulk-clear-volume-button').onclick = () => {
            bulkVolumeSlider.value = 50;
            bulkVolumeDisplay.textContent = '50%';
            bulkVolumeSlider.dataset.isSetForBulk = "false";
            bulkVolumeSlider.style.opacity = 0.5;
            bulkVolumeDisplay.style.opacity = 0.5;
        };

        document.getElementById('rg-execute-button').onclick = executeRandomGeneration;
        document.getElementById('save-preset-button').onclick = saveOrUpdatePresetInFirestore;
        document.getElementById('search-box').addEventListener('input', populatePresetListFromFirestore);
        setupKeyboardShortcuts();
    }

    function setupEffectEventListeners() {
        reverbSwitch.addEventListener('change', (e) => {
            reverbMixSlider.disabled = !e.target.checked;
            effects.reverb.wetGain.gain.setValueAtTime(e.target.checked ? parseFloat(reverbMixSlider.value) : 0, audioCtx.currentTime);
        });
        reverbMixSlider.addEventListener('input', (e) => {
            effects.reverb.wetGain.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
            updateSliderFill(e.target);
        });

        delaySwitch.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            delayMixSlider.disabled = !isEnabled;
            delayTimeSlider.disabled = !isEnabled;
            delayFeedbackSlider.disabled = !isEnabled;
            delaySettingsContainer.style.display = isEnabled ? 'block' : 'none';
            effects.delay.wetGain.gain.setValueAtTime(isEnabled ? parseFloat(delayMixSlider.value) : 0, audioCtx.currentTime);
        });
        delayMixSlider.addEventListener('input', (e) => {
            effects.delay.wetGain.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
            updateSliderFill(e.target);
        });
        delayTimeSlider.addEventListener('input', (e) => {
            effects.delay.node.delayTime.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
            updateSliderFill(e.target);
        });
        delayFeedbackSlider.addEventListener('input', (e) => {
            effects.delay.feedback.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
            updateSliderFill(e.target);
        });
    }

    function setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const activeElement = document.activeElement;
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName) && !activeElement.type === 'range';
            if (isTyping) return;

            const isModalActive = document.querySelector('.modal.active');
            if (isModalActive && e.key !== 'Escape') return;

            switch (e.key) {
                case ' ':
                    if (isPlaying) stopButton.click(); else playLoopButton.click();
                    e.preventDefault();
                    break;
                case 'Enter': playOnceButton.click(); e.preventDefault(); break;
                case 'ArrowUp': adjustBpm(e.shiftKey ? 10 : 1); e.preventDefault(); break;
                case 'ArrowDown': adjustBpm(e.shiftKey ? -10 : -1); e.preventDefault(); break;
                case 'ArrowRight': navigateButtonGroup(e.shiftKey ? sequenceMaxButtonsContainer : noteDurationButtonsContainer, 1); e.preventDefault(); break;
                case 'ArrowLeft': navigateButtonGroup(e.shiftKey ? sequenceMaxButtonsContainer : noteDurationButtonsContainer, -1); e.preventDefault(); break;
                case 'Escape':
                    if (isModalActive) isModalActive.querySelector('.close-button').click();
                    else if (isPlaying) stopButton.click();
                    e.preventDefault();
                    break;
                case 'r': case 'R': randomGenerateTriggerButton.click(); break;
                case 'b': case 'B': bulkEditTriggerButton.click(); break;
                case 's': case 'S': saveDataButton.click(); break;
                case 'l': case 'L': loadDataButton.click(); break;
            }
        });
    }

    function navigateButtonGroup(container, direction) {
        const buttons = Array.from(container.querySelectorAll('button'));
        const activeButton = container.querySelector('button.active');
        let currentIndex = buttons.findIndex(btn => btn === activeButton);
        if (currentIndex === -1) currentIndex = 0; else currentIndex += direction;
        if (currentIndex >= buttons.length) currentIndex = 0; else if (currentIndex < 0) currentIndex = buttons.length - 1;
        buttons[currentIndex].click();
    }

    function setupDragAndDropListeners() {
        playbackGrid.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('playback-block')) {
                dragSrcElement = e.target;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', e.target.innerHTML);
                e.target.classList.add('dragging');
            }
        });
        playbackGrid.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.playback-block');
            if (target && target !== dragSrcElement) target.classList.add('drag-over');
        });
        playbackGrid.addEventListener('dragleave', (e) => {
            const target = e.target.closest('.playback-block');
            if (target) target.classList.remove('drag-over');
        });
        playbackGrid.addEventListener('dragend', (e) => e.target.classList.remove('dragging'));
        playbackGrid.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetElement = e.target.closest('.playback-block');
            if (!targetElement || !dragSrcElement || targetElement === dragSrcElement) {
                if(targetElement) targetElement.classList.remove('drag-over');
                return;
            }
            targetElement.classList.remove('drag-over');
            const sourceId = parseInt(dragSrcElement.dataset.id);
            const targetId = parseInt(targetElement.dataset.id);
            showConfirmationModal(
                `ステップ${sourceId + 1}のデータをステップ${targetId + 1}と入れ替えますか？`,
                () => { swapStepData(sourceId, targetId); showToast(`ステップ${sourceId + 1}と${targetId + 1}を入れ替えました`, 'success'); },
                {
                    confirmText: '入れ替え', cancelText: 'キャンセル',
                    onAlternative: () => { copyStepData(sourceId, targetId); showToast(`ステップ${sourceId + 1}をステップ${targetId + 1}に上書きしました`, 'success'); },
                    alternativeText: '上書き'
                }
            );
            dragSrcElement = null;
        });
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
        markAsUnsaved();
        saveLocalBackup();
    }

    function copyStepData(sourceId, targetId) {
        const sourceData = { ...sequenceData[sourceId] };
        ['note', 'octave', 'waveform', 'volume'].forEach(key => {
            sequenceData[targetId][key] = sourceData[key];
        });
        updatePlaybackBlockDisplay(targetId);
        markAsUnsaved();
        saveLocalBackup();
    }

    function setupModalListeners(modalElement, closeFn) {
        modalElement.querySelector('.close-button').onclick = closeFn;
        window.addEventListener('click', (event) => {
            if (event.target == modalElement) closeFn();
        });
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

    function updatePlaybackBlockDisplay(id) {
        const data = sequenceData[id];
        const el = data.playbackElements;
        el.noteDisplay.textContent = `${data.note.replace('♯', '#')}${data.octave}`;
        el.waveDisplay.textContent = waveforms[data.waveform] || data.waveform;
        el.volumeBar.style.width = `${data.volume * 100}%`;
    }

    function handlePlay(loop) {
        if (isPlaying) stopAllSounds();
        const start = () => {
            isPlaying = true;
            isLooping = loop;
            currentStep = 0;
            document.querySelectorAll('.playback-block.playing').forEach(el => el.classList.remove('playing'));
            scheduleNextStep();
        };
        if (audioCtx.state === 'suspended') audioCtx.resume().then(start);
        else start();
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

    function stopAllSounds() {
        isPlaying = false;
        isLooping = false;
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

    function playSound(data, duration, startTime = audioCtx.currentTime) {
        if (data.volume === 0) return;
        const freq = getFrequency(data.note, data.octave);
        if (freq === 0) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = data.waveform;
        osc.frequency.setValueAtTime(freq, startTime);
        const attack = 0.01;
        const release = Math.min(0.04, duration * 0.3);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(data.volume, startTime + attack);
        if (startTime + duration - release > startTime + attack) {
            gain.gain.setValueAtTime(data.volume, startTime + duration - release);
        }
        gain.gain.linearRampToValueAtTime(0, startTime + duration);
        
        osc.connect(gain).connect(effects.masterGain);

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

    function getFrequency(noteName, octave) {
        const noteVal = noteOffsets[noteName.replace('#', '♯')];
        if (noteVal === undefined) return 0;
        const midiNote = (octave + 1) * 12 + noteVal;
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function highlightPlaybackBlock(blockId, duration) {
        const el = sequenceData[blockId]?.playbackElements?.blockElement;
        if (el) {
            el.classList.add('playing');
            setTimeout(() => el.classList.remove('playing'), duration * 1000);
        }
    }

    function openModal(modalElement) {
        modalElement.style.display = "flex";
        setTimeout(() => modalElement.classList.add('active'), 10);
    }

    function closeModalHelper(modalElement) {
        modalElement.classList.remove('active');
        setTimeout(() => modalElement.style.display = "none", 300);
    }

    function openEditModal(id) {
        currentlyEditingStepId = id;
        const data = sequenceData[id];
        document.getElementById('modal-title').textContent = `ステップ ${id + 1} 編集`;
        setActiveButtonInGroup(document.getElementById('modal-note-buttons'), data.note);
        setActiveButtonInGroup(document.getElementById('modal-octave-buttons'), data.octave);
        setActiveButtonInGroup(document.getElementById('modal-waveform-buttons'), data.waveform);
        const volumeSlider = document.getElementById('modal-volume');
        volumeSlider.value = data.volume * 100;
        updateSliderFill(volumeSlider);
        document.getElementById('modal-volume-display').textContent = `${Math.round(data.volume * 100)}%`;
        openModal(editModal);
    }
    function closeEditModal() { closeModalHelper(editModal); currentlyEditingStepId = null; }

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
        markAsUnsaved();
        saveLocalBackup();
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

    function openBulkEditModal() {
        [document.getElementById('bulk-modal-note-buttons'), document.getElementById('bulk-modal-octave-buttons'), document.getElementById('bulk-modal-waveform-buttons')]
            .forEach(container => container.querySelectorAll('button.active').forEach(btn => btn.classList.remove('active')));
        const bulkVolumeSlider = document.getElementById('bulk-modal-volume');
        bulkVolumeSlider.value = 50;
        document.getElementById('bulk-modal-volume-display').textContent = '50%';
        bulkVolumeSlider.dataset.isSetForBulk = "false";
        bulkVolumeSlider.style.opacity = 0.5;
        document.getElementById('bulk-modal-volume-display').style.opacity = 0.5;
        updateSliderFill(bulkVolumeSlider);
        openModal(bulkEditModal);
    }
    function closeBulkEditModal() { closeModalHelper(bulkEditModal); }

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
        markAsUnsaved();
        saveLocalBackup();
    }

    function openRandomGenerateModal() { openModal(randomGenerateModal); }
    function closeRandomGenerateModal() { closeModalHelper(randomGenerateModal); }

    function executeRandomGeneration() {
        currentlyLoadedPresetDocId = null;
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
    }

    const LOCAL_BACKUP_KEY = 'oscbot_local_backup';

    function applyState(state) {
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
    }

    function saveLocalBackup() {
        try {
            const backup = {
                sequenceData: sequenceData.map(({ note, octave, waveform, volume }) => ({ note, octave, waveform, volume })),
                bpm: parseInt(bpmInput.value),
                noteDuration: currentNoteDuration,
                sequenceMax: currentSequenceMax,
                timestamp: new Date().getTime()
            };
            localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup));
        } catch (e) {
            console.error("Error saving local backup:", e);
        }
    }

    function loadLocalBackup() {
        try {
            const backupJSON = localStorage.getItem(LOCAL_BACKUP_KEY);
            if (!backupJSON) {
                updatePresetStatus(null);
                return;
            }
            const backup = JSON.parse(backupJSON);
            const oneDay = 24 * 60 * 60 * 1000;
            if (new Date().getTime() - backup.timestamp > oneDay) {
                clearLocalBackup();
                updatePresetStatus(null);
                return;
            }
            showConfirmationModal(
                '前回エディタを閉じたときの未保存のシーケンスがあります。復元しますか？',
                () => {
                    applyState(backup);
                    markAsUnsaved();
                    showToast('シーケンスを復元しました。', 'success');
                }
            );
        } catch (e) {
            console.error("Error loading local backup:", e);
            clearLocalBackup();
        }
    }

    function clearLocalBackup() {
        localStorage.removeItem(LOCAL_BACKUP_KEY);
    }

    function markAsUnsaved() {
        let statusText;
        const baseName = (currentPresetStatus.textContent || '').replace(/\s*\*$/, '').replace(/^[\u2713\s]*/, '');
        if (currentlyLoadedPresetDocId && baseName) {
            statusText = `${baseName} *`;
        } else {
            statusText = '未保存のシーケンス *';
        }
        updatePresetStatus(statusText, false);
    }

    function updatePresetStatus(text, isSaved) {
        if (text) {
            currentPresetStatus.textContent = text;
            if (isSaved) {
                currentPresetStatus.textContent = `✓ ${text}`;
            }
            presetStatusContainer.style.display = 'block';
        } else {
            currentPresetStatus.textContent = '';
            presetStatusContainer.style.display = 'none';
        }
    }

    async function openSavePresetModal() {
        if (!currentUser) {
            showLoginPromptModal();
            return;
        }
        const presetNameInput = document.getElementById('preset-name');
        const presetDescriptionInput = document.getElementById('preset-description');
        const presetTagsInput = document.getElementById('preset-tags');
        const saveButton = document.getElementById('save-preset-button');
        
        delete savePresetModal.dataset.editingId;
        const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
        if(existingOverwriteBtn) existingOverwriteBtn.remove();

        if (currentlyLoadedPresetDocId) {
            try {
                const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(currentlyLoadedPresetDocId);
                const doc = await docRef.get();
                if (doc.exists) {
                    const preset = doc.data();
                    const overwriteButton = document.createElement('button');
                    overwriteButton.id = 'overwrite-preset-button';
                    overwriteButton.textContent = `「${preset.name}」に上書き保存`;
                    overwriteButton.className = 'modal-main-action-button';
                    overwriteButton.style.backgroundColor = '#e67e22';
                    overwriteButton.onclick = () => overwritePresetInFirestore(currentlyLoadedPresetDocId);
                    saveButton.parentNode.insertBefore(overwriteButton, saveButton);
                }
            } catch (e) {
                console.error("Error fetching preset for overwrite button:", e);
            }
        }
        
        presetNameInput.value = '';
        presetDescriptionInput.value = '';
        presetTagsInput.value = '';
        saveButton.textContent = '新規プリセットとして保存';
        openModal(savePresetModal);
    }

    function closeSavePresetModal() {
        const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
        if(existingOverwriteBtn) existingOverwriteBtn.remove();
        closeModalHelper(savePresetModal);
    }

    async function saveOrUpdatePresetInFirestore() {
        if (!currentUser) {
            showToast('ログインが必要です。', 'error');
            return;
        }
        const name = document.getElementById('preset-name').value.trim();
        if (!name) {
            showToast('プリセット名は必須です。', 'error');
            return;
        }
        const editingId = savePresetModal.dataset.editingId;
        const presetData = {
            name: name,
            description: document.getElementById('preset-description').value.trim(),
            tags: document.getElementById('preset-tags').value.trim().split(',').map(t => t.trim()).filter(t => t),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        try {
            const userPresetsRef = db.collection('users').doc(currentUser.uid).collection('presets');
            if (editingId) {
                await userPresetsRef.doc(editingId).update(presetData);
                showToast('プリセット情報を更新しました。', 'success');
                updatePresetStatus(presetData.name, true);
            } else {
                presetData.sequenceData = sequenceData.map(({ note, octave, waveform, volume }) => ({ note, octave, waveform, volume }));
                presetData.bpm = parseInt(bpmInput.value);
                presetData.noteDuration = currentNoteDuration;
                presetData.sequenceMax = currentSequenceMax;
                presetData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                const docRef = await userPresetsRef.add(presetData);
                currentlyLoadedPresetDocId = docRef.id;
                showToast('プリセットを新規保存しました。', 'success');
                updatePresetStatus(presetData.name, true);
                clearLocalBackup();
            }
            closeSavePresetModal();
        } catch (error) {
            showToast(`保存に失敗しました: ${error.message}` , 'error');
            console.error("Error saving preset: ", error);
        }
    }
    
    async function overwritePresetInFirestore(presetId) {
        if (!currentUser || !presetId) return;
        const presetUpdateData = {
            sequenceData: sequenceData.map(({ note, octave, waveform, volume }) => ({ note, octave, waveform, volume })),
            bpm: parseInt(bpmInput.value),
            noteDuration: currentNoteDuration,
            sequenceMax: currentSequenceMax,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        try {
            const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(presetId);
            await docRef.update(presetUpdateData);
            const updatedDoc = await docRef.get();
            const presetName = updatedDoc.data().name;
            showToast(`「${presetName}」を上書き保存しました。`, 'success');
            updatePresetStatus(presetName, true);
            clearLocalBackup();
            closeSavePresetModal();
        } catch (error) {
            showToast(`上書き保存に失敗しました: ${error.message}`, 'error');
            console.error("Error overwriting preset: ", error);
        }
    }

    function openLoadPresetModal() {
        if (!currentUser) {
            showLoginPromptModal();
            return;
        }
        populatePresetListFromFirestore();
        openModal(loadPresetModal);
    }
    function closeLoadPresetModal() { closeModalHelper(loadPresetModal); }

    async function populatePresetListFromFirestore() {
        if (!currentUser) return;
        const presetList = document.getElementById('preset-list');
        const noResultsMessage = document.getElementById('no-results-message');
        const searchTerm = document.getElementById('search-box').value.toLowerCase();
        presetList.innerHTML = '読み込み中...';
        
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('presets').orderBy('updatedAt', 'desc').get();
            const presets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const filteredPresets = presets.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.description && p.description.toLowerCase().includes(searchTerm)));

            presetList.innerHTML = '';
            if (filteredPresets.length > 0) {
                filteredPresets.forEach(preset => {
                    const item = document.createElement('li');
                    item.className = 'preset-list-item';
                    item.innerHTML = `
                        <h3>${preset.name}</h3>
                        <p>${preset.description || '説明なし'}</p>
                        <div class="tags">${(preset.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
                        <div class="actions">
                            <button class="action-button edit">編集</button>
                            <button class="action-button delete">削除</button>
                            <button class="action-button load">読込</button>
                        </div>
                    `;
                    item.querySelector('.load').onclick = (e) => { e.stopPropagation(); loadPresetFromFirestore(preset.id); };
                    item.querySelector('.edit').onclick = (e) => { e.stopPropagation(); openEditPresetMetadataModal(preset.id); };
                    item.querySelector('.delete').onclick = (e) => { e.stopPropagation(); deletePresetFromFirestore(preset.id, preset.name); };
                    presetList.appendChild(item);
                });
                noResultsMessage.style.display = 'none';
            } else {
                noResultsMessage.style.display = 'block';
            }
        } catch (error) {
            presetList.innerHTML = 'プリセットの読み込みに失敗しました。';
            showToast('プリセットの読み込みに失敗しました。', 'error');
            console.error("Error populating presets: ", error);
        }
    }

    async function openEditPresetMetadataModal(presetId) {
        if (!currentUser) return;
        try {
            const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(presetId);
            const doc = await docRef.get();
            if (!doc.exists) {
                showToast('編集対象のプリセットが見つかりません。', 'error');
                return;
            }
            const preset = doc.data();
            document.getElementById('preset-name').value = preset.name;
            document.getElementById('preset-description').value = preset.description || '';
            document.getElementById('preset-tags').value = (preset.tags || []).join(', ');
            document.getElementById('save-preset-button').textContent = '変更を保存';
            savePresetModal.dataset.editingId = presetId;
            
            const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
            if(existingOverwriteBtn) existingOverwriteBtn.remove();

            openModal(savePresetModal);
        } catch (error) {
            showToast('プリセット情報の取得に失���しました。', 'error');
        }
    }

    async function loadPresetFromFirestore(presetId) {
        if (!currentUser) return;
        try {
            const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(presetId);
            const doc = await docRef.get();
            if (!doc.exists) {
                showToast('プリセットが見つかりません。', 'error'); return;
            }
            const preset = doc.data();
            applyState(preset);
            
            currentlyLoadedPresetDocId = presetId;
            updatePresetStatus(preset.name, true);
            clearLocalBackup();
            showToast(`「${preset.name}」を読み込みました。`, 'success');
            closeLoadPresetModal();
        } catch (error) {
            showToast(`プリセットの読み込みに失敗しました: ${error.message}`, 'error');
            console.error("Error loading preset:", error);
        }
    }

    async function deletePresetFromFirestore(presetId, presetName) {
        if (!currentUser) return;

        showConfirmationModal(
            `本当にプリセッ��「${presetName}」を削除しますか？この操作は取り消せません。`,
            async () => {
                try {
                    await db.collection('users').doc(currentUser.uid).collection('presets').doc(presetId).delete();
                    showToast('プリセットを削除しました。', 'success');
                    if (currentlyLoadedPresetDocId === presetId) {
                        currentlyLoadedPresetDocId = null;
                        updatePresetStatus(null);
                    }
                    populatePresetListFromFirestore();
                } catch (error) {
                    showToast(`プリセットの削除に失敗しました: ${error.message}`, 'error');
                    console.error("Error deleting preset:", error);
                }
            },
            { isDanger: true }
        );
    }

    function initAuth() {
        auth.onAuthStateChanged(user => {
            if (user) {
                currentUser = user;
                showUserInfo(user);
            } else {
                currentUser = null;
                hideUserInfo();
            }
        });
    }

    function showUserInfo(user) {
        const displayName = user.displayName || `ユーザー`;
        userName.textContent = `${displayName}さん`;
        if (user.photoURL) {
            const userIcon = document.createElement('img');
            userIcon.src = user.photoURL;
            userName.insertBefore(userIcon, userName.firstChild);
        }
        loginButton.style.display = 'none';
        userInfo.style.display = 'flex';
    }

    function hideUserInfo() {
        loginButton.style.display = 'block';
        userInfo.style.display = 'none';
    }

    loginButton.addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(error => {
            if (error.code !== 'auth/popup-closed-by-user') {
                showToast('ログインに失敗しました: ' + error.message, 'error');
            }
        });
    });

    logoutButton.addEventListener('click', () => {
        showConfirmationModal(
            '本当にログアウトしますか？', 
            () => auth.signOut(),
            { isDanger: true }
        );
    });

    function generateButtonSelectors(container, items, groupName, displayFn = (val) => val) {
        container.innerHTML = '';
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.value = item;
            button.textContent = displayFn(item);
            button.onclick = (e) => {
                const isMultiSelect = container.id.startsWith('bulk-') || container.id.startsWith('rg-');
                if (isMultiSelect && !container.id.includes('waveform')) {
                    if (e.target.classList.contains('active')) e.target.classList.remove('active');
                    else {
                        container.querySelectorAll('button.active').forEach(btn => btn.classList.remove('active'));
                        e.target.classList.add('active');
                    }
                } else {
                    container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                    e.target.classList.add('active');
                }
            };
            container.appendChild(button);
        });
    }

    function createSettingsButtonGroup(container, items, stateVarSetter, defaultValue, valueKey = 'value', labelKey = 'label') {
        container.innerHTML = '';
        items.forEach(item => {
            const button = document.createElement('button');
            const itemValue = typeof item === 'object' ? item[valueKey] : item;
            button.dataset.value = itemValue;
            button.textContent = typeof item === 'object' ? item[labelKey] : item;
            if (itemValue === defaultValue) button.classList.add('active');
            button.onclick = () => {
                stateVarSetter(itemValue);
                container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
            };
            container.appendChild(button);
        });
    }

    function setActiveButtonInGroup(container, value) {
        container.querySelectorAll('button').forEach(btn => {
            const btnValue = isNaN(parseFloat(btn.dataset.value)) ? btn.dataset.value : parseFloat(btn.dataset.value);
            const targetValue = isNaN(parseFloat(value)) ? value : parseFloat(value);
            btn.classList.toggle('active', btnValue === targetValue);
        });
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

    function adjustBpm(step) {
        let newValue = (parseInt(bpmInput.value) || 120) + step;
        bpmInput.value = Math.max(20, Math.min(300, newValue));
    }

    init();
});