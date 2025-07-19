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
    const manualSaveButton = document.getElementById('manual-save-button');
    const footerSaveButton = document.getElementById('footer-save-button');
    const newPresetButton = document.getElementById('new-preset-button');
    const fxSlotsContainer = document.getElementById('fx-slots-container');
    const fxEditModal = document.getElementById('fx-edit-modal');
    const fxModalTitle = document.getElementById('fx-modal-title');
    const fxTypeSelect = document.getElementById('fx-type-select');
    const fxParamsContainer = document.getElementById('fx-params-container');
    const fxModalCompleteButton = document.getElementById('fx-modal-complete-button');

    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationModalMessage = document.getElementById('confirmation-modal-message');
    const confirmButton = document.getElementById('confirmation-modal-confirm-button');
    const cancelButton = document.getElementById('confirmation-modal-cancel-button');
    const alternativeButton = document.getElementById('confirmation-modal-alternative-button');

    function updateSliderFill(slider) {
        if (!slider) return;
        const min = slider.min ? parseFloat(slider.min) : 0;
        const max = slider.max ? parseFloat(slider.max) : 100;
        const value = parseFloat(slider.value);
        const percentage = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--fill-percent', `${percentage}%`);
    }

    function showConfirmationModal(message, onConfirm, options = {}) {
        confirmationModalMessage.innerHTML = message.replace(/\n/g, '<br>');

        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            closeModalHelper(confirmationModal);
        };

        cancelButton.onclick = () => {
            if (options.onCancel) {
                options.onCancel();
            }
            closeModalHelper(confirmationModal);
        };

        if (options.onAlternative) {
            alternativeButton.style.display = 'inline-block';
            alternativeButton.textContent = options.alternativeText || '選択肢';
            alternativeButton.onclick = () => {
                if (options.onAlternative) options.onAlternative();
                closeModalHelper(confirmationModal);
            };
        } else {
            alternativeButton.style.display = 'none';
        }
        
        confirmButton.textContent = options.confirmText || 'OK';
        cancelButton.textContent = options.cancelText || 'キャンセル';
        confirmButton.classList.toggle('danger', !!options.isDanger);
        openModal(confirmationModal);
    }
    setupModalListeners(confirmationModal, () => closeModalHelper(confirmationModal));

    function showLoginPromptModal() {
        showConfirmationModal('この機能を利用するにはGoogleアカウントでのログインが必要です。', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(error => {
                if (error.code !== 'auth/popup-closed-by-user') showToast(`ログインに失敗しました: ${error.message}`, 'error');
            });
        }, { confirmText: 'Googleでログイン', cancelText: 'キャンセル' });
    }

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
    let nextStepTime = 0;
    let activeOscillators = [];
    let currentlyEditingStepId = null;
    let dragSrcElement = null;
    let currentSequenceMax = 16;
    let currentNoteDuration = 1;
    let currentlyLoadedPresetDocId = null;
    let currentlyEditingFxSlot = null;
    let autoSaveTimer = null;

    const masterGain = audioCtx.createGain();

    let fxSlots = [
        { 
            id: 'B', 
            name: 'FX B', 
            node: null, 
            bypassNode: null, 
            isActive: false, 
            effectType: 'delay', 
            params: { mix: 0.5, time: 0.25, feedback: 0.4, syncMode: 'bpm', rate: 4 } 
        },
        { 
            id: 'C', 
            name: 'FX C', 
            node: null, 
            bypassNode: null, 
            isActive: false, 
            effectType: 'reverb', 
            params: { mix: 0.5 } 
        },
        { 
            id: 'D', 
            name: 'FX D', 
            node: null, 
            bypassNode: null, 
            isActive: false, 
            effectType: 'none', 
            params: {} 
        }
    ];

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
                    label: 'Rate',
                    type: 'buttons',
                    value: 4, // Default to 1/16
                    options: [
                        { value: 0.5, label: '2分' },
                        { value: 0.75, label: '2分3連符' },
                        { value: 1, label: '4分' },
                        { value: 1 / 1.5, label: '付点4分'},
                        { value: 1.5, label: '4分3連符' },
                        { value: 2, label: '8分' },
                        { value: 2 / 1.5, label: '付点8分'},
                        { value: 3, label: '8分3連符' },
                        { value: 4, label: '16分' },
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
                    label: 'Rate',
                    type: 'buttons',
                    value: 4, // Default to 1/16
                    options: [
                        { value: 1, label: '4分' },
                        { value: 1.5, label: '4分3連符' },
                        { value: 2, label: '8分' },
                        { value: 2 / 1.5, label: '付点8分'},
                        { value: 3, label: '8分3連符' },
                        { value: 4, label: '16分' },
                        { value: 4 / 1.5, label: '付点16分'},
                        { value: 6, label: '16分3連符' },
                        { value: 8, label: '32分' },
                    ]
                }
            },
            createNode: (ctx) => {
                const slicerGain = ctx.createGain();
                const lfo = ctx.createOscillator();
                const lfoGain = ctx.createGain();
                const dcOffset = ctx.createConstantSource();

                lfo.type = 'square';
                slicerGain.gain.value = 0; // Start with 0 gain, modulated by LFO

                lfo.connect(lfoGain);
                lfoGain.connect(slicerGain.gain);
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

    async function init() {
        await setupAudioRouting();
        await initializeFxNodes();
        createPlaybackBlocks();
        setupUIComponents();
        setupEventListeners();
        initAuth();
        loadLocalBackup();
        document.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
    }

    async function initializeFxNodes() {
        for (const slot of fxSlots) {
            if (slot.effectType !== 'none' && effectDefinitions[slot.effectType].createNode) {
                slot.node = await effectDefinitions[slot.effectType].createNode(audioCtx);
                slot.node.type = slot.effectType;
                applyFxParams(slot);
            } else {
                slot.node = null;
            }
        }
        updateAllFxConnections();
    }

    async function setupAudioRouting() {
        let currentNode = masterGain;
        for (const slot of fxSlots) {
            slot.bypassNode = audioCtx.createGain();
            currentNode.connect(slot.bypassNode);
            currentNode = slot.bypassNode;
        }
        currentNode.connect(audioCtx.destination);
    }

    function connectFxSlot(slot) {
        const previousNode = fxSlots.indexOf(slot) === 0 ? masterGain : fxSlots[fxSlots.indexOf(slot) - 1].bypassNode;
        previousNode.disconnect();
        if (slot.isActive && slot.effectType !== 'none' && slot.node) {
            if (slot.effectType === 'reverb') {
                const { convolver, wetGain, dryGain } = slot.node;
                previousNode.connect(dryGain).connect(slot.bypassNode);
                previousNode.connect(convolver).connect(wetGain).connect(slot.bypassNode);
            } else if (slot.effectType === 'delay') {
                const { delay, feedback, wetGain, dryGain } = slot.node;
                previousNode.connect(dryGain).connect(slot.bypassNode);
                previousNode.connect(delay);
                delay.connect(wetGain).connect(slot.bypassNode);
                delay.connect(feedback).connect(delay);
            } else if (slot.effectType === 'slicer') {
                const { slicerGain } = slot.node;
                previousNode.connect(slicerGain).connect(slot.bypassNode);
            }
        } else {
            previousNode.connect(slot.bypassNode);
        }
    }

    function updateAllFxConnections() {
        fxSlots.forEach(connectFxSlot);
    }

    function setupUIComponents() {
        const waveformKeys = Object.keys(waveforms);
        generateButtonSelectors(document.getElementById('modal-note-buttons'), displayNotes, 'note', (val) => val.replace('♯', '#'));
        generateButtonSelectors(document.getElementById('modal-octave-buttons'), octaves, 'octave');
        generateButtonSelectors(document.getElementById('modal-waveform-buttons'), waveformKeys, 'waveform', (key) => waveforms[key]);
        generateButtonSelectors(document.getElementById('bulk-modal-note-buttons'), displayNotes, 'note', (val) => val.replace('♯', '#'));
        generateButtonSelectors(document.getElementById('bulk-modal-octave-buttons'), octaves, 'octave');
        generateButtonSelectors(document.getElementById('bulk-modal-waveform-buttons'), waveformKeys, 'waveform', (key) => waveforms[key]);
        createSettingsButtonGroup(sequenceMaxButtonsContainer, Array.from({ length: 16 }, (_, i) => i + 1), (val) => { currentSequenceMax = parseInt(val); markAsDirty(); }, currentSequenceMax);
        createSettingsButtonGroup(noteDurationButtonsContainer, noteDurations, (val) => { currentNoteDuration = parseFloat(val); markAsDirty(); }, currentNoteDuration, 'value', 'label');
        populateRandomGenerateModalControls();
        createFxSlotButtons();
    }

    function setupEventListeners() {
        playOnceButton.onclick = () => handlePlay(false);
        playLoopButton.onclick = () => handlePlay(true);
        stopButton.onclick = stopAllSounds;
        bulkEditTriggerButton.onclick = openBulkEditModal;
        randomGenerateTriggerButton.onclick = openRandomGenerateModal;
        loadDataButton.onclick = openLoadPresetModal;
        newPresetButton.onclick = () => openNewPresetModal(false);
        manualSaveButton.onclick = manualSave;
        footerSaveButton.onclick = manualSave;
        currentPresetStatus.addEventListener('click', () => {
            if (currentlyLoadedPresetDocId && currentUser) {
                openEditPresetMetadataModal(currentlyLoadedPresetDocId);
            }
        });
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
        setupModalListeners(savePresetModal, closeSavePresetModal);
        setupModalListeners(loadPresetModal, closeLoadPresetModal);
        setupModalListeners(fxEditModal, closeFxEditModal);
        fxModalCompleteButton.onclick = saveFxSlotChanges;
        fxTypeSelect.onchange = handleFxTypeChange;
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
            updateSliderFill(bulkVolumeSlider);
        };
        document.getElementById('rg-execute-button').onclick = executeRandomGeneration;
        document.getElementById('save-preset-button').onclick = saveOrUpdatePresetInFirestore;
        document.getElementById('search-box').addEventListener('input', populatePresetListFromFirestore);
        setupSaveModalListeners();
        setupKeyboardShortcuts();
    }

    function addTag(label) {
        const tagContainer = document.getElementById('tag-display-container');
        const currentTags = Array.from(tagContainer.querySelectorAll('.tag-badge span:first-child')).map(t => t.textContent);
        if (currentTags.includes(label) || currentTags.length >= 10) { // Prevent duplicates and limit tags
            return;
        }
        const tagBadge = document.createElement('div');
        tagBadge.className = 'tag-badge';
        tagBadge.innerHTML = `<span>${label}</span><span class="remove-tag">×</span>`;
        tagContainer.appendChild(tagBadge);
    }

    function setupSaveModalListeners() {
        const nameInput = document.getElementById('preset-name');
        const saveButton = document.getElementById('save-preset-button');
        const tagsInput = document.getElementById('preset-tags-input');
        const tagContainer = document.getElementById('tag-display-container');

        nameInput.addEventListener('input', () => {
            saveButton.disabled = nameInput.value.trim() === '';
        });

        tagsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && tagsInput.value.trim() !== '') {
                e.preventDefault();
                addTag(tagsInput.value.trim());
                tagsInput.value = '';
            }
        });

        tagContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-tag')) {
                e.target.parentElement.remove();
            }
        });
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
                pressTimer = setTimeout(() => {
                    openFxEditModal(slot.id);
                    pressTimer = null;
                }, 500);
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

    function updateFxSlotButton(fxId) {
        const slot = fxSlots.find(s => s.id === fxId);
        const button = fxSlotsContainer.querySelector(`[data-fx-id="${fxId}"]`);
        if (!slot || !button) return;
        button.classList.toggle('active', slot.isActive);
        button.querySelector('.fx-type-name').textContent = effectDefinitions[slot.effectType].name;
    }

    function toggleFxSlot(fxId) {
        const slot = fxSlots.find(s => s.id === fxId);
        if (!slot) return;
        slot.isActive = !slot.isActive;
        updateFxSlotButton(fxId);
        connectFxSlot(slot);
        markAsDirty();
    }

    function openFxEditModal(fxId) {
        currentlyEditingFxSlot = fxSlots.find(s => s.id === fxId);
        if (!currentlyEditingFxSlot) return;
        fxModalTitle.textContent = `${currentlyEditingFxSlot.name} 設定`;
        fxTypeSelect.innerHTML = Object.keys(effectDefinitions).map(type => `<option value="${type}">${effectDefinitions[type].name}</option>`).join('');
        fxTypeSelect.value = currentlyEditingFxSlot.effectType;
        populateFxParams();
        openModal(fxEditModal);
    }

    function closeFxEditModal() {
        closeModalHelper(fxEditModal);
        currentlyEditingFxSlot = null;
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

    function populateFxParams() {
        const slot = currentlyEditingFxSlot;
        fxParamsContainer.innerHTML = '';
        if (!slot || slot.effectType === 'none') return;
    
        const paramDefs = effectDefinitions[slot.effectType].params;
    
        if (slot.effectType === 'delay') {
            const currentParams = slot.params;
            
            const createSlider = (paramKey, def) => {
                const val = currentParams[paramKey] ?? def.value;
                const wrapper = document.createElement('div');
                wrapper.className = 'fx-param-control';
                wrapper.innerHTML = `
                    <label>${def.label}</label>
                    <div class="slider-wrapper">
                        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param-key="${paramKey}">
                        <span>${val}</span>
                    </div>
                `;
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
            switchWrapper.innerHTML = `
                <span class="toggle-label">Time (秒数で指定)</span>
                <label class="toggle-switch">
                    <input type="checkbox" data-param-key="syncMode">
                    <span class="toggle-slider"></span>
                </label>
            `;
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
    
        } else { // Original behavior for other effects
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
                    sliderWrapper.innerHTML = `
                        <input type="range" min="${paramDef.min}" max="${paramDef.max}" step="${paramDef.step}" value="${currentValue}" data-param-key="${paramKey}">
                        <span>${currentValue}</span>`;
                    const slider = sliderWrapper.querySelector('input[type="range"]');
                    const valueDisplay = sliderWrapper.querySelector('span');
                    slider.oninput = () => {
                        valueDisplay.textContent = slider.value;
                        updateSliderFill(slider);
                    };
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
                        if (opt.value == currentValue) {
                            button.classList.add('active');
                        }
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
        const activeBpmFx = fxSlots.filter(s => s.isActive && 
            (s.effectType === 'slicer' || (s.effectType === 'delay' && s.params.syncMode === 'bpm'))
        );
        activeBpmFx.forEach(applyFxParams);
    }

    function setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const activeElement = document.activeElement;
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName) && !activeElement.type === 'range';
            if (isTyping) return;
            const isModalActive = document.querySelector('.modal.active');
            if (isModalActive && e.key !== 'Escape') return;
            switch (e.key) {
                case ' ': if (isPlaying) stopButton.click(); else playLoopButton.click(); e.preventDefault(); break;
                case 'Enter': playOnceButton.click(); e.preventDefault(); break;
                case 'ArrowUp': adjustBpm(e.shiftKey ? 10 : 1); e.preventDefault(); break;
                case 'ArrowDown': adjustBpm(e.shiftKey ? -10 : -1); e.preventDefault(); break;
                case 'ArrowRight': navigateButtonGroup(e.shiftKey ? sequenceMaxButtonsContainer : noteDurationButtonsContainer, 1); e.preventDefault(); break;
                case 'ArrowLeft': navigateButtonGroup(e.shiftKey ? sequenceMaxButtonsContainer : noteDurationButtonsContainer, -1); e.preventDefault(); break;
                case 'Escape': if (isModalActive) isModalActive.querySelector('.close-button').click(); else if (isPlaying) stopButton.click(); e.preventDefault(); break;
                case 'r': case 'R': randomGenerateTriggerButton.click(); break;
                case 'b': case 'B': bulkEditTriggerButton.click(); break;
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
            showConfirmationModal(`ステップ${sourceId + 1}のデータをステップ${targetId + 1}と入れ替えますか？`,
                () => { swapStepData(sourceId, targetId); },
                { confirmText: '入れ替え', cancelText: 'キャンセル', onAlternative: () => { copyStepData(sourceId, targetId); }, alternativeText: '上書き' }
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
            nextStepTime = audioCtx.currentTime + 0.05; // Add a small buffer
            document.querySelectorAll('.playback-block.playing').forEach(el => el.classList.remove('playing'));
            scheduleNextStep();
        };
        if (audioCtx.state === 'suspended') audioCtx.resume().then(start);
        else start();
    }

    function scheduleNextStep() {
        if (!isPlaying) return;

        const bpmVal = parseFloat(bpmInput.value);
        const stepDurSec = (60 / bpmVal) * currentNoteDuration;

        while (nextStepTime < audioCtx.currentTime + 0.1) {
            if (currentStep >= currentSequenceMax) {
                if (isLooping) {
                    currentStep = 0;
                } else {
                    stopAllSounds();
                    return;
                }
            }

            const data = sequenceData[currentStep];
            // 視覚的な遅延を補正するために、音声の再生を50ミリ秒遅らせる
            const audioDelay = 0.1;
            highlightPlaybackBlock(currentStep, stepDurSec, nextStepTime);
            playSound(data, stepDurSec, nextStepTime + audioDelay);

            nextStepTime += stepDurSec;
            currentStep++;
        }

        if (isPlaying) {
            sequenceTimeoutId = setTimeout(scheduleNextStep, 25);
        }
    }

    let previewTimeoutId = null;
    let activePreviewOscillators = [];

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
        stopPresetPreview(); // Stop preview as well
    }

    function stopPresetPreview() {
        if (previewTimeoutId) clearTimeout(previewTimeoutId);
        previewTimeoutId = null;
        const now = audioCtx.currentTime;
        activePreviewOscillators.forEach(({ gainNode }) => {
            try {
                gainNode.gain.cancelScheduledValues(now);
                gainNode.gain.setValueAtTime(gainNode.gain.value, now);
                gainNode.gain.linearRampToValueAtTime(0, now + 0.02);
            } catch (e) { /* ignore */ }
        });
        activePreviewOscillators = [];
        // Also remove visual indicator from preview button
        document.querySelectorAll('.action-button.preview.playing').forEach(btn => {
            btn.classList.remove('playing');
            btn.innerHTML = '<i class="fa-solid fa-play"></i> 試聴';
        });
    }

    function playPresetPreview(preset) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const isCurrentlyPlaying = activePreviewOscillators.length > 0;

        stopPresetPreview();

        if (isCurrentlyPlaying) {
            return; 
        }

        const previewButton = event.target.closest('.action-button.preview');
        if (previewButton) {
            previewButton.classList.add('playing');
            previewButton.innerHTML = '<i class="fa-solid fa-stop"></i> 停止';
        }

        let localCurrentStep = 0;
        let localNextStepTime = audioCtx.currentTime + 0.05;
        const sequence = preset.sequenceData || [];
        const maxSteps = preset.sequenceMax || 16;
        const noteDur = preset.noteDuration || 1;
        const bpm = preset.bpm || 120;

        const schedule = () => {
            const stepDurSec = (60 / bpm) * noteDur;

            while (localNextStepTime < audioCtx.currentTime + 0.1) {
                if (localCurrentStep >= maxSteps) {
                    stopPresetPreview();
                    return;
                }

                const data = sequence[localCurrentStep];
                if (data && data.volume > 0) {
                    const freq = getFrequency(data.note, data.octave);
                    if (freq > 0) {
                        const osc = audioCtx.createOscillator();
                        const gain = audioCtx.createGain();
                        osc.type = data.waveform;
                        osc.frequency.setValueAtTime(freq, localNextStepTime);
                        
                        const attack = 0.01;
                        const release = Math.min(0.04, stepDurSec * 0.3);
                        gain.gain.setValueAtTime(0, localNextStepTime);
                        gain.gain.linearRampToValueAtTime(data.volume, localNextStepTime + attack);
                        if (localNextStepTime + stepDurSec - release > localNextStepTime + attack) {
                            gain.gain.setValueAtTime(data.volume, localNextStepTime + stepDurSec - release);
                        }
                        gain.gain.linearRampToValueAtTime(0, localNextStepTime + stepDurSec);
                        
                        osc.connect(gain).connect(masterGain);
                        osc.start(localNextStepTime);
                        osc.stop(localNextStepTime + stepDurSec + 0.01);
                        
                        const active = { oscillator: osc, gainNode: gain };
                        activePreviewOscillators.push(active);
                        setTimeout(() => {
                            activePreviewOscillators = activePreviewOscillators.filter(o => o !== active);
                        }, (stepDurSec + 0.1) * 1000);
                    }
                }
                
                localNextStepTime += stepDurSec;
                localCurrentStep++;
            }
            
            if (localCurrentStep < maxSteps && activePreviewOscillators.length > 0) {
                previewTimeoutId = setTimeout(schedule, 25);
            } else {
                previewTimeoutId = setTimeout(stopPresetPreview, stepDurSec * 1000);
            }
        };

        schedule();
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

    function getFrequency(noteName, octave) {
        const noteVal = noteOffsets[noteName.replace('#', '♯')];
        if (noteVal === undefined) return 0;
        const midiNote = (octave + 1) * 12 + noteVal;
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function highlightPlaybackBlock(blockId, duration, startTime) {
        const el = sequenceData[blockId]?.playbackElements?.blockElement;
        if (el) {
            const highlightDelay = (startTime - audioCtx.currentTime) * 1000;
            setTimeout(() => {
                el.classList.add('playing');
                setTimeout(() => el.classList.remove('playing'), duration * 1000);
            }, Math.max(0, highlightDelay));
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
        markAsDirty();
    }

    function openRandomGenerateModal() { openModal(randomGenerateModal); }
    function closeRandomGenerateModal() { closeModalHelper(randomGenerateModal); }

    async function createNewPreset(isSavingCurrentState, onSaveCompleteCallback = null) { // isSavingCurrentState is kept for compatibility but is effectively always true now
        if (!currentUser) {
            showToast('ログインが必要です。', 'error');
            return;
        }
        const name = document.getElementById('preset-name').value.trim();
        if (!name) {
            showToast('プリセット名は必須です。', 'error');
            return;
        }

        // タグ入力フィールドに残っている内容を自動的に追加
        const tagsInput = document.getElementById('preset-tags-input');
        if (tagsInput.value.trim() !== '') {
            addTag(tagsInput.value.trim());
            tagsInput.value = '';
        }

        const tagContainer = document.getElementById('tag-display-container');
        const tags = Array.from(tagContainer.querySelectorAll('.tag-badge span:first-child')).map(t => t.textContent);

        // The logic is now unified: we always save the current state to a new document.
        if (!isSavingCurrentState) {
            // This block is now less likely to be used, but kept for safety.
            resetSequencerToDefault();
        }

        const newPresetData = {
            name: name,
            description: document.getElementById('preset-description').value.trim(),
            tags: tags,
            ...getCurrentState(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        try {
            const docRef = await db.collection('users').doc(currentUser.uid).collection('presets').add(newPresetData);
            currentlyLoadedPresetDocId = docRef.id;
            showToast(`プリセット「${name}」を作成しました。`, 'success');
            updatePresetStatus(name, true);
            clearLocalBackup();
            closeSavePresetModal();
            if (onSaveCompleteCallback) onSaveCompleteCallback();
        } catch (error) {
            showToast(`プリセットの作成に失敗しました: ${error.message}`, 'error');
            console.error("Error creating new preset: ", error);
        }
    }

    function resetSequencerToDefault() {
        // This function resets the state of the sequencer to its initial values
        sequenceData.forEach((step, i) => {
            Object.assign(step, {
                note: 'A',
                octave: 4,
                waveform: 'sawtooth',
                volume: 0.5,
            });
            updatePlaybackBlockDisplay(i);
        });
        bpmInput.value = 120;
        currentNoteDuration = 1;
        setActiveButtonInGroup(noteDurationButtonsContainer, currentNoteDuration);
        currentSequenceMax = 16;
        setActiveButtonInGroup(sequenceMaxButtonsContainer, currentSequenceMax);
        // You might want to reset FX slots as well
        // fxSlots.forEach(slot => { ... });
        // initializeFxNodes();
    }

    function openNewPresetModal(isSavingCurrentState = false, onSaveCompleteCallback = null) {
        if (!currentUser) {
            showLoginPromptModal();
            return;
        }

        const action = () => {
            const presetNameInput = document.getElementById('preset-name');
            const presetDescriptionInput = document.getElementById('preset-description');
            const tagContainer = document.getElementById('tag-display-container');
            const tagsInput = document.getElementById('preset-tags-input');
            const saveButton = document.getElementById('save-preset-button');
            const modalTitle = savePresetModal.querySelector('h3');

            delete savePresetModal.dataset.editingId;
            const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
            if (existingOverwriteBtn) existingOverwriteBtn.remove();

            if (isSavingCurrentState) {
                modalTitle.textContent = '名前を付けて保存';
                saveButton.textContent = '保存';
            } else {
                modalTitle.textContent = '新規プリセット作成';
                saveButton.textContent = '作成して保存';
            }

            presetNameInput.value = '';
            presetDescriptionInput.value = '';
            tagContainer.innerHTML = '';
            tagsInput.value = '';
            saveButton.disabled = true;

            saveButton.onclick = () => createNewPreset(true, onSaveCompleteCallback);

            openModal(savePresetModal);
        };

        const hasUnsavedChanges = currentPresetStatus.textContent.includes('*');
        if (!isSavingCurrentState && hasUnsavedChanges) {
            showConfirmationModal(
                '新規作成します。\n現在の編集内容は保存しますか？',
                () => { // onConfirm: Save and Continue
                    manualSave(() => {
                        resetSequencerToDefault();
                        updatePresetStatus('新規シーケンス', false, false);
                        clearLocalBackup();
                    });
                },
                {
                    confirmText: '保存して続行',
                    onCancel: () => { // onCancel: Discard and Continue
                        resetSequencerToDefault();
                        updatePresetStatus('新規シーケンス', false, false);
                        clearLocalBackup();
                        action();
                    },
                    cancelText: '破棄して続行',
                    onAlternative: () => { /* Do nothing, just close the modal */ },
                    alternativeText: 'キャンセル',
                    isDanger: false
                }
            );
        } else {
            action();
        }
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

    const LOCAL_BACKUP_KEY = 'oscbot_local_backup';

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

    function getCurrentState() {
        return {
            sequenceData: sequenceData.map(({ note, octave, waveform, volume }) => ({ note, octave, waveform, volume })),
            bpm: parseInt(bpmInput.value),
            noteDuration: currentNoteDuration,
            sequenceMax: currentSequenceMax,
            fxSlots: fxSlots.map(slot => ({
                isActive: slot.isActive,
                effectType: slot.effectType,
                params: slot.params
            }))
        };
    }

    function saveLocalBackup() {
        try {
            const backup = {
                ...getCurrentState(),
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
                updatePresetStatus('新規シーケンス');
                return;
            }
            const backup = JSON.parse(backupJSON);
            const lastSaved = new Date(backup.timestamp).toLocaleString();

            showConfirmationModal(
                `未保存の作業データが見つかりました。（最終更新: ${lastSaved}）復元しますか？`,
                () => { // onConfirm: Restore
                    applyState(backup);
                    markAsDirty();
                    showToast('作業を復元しました。', 'info');
                },
                {
                    onCancel: () => { // onCancel: Discard
                        clearLocalBackup();
                        showToast('バックアップを破棄しました。', 'info');
                        updatePresetStatus('新規シーケンス', false, false);
                    },
                    confirmText: '復元する',
                    cancelText: '破棄する'
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

    function markAsDirty() {
    saveLocalBackup();
    if (currentlyLoadedPresetDocId) {
        updatePresetStatus(currentPresetStatus.textContent, false, true);
    } else {
        updatePresetStatus('新規シーケンス', false, true);
    }

    // Auto-save only for loaded presets
    if (!currentUser || !currentlyLoadedPresetDocId) return;

    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => performSave(true), 10000);
}

    function manualSave(onSaveCompleteCallback = null) {
        // If not logged in, the modal will handle the login prompt.
        // We always intend to save the current state when this button is pressed.
        if (!currentUser) {
            openNewPresetModal(true);
            return;
        }

        if (currentlyLoadedPresetDocId) {
            // A preset is loaded. Show options: Overwrite or Save As.
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            
            showConfirmationModal(
                '現在のプリセットの保存方法を選択してください',
                () => { // onConfirm: Overwrite
                    performSave(false, onSaveCompleteCallback);
                },
                {
                    onAlternative: () => { // onAlternative: Save As...
                        openNewPresetModal(true);
                    },
                    confirmText: '上書き保存',
                    alternativeText: '別名で保存',
                    cancelText: 'キャンセル'
                }
            );
        } else {
            // This is a new, unsaved sequence. Open the "Save As" modal.
            openNewPresetModal(true, onSaveCompleteCallback);
        }
    }

    async function performSave(isAutoSave, onSaveCompleteCallback = null) {
        if (!currentUser || !currentlyLoadedPresetDocId) return;
        
        const statusTextBeforeSave = currentPresetStatus.textContent;
        updatePresetStatus('保存中...', false);

        try {
            const state = getCurrentState();
            const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(currentlyLoadedPresetDocId);
            await docRef.update({ ...state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            
            const presetName = (await docRef.get()).data().name;
            updatePresetStatus(presetName, true);
            if (!isAutoSave) {
                showToast(`「${presetName}」を保存しました。`, 'success');
            }
            clearLocalBackup();
            if (onSaveCompleteCallback) onSaveCompleteCallback();
        } catch (error) {
            showToast(`保存に失敗: ${error.message}`, 'error');
            console.error("Save error: ", error);
            updatePresetStatus(statusTextBeforeSave.replace('保存中...', ''), false, true);
        }
    }

    function updatePresetStatus(text, isSaved, isDirty = false) {
        const manualSaveButton = document.getElementById('manual-save-button');
        const footerSaveButton = document.getElementById('footer-save-button');
        let statusText = text || '新規シーケンス';
        const baseName = statusText.replace(/\s\*$/, '').replace(/^[\u2713\s]*/, '').replace(/^保存中.../, '');

        if (text === null) { // Explicitly hiding
            presetStatusContainer.style.display = 'none';
            return;
        }

        if (!currentUser && !isDirty) { // Not logged in and no changes
            presetStatusContainer.style.display = 'none';
            footerSaveButton.disabled = true;
            return;
        }

        if (isSaved) {
            statusText = `✓ ${baseName}`;
            manualSaveButton.textContent = '保存済み';
            manualSaveButton.disabled = true;
            footerSaveButton.disabled = true;
        } else if (text === '保存中...') {
            statusText = '保存中...';
            manualSaveButton.textContent = '保存中...';
            manualSaveButton.disabled = true;
            footerSaveButton.disabled = true;
        } else if (isDirty) {
            statusText = `${baseName} *`;
            manualSaveButton.textContent = '保存';
            manualSaveButton.disabled = false;
            footerSaveButton.disabled = false;
        } else { // Not dirty, not saved (e.g., just loaded)
            statusText = baseName;
            manualSaveButton.textContent = '保存';
            manualSaveButton.disabled = true; // Nothing to save yet
            footerSaveButton.disabled = true;
        }

        currentPresetStatus.textContent = statusText;
        presetStatusContainer.style.display = 'flex';
        currentPresetStatus.classList.toggle('editable', !!currentlyLoadedPresetDocId && !!currentUser);
    }

    async function openSavePresetModal(isForClone = false) {
        if (!currentUser) {
            showLoginPromptModal();
            return;
        }
        const presetNameInput = document.getElementById('preset-name');
        const presetDescriptionInput = document.getElementById('preset-description');
        const presetTagsInput = document.getElementById('preset-tags');
        const saveButton = document.getElementById('save-preset-button');
        const modalTitle = savePresetModal.querySelector('h3');

        delete savePresetModal.dataset.editingId;
        const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
        if(existingOverwriteBtn) existingOverwriteBtn.remove();

        if (isForClone && currentlyLoadedPresetDocId) {
            const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(currentlyLoadedPresetDocId);
            const doc = await docRef.get();
            if (doc.exists) {
                const preset = doc.data();
                modalTitle.textContent = '複製して保存';
                presetNameInput.value = `${preset.name} のコピー`;
                presetDescriptionInput.value = preset.description || '';
                presetTagsInput.value = (preset.tags || []).join(', ');
                saveButton.textContent = '複製を保存';
                saveButton.onclick = () => saveOrUpdatePresetInFirestore(false); // Force new creation
            }
        } else {
            // This path is for editing metadata from the load list
            // The logic is handled by openEditPresetMetadataModal
        }

        openModal(savePresetModal);
    }

    function closeSavePresetModal() {
        const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
        if(existingOverwriteBtn) existingOverwriteBtn.remove();
        closeModalHelper(savePresetModal);
    }

    async function saveOrUpdatePresetInFirestore(isUpdateOnly = true) {
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
        
        // タグ入力フィールドに残っている内容を自動的に追加
        const tagsInput = document.getElementById('preset-tags-input');
        if (tagsInput.value.trim() !== '') {
            addTag(tagsInput.value.trim());
            tagsInput.value = '';
        }
        
        const tagContainer = document.getElementById('tag-display-container');
        const tags = Array.from(tagContainer.querySelectorAll('.tag-badge span:first-child')).map(t => t.textContent);

        const presetData = {
            name: name,
            description: document.getElementById('preset-description').value.trim(),
            tags: tags,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        try {
            const userPresetsRef = db.collection('users').doc(currentUser.uid).collection('presets');
            if (isUpdateOnly && editingId) {
                await userPresetsRef.doc(editingId).update({ name: presetData.name, description: presetData.description, tags: presetData.tags });
                showToast('プリセット情報を更新しました。', 'success');
                if (editingId === currentlyLoadedPresetDocId) {
                    updatePresetStatus(presetData.name, true);
                }
                populatePresetListFromFirestore(); // Refresh the list
            } else {
                // This is for cloning/creating a new preset
                const fullPresetData = {
                    ...getCurrentState(),
                    ...presetData,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                const docRef = await userPresetsRef.add(fullPresetData);
                currentlyLoadedPresetDocId = docRef.id;
                showToast(`「${presetData.name}」を保存しました。`, 'success');
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
            ...getCurrentState(),
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
        presetList.innerHTML = '<div class="loading-spinner"></div>';
        
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('presets').orderBy('updatedAt', 'desc').get();
            const presets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const filteredPresets = presets.filter(p => 
                p.name.toLowerCase().includes(searchTerm) || 
                (p.description && p.description.toLowerCase().includes(searchTerm)) ||
                (p.tags && p.tags.some(t => t.toLowerCase().includes(searchTerm)))
            );

            presetList.innerHTML = '';
            if (filteredPresets.length > 0) {
                presetList.className = 'preset-grid';

                filteredPresets.forEach(preset => {
                    const item = document.createElement('div');
                    item.className = 'preset-card-item';

                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'preset-card-content';

                    const h3 = document.createElement('h3');
                    h3.textContent = preset.name;

                    const p = document.createElement('p');
                    p.textContent = preset.description || '説明なし';

                    const timestamp = document.createElement('span');
                    timestamp.className = 'preset-timestamp';
                    if (preset.updatedAt && preset.updatedAt.toDate) {
                        timestamp.textContent = `最終更新: ${preset.updatedAt.toDate().toLocaleString()}`;
                    }

                    const tagsDiv = document.createElement('div');
                    tagsDiv.className = 'tags';
                    if (preset.tags && preset.tags.length > 0) {
                        tagsDiv.innerHTML = preset.tags.map(t => `<span class="tag">${t}</span>`).join('');
                    }

                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'actions';

                    const previewButton = document.createElement('button');
                    previewButton.className = 'action-button preview';
                    previewButton.innerHTML = '<i class="fa-solid fa-play"></i> 試聴';
                    
                    const editButton = document.createElement('button');
                    editButton.className = 'action-button edit';
                    editButton.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
                    editButton.title = '名前やタグを編集';

                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'action-button delete';
                    deleteButton.innerHTML = '<i class="fa-solid fa-trash"></i>';
                    deleteButton.title = '削除';

                    const loadButton = document.createElement('button');
                    loadButton.className = 'action-button load';
                    loadButton.textContent = '読込';

                    actionsDiv.append(previewButton, editButton, deleteButton, loadButton);
                    contentDiv.append(h3, p, timestamp, tagsDiv, actionsDiv);
                    item.append(contentDiv);

                    previewButton.onclick = (e) => { e.stopPropagation(); playPresetPreview(preset); };
                    loadButton.onclick = (e) => { e.stopPropagation(); loadPresetFromFirestore(preset.id); };
                    editButton.onclick = (e) => { e.stopPropagation(); openEditPresetMetadataModal(preset.id); };
                    deleteButton.onclick = (e) => { e.stopPropagation(); deletePresetFromFirestore(preset.id, preset.name); };
                    
                    presetList.appendChild(item);
                });
                noResultsMessage.style.display = 'none';
            } else {
                presetList.className = 'preset-list';
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
            const modalTitle = savePresetModal.querySelector('h3');
            modalTitle.textContent = 'プリセット情報の編集';
            const nameInput = document.getElementById('preset-name');
            nameInput.value = preset.name;
            document.getElementById('preset-description').value = preset.description || '';
            
            const tagContainer = document.getElementById('tag-display-container');
            tagContainer.innerHTML = '';
            if (preset.tags) {
                preset.tags.forEach(tag => {
                    const tagBadge = document.createElement('div');
                    tagBadge.className = 'tag-badge';
                    tagBadge.innerHTML = `<span>${tag}</span><span class="remove-tag">×</span>`;
                    tagContainer.appendChild(tagBadge);
                });
            }

            const saveButton = document.getElementById('save-preset-button');
            saveButton.textContent = '変更を保存';
            saveButton.onclick = () => saveOrUpdatePresetInFirestore(true);
            saveButton.disabled = nameInput.value.trim() === '';
            savePresetModal.dataset.editingId = presetId;
            
            const existingOverwriteBtn = document.getElementById('overwrite-preset-button');
            if(existingOverwriteBtn) existingOverwriteBtn.remove();

            closeLoadPresetModal(); // Close the load modal first
            openModal(savePresetModal);
        } catch (error) {
            showToast('プリセット情報の取得に失敗しました。', 'error');
        }
    }

    async function loadPresetFromFirestore(presetId) {
        if (!currentUser) return;
        stopPresetPreview();
        try {
            const docRef = db.collection('users').doc(currentUser.uid).collection('presets').doc(presetId);
            const doc = await docRef.get();
            if (!doc.exists) {
                showToast('プリセットが見つかりません。', 'error'); return;
            }
            const preset = doc.data();
            await applyState(preset);
            
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
            `本当にプリセット「${presetName}」を削除しますか？この操作は取り消せません。`,
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

    // Hide loader and show app when initialization is complete
    const loadingOverlay = document.getElementById('loading-overlay');
    const sequencerApp = document.querySelector('.sequencer-app');
    loadingOverlay.style.opacity = '0';
    sequencerApp.classList.add('loaded');
    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500); // Match transition duration

    init();
});
