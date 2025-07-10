document.addEventListener('DOMContentLoaded', () => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioCtx) { alert("Web Audio API not supported."); return; }

    const noteOffsets = { 'C': 0, 'C♯': 1, 'D♭': 1, 'D': 2, 'D♯': 3, 'E♭': 3, 'E': 4, 'F': 5, 'F♯': 6, 'G♭': 6, 'G': 7, 'G♯': 8, 'A♭': 8, 'A': 9, 'A♯': 10, 'B♭': 10, 'B': 11 };
    const displayNotes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const octaves = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const waveforms = {
        'sine': '正弦波',
        'square': '矩形波',
        'sawtooth': 'ノコギリ波',
        'triangle': '三角波'
    };
    const waveformKeys = Object.keys(waveforms);
    const numBlocks = 16;
    const noteDurations = [
        { value: 0.25, label: "16分" }, { value: 1 / 3, label: "1拍3連" }, { value: 0.5, label: "8分" },
        { value: 2 / 3, label: "2拍3連" }, { value: 1, label: "4分" }, { value: 2, label: "2分" },
        { value: 4, label: "全音符" }
    ];
    const chordTypes = {
        'major': { name: 'メジャー', intervals: [0, 4, 7] },
        'minor': { name: 'マイナー', intervals: [0, 3, 7] },
        'dominant7th': { name: 'ドミナント7th', intervals: [0, 4, 7, 10] },
        'major7th': { name: 'メジャー7th', intervals: [0, 4, 7, 11] },
        'minor7th': { name: 'マイナー7th', intervals: [0, 3, 7, 10] },
        'diminished': { name: 'ディミニッシュ', intervals: [0, 3, 6] },
        'augmented': { name: 'オーギュメント', intervals: [0, 4, 8] },
        'sus4': { name: 'サスフォー', intervals: [0, 5, 7] },
        'majorPentatonic': { name: 'メジャーペンタ', intervals: [0, 2, 4, 7, 9] },
        'minorPentatonic': { name: 'マイナーペンタ', intervals: [0, 3, 5, 7, 10] },
    };

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

    const editModal = document.getElementById('edit-modal');
    const editModalCloseButton = editModal.querySelector('.close-button');
    const modalTitle = document.getElementById('modal-title');
    const modalNoteButtonsContainer = document.getElementById('modal-note-buttons');
    const modalOctaveButtonsContainer = document.getElementById('modal-octave-buttons');
    const modalWaveformButtonsContainer = document.getElementById('modal-waveform-buttons');
    const modalVolumeSlider = document.getElementById('modal-volume');
    const modalVolumeDisplay = document.getElementById('modal-volume-display');
    const modalPlayTestButton = document.getElementById('modal-play-test-button');
    const modalCompleteButton = document.getElementById('modal-complete-button');

    const bulkEditModal = document.getElementById('bulk-edit-modal');
    const bulkEditModalCloseButton = bulkEditModal.querySelector('.close-button');
    const bulkNoteButtonsContainer = document.getElementById('bulk-modal-note-buttons');
    const bulkOctaveButtonsContainer = document.getElementById('bulk-modal-octave-buttons');
    const bulkWaveformButtonsContainer = document.getElementById('bulk-modal-waveform-buttons');
    const bulkVolumeSlider = document.getElementById('bulk-modal-volume');
    const bulkVolumeDisplay = document.getElementById('bulk-modal-volume-display');
    const bulkApplyButton = document.getElementById('bulk-modal-apply-button');
    const bulkClearVolumeButton = document.getElementById('bulk-clear-volume-button');

    const randomGenerateModal = document.getElementById('random-generate-modal');
    const rgModalCloseButton = randomGenerateModal.querySelector('.close-button');
    const rgRootNoteButtonsContainer = document.getElementById('rg-root-note-buttons');
    const rgChordTypeSelect = document.getElementById('rg-chord-type');
    const rgOctaveMinButtonsContainer = document.getElementById('rg-octave-min-buttons');
    const rgOctaveMaxButtonsContainer = document.getElementById('rg-octave-max-buttons');
    const rgStepsButtonsContainer = document.getElementById('rg-steps-buttons');
    const rgExecuteButton = document.getElementById('rg-execute-button');

    let sequenceData = [];
    let currentStep = 0;
    let isPlaying = false;
    let isLooping = false;
    let sequenceTimeoutId = null;
    let activeOscillators = [];
    let currentlyEditingStepId = null;
    let currentSequenceMax = numBlocks;
    let currentNoteDuration = 1;

    function init() {
        generateButtonSelectors(modalNoteButtonsContainer, displayNotes, 'note', (val) => val.replace('♯', '#'));
        generateButtonSelectors(modalOctaveButtonsContainer, octaves, 'octave');
        generateButtonSelectors(modalWaveformButtonsContainer, waveformKeys, 'waveform', (key) => waveforms[key]);

        generateButtonSelectors(bulkNoteButtonsContainer, displayNotes, 'note', (val) => val.replace('♯', '#'));
        generateButtonSelectors(bulkOctaveButtonsContainer, octaves, 'octave');
        generateButtonSelectors(bulkWaveformButtonsContainer, waveformKeys, 'waveform', (key) => waveforms[key]);

        createSequenceMaxButtons();
        createNoteDurationButtons();
        populateRandomGenerateModalControls();
        createPlaybackBlocks();
        setupEventListeners();
    }

    function generateButtonSelectors(container, items, groupName, displayFn = (val) => val) {
        container.innerHTML = '';
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.value = item;
            button.textContent = displayFn(item);
            button.onclick = (e) => {
                const isBulkOrRandomContainer = container.id.startsWith('bulk-') || container.id.startsWith('rg-');
                if (isBulkOrRandomContainer && !container.id.includes('waveform')) {
                    if (container.id.startsWith('rg-')) {
                        handleSettingsButtonSelection(e.target, container);
                    } else {
                        if (e.target.classList.contains('active')) {
                            e.target.classList.remove('active');
                        } else {
                            container.querySelectorAll('button.active').forEach(btn => btn.classList.remove('active'));
                            e.target.classList.add('active');
                        }
                    }
                } else {
                    handleModalButtonSelection(e.target, container);
                }
            };
            container.appendChild(button);
        });
    }

    function handleModalButtonSelection(clickedButton, container) {
        container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
    }

    function handleSettingsButtonSelection(clickedButton, container) {
        container.querySelectorAll('button.active').forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
    }

    function setActiveButtonInGroup(container, value) {
        container.querySelectorAll('button').forEach(btn => {
            const btnValue = isNaN(parseFloat(btn.dataset.value)) ? btn.dataset.value : parseFloat(btn.dataset.value);
            const targetValue = isNaN(parseFloat(value)) ? value : parseFloat(value);
            btn.classList.toggle('active', btnValue === targetValue);
        });
    }

    function createSettingsButtonGroup(container, items, stateVarSetter, defaultValue, valueKey = 'value', labelKey = 'label') {
        container.innerHTML = '';
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            const itemValue = typeof item === 'object' ? item[valueKey] : item;
            const itemLabel = typeof item === 'object' ? item[labelKey] : item;

            button.dataset.value = itemValue;
            button.textContent = itemLabel;
            if (itemValue === defaultValue) {
                button.classList.add('active');
            }
            button.onclick = () => {
                stateVarSetter(itemValue);
                container.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
            };
            container.appendChild(button);
        });
    }

    function createSequenceMaxButtons() {
        const maxStepsOptions = Array.from({ length: numBlocks }, (_, i) => i + 1);
        createSettingsButtonGroup(
            sequenceMaxButtonsContainer,
            maxStepsOptions,
            (val) => { currentSequenceMax = parseInt(val); },
            currentSequenceMax
        );
    }

    function createNoteDurationButtons() {
        createSettingsButtonGroup(
            noteDurationButtonsContainer,
            noteDurations,
            (val) => { currentNoteDuration = parseFloat(val); },
            currentNoteDuration,
            'value', 'label'
        );
    }

    function createPlaybackBlocks() {
        playbackGrid.innerHTML = '';
        sequenceData = [];
        for (let i = 0; i < numBlocks; i++) {
            const playbackElements = createPlaybackBlockDOM(i);
            sequenceData.push({
                id: i,
                note: 'A',
                octave: 4,
                waveform: 'sawtooth',
                volume: 0.5,
                playbackElements: playbackElements
            });
            updatePlaybackBlockDisplay(i);
        }
    }

    function createPlaybackBlockDOM(id) {
        const block = document.createElement('div');
        block.classList.add('playback-block');
        block.dataset.id = id;
        block.onclick = () => openEditModal(id);

        const stepNumEl = document.createElement('span');
        stepNumEl.classList.add('step-number-pb'); stepNumEl.textContent = id + 1;

        const noteEl = document.createElement('div'); noteEl.classList.add('pb-note');
        const waveEl = document.createElement('div'); waveEl.classList.add('pb-wave');
        const volEl = document.createElement('div'); volEl.classList.add('pb-volume');

        block.append(stepNumEl, noteEl, waveEl, volEl);
        playbackGrid.appendChild(block);
        return { blockElement: block, noteDisplay: noteEl, waveDisplay: waveEl, volumeDisplay: volEl };
    }

    function setupEventListeners() {
        playOnceButton.onclick = () => handlePlay(false);
        playLoopButton.onclick = () => handlePlay(true);
        stopButton.onclick = stopAllSounds;
        bulkEditTriggerButton.onclick = openBulkEditModal;
        randomGenerateTriggerButton.onclick = openRandomGenerateModal;

        bpmAdjustButtons.forEach(button => {
            button.addEventListener('click', () => {
                const step = parseInt(button.dataset.step);
                adjustBpm(step);
            });
        });
        bpmInput.addEventListener('change', () => {
            let currentValue = parseInt(bpmInput.value);
            if (isNaN(currentValue)) currentValue = 120;
            bpmInput.value = Math.max(20, Math.min(300, currentValue));
        });

        editModalCloseButton.onclick = closeEditModal;
        modalVolumeSlider.oninput = () => modalVolumeDisplay.textContent = `${modalVolumeSlider.value}%`;
        modalCompleteButton.onclick = saveSingleStepChanges;
        modalPlayTestButton.onclick = playTestFromSingleEditModal;

        bulkEditModalCloseButton.onclick = closeBulkEditModal;
        bulkVolumeSlider.oninput = () => {
            bulkVolumeDisplay.textContent = `${bulkVolumeSlider.value}%`;
            bulkVolumeSlider.dataset.isSetForBulk = "true";
            bulkVolumeSlider.style.opacity = 1;
            bulkVolumeDisplay.style.opacity = 1;
        };
        bulkApplyButton.onclick = applyBulkChanges;
        if (bulkClearVolumeButton) {
            bulkClearVolumeButton.onclick = () => {
                bulkVolumeSlider.value = 50;
                bulkVolumeDisplay.textContent = '50%';
                bulkVolumeSlider.dataset.isSetForBulk = "false";
                bulkVolumeSlider.style.opacity = 0.5;
                bulkVolumeDisplay.style.opacity = 0.5;
            };
        }

        rgModalCloseButton.onclick = closeRandomGenerateModal;
        rgExecuteButton.onclick = executeRandomGeneration;

        window.onclick = (event) => {
            if (event.target == editModal) closeEditModal();
            if (event.target == bulkEditModal) closeBulkEditModal();
            if (event.target == randomGenerateModal) closeRandomGenerateModal();
        };
    }

    function adjustBpm(step) {
        let currentValue = parseInt(bpmInput.value);
        if (isNaN(currentValue)) {
            currentValue = 120;
        }
        let newValue = currentValue + step;
        newValue = Math.max(parseInt(bpmInput.min), Math.min(parseInt(bpmInput.max), newValue));
        bpmInput.value = newValue;
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
        modalTitle.textContent = `ステップ ${id + 1} 編集`;

        setActiveButtonInGroup(modalNoteButtonsContainer, data.note);
        setActiveButtonInGroup(modalOctaveButtonsContainer, data.octave);
        setActiveButtonInGroup(modalWaveformButtonsContainer, data.waveform);

        modalVolumeSlider.value = data.volume * 100;
        modalVolumeDisplay.textContent = `${Math.round(data.volume * 100)}%`;
        openModal(editModal);
    }
    function closeEditModal() { closeModalHelper(editModal); currentlyEditingStepId = null; }

    function saveSingleStepChanges() {
        if (currentlyEditingStepId === null) return;
        const id = currentlyEditingStepId;

        const selectedNoteButton = modalNoteButtonsContainer.querySelector('button.active');
        const selectedOctaveButton = modalOctaveButtonsContainer.querySelector('button.active');
        const selectedWaveformButton = modalWaveformButtonsContainer.querySelector('button.active');

        sequenceData[id].note = selectedNoteButton ? selectedNoteButton.dataset.value : sequenceData[id].note;
        sequenceData[id].octave = selectedOctaveButton ? parseInt(selectedOctaveButton.dataset.value) : sequenceData[id].octave;
        sequenceData[id].waveform = selectedWaveformButton ? selectedWaveformButton.dataset.value : sequenceData[id].waveform;
        sequenceData[id].volume = parseInt(modalVolumeSlider.value) / 100;

        updatePlaybackBlockDisplay(id);
        closeEditModal();
    }

    function playTestFromSingleEditModal() {
        if (currentlyEditingStepId === null) return;
        const noteBtn = modalNoteButtonsContainer.querySelector('button.active');
        const octBtn = modalOctaveButtonsContainer.querySelector('button.active');
        const waveBtn = modalWaveformButtonsContainer.querySelector('button.active');

        const testData = {
            note: noteBtn ? noteBtn.dataset.value : sequenceData[currentlyEditingStepId].note,
            octave: octBtn ? parseInt(octBtn.dataset.value) : sequenceData[currentlyEditingStepId].octave,
            waveform: waveBtn ? waveBtn.dataset.value : sequenceData[currentlyEditingStepId].waveform,
            volume: parseInt(modalVolumeSlider.value) / 100,
            id: currentlyEditingStepId
        };
        playSoundWithResume(testData, 0.5);
    }

    function openBulkEditModal() {
        [bulkNoteButtonsContainer, bulkOctaveButtonsContainer, bulkWaveformButtonsContainer]
            .forEach(container => container.querySelectorAll('button.active').forEach(btn => btn.classList.remove('active')));

        bulkVolumeSlider.value = 50;
        bulkVolumeDisplay.textContent = '50%';
        bulkVolumeSlider.dataset.isSetForBulk = "false";
        bulkVolumeSlider.style.opacity = 0.5;
        bulkVolumeDisplay.style.opacity = 0.5;
        openModal(bulkEditModal);
    }
    function closeBulkEditModal() { closeModalHelper(bulkEditModal); }

    function applyBulkChanges() {
        const changes = {};
        const noteBtn = bulkNoteButtonsContainer.querySelector('button.active');
        if (noteBtn) changes.note = noteBtn.dataset.value;

        const octaveBtn = bulkOctaveButtonsContainer.querySelector('button.active');
        if (octaveBtn) changes.octave = parseInt(octaveBtn.dataset.value);

        const waveformBtn = bulkWaveformButtonsContainer.querySelector('button.active');
        if (waveformBtn) changes.waveform = waveformBtn.dataset.value;

        if (bulkVolumeSlider.dataset.isSetForBulk === "true") {
            changes.volume = parseInt(bulkVolumeSlider.value) / 100;
        }

        if (Object.keys(changes).length === 0) {
            closeBulkEditModal(); return;
        }

        for (let i = 0; i < numBlocks; i++) {
            if (changes.note !== undefined) sequenceData[i].note = changes.note;
            if (changes.octave !== undefined) sequenceData[i].octave = changes.octave;
            if (changes.waveform !== undefined) sequenceData[i].waveform = changes.waveform;
            if (changes.volume !== undefined) sequenceData[i].volume = changes.volume;
            updatePlaybackBlockDisplay(i);
        }
        closeBulkEditModal();
    }

    function populateRandomGenerateModalControls() {
        generateButtonSelectors(rgRootNoteButtonsContainer, displayNotes, 'rg-root', (val) => val.replace('♯', '#'));
        setActiveButtonInGroup(rgRootNoteButtonsContainer, 'C');

        rgChordTypeSelect.innerHTML = '';
        for (const typeKey in chordTypes) {
            const option = document.createElement('option');
            option.value = typeKey;
            option.textContent = chordTypes[typeKey].name;
            rgChordTypeSelect.appendChild(option);
        }
        rgChordTypeSelect.value = 'major';

        generateButtonSelectors(rgOctaveMinButtonsContainer, octaves, 'rg-octave-min');
        setActiveButtonInGroup(rgOctaveMinButtonsContainer, 3);

        generateButtonSelectors(rgOctaveMaxButtonsContainer, octaves, 'rg-octave-max');
        setActiveButtonInGroup(rgOctaveMaxButtonsContainer, 5);

        const stepsOptions = Array.from({ length: numBlocks }, (_, i) => i + 1);
        generateButtonSelectors(rgStepsButtonsContainer, stepsOptions, 'rg-steps');
        setActiveButtonInGroup(rgStepsButtonsContainer, currentSequenceMax);
    }

    function openRandomGenerateModal() {
        setActiveButtonInGroup(rgRootNoteButtonsContainer, 'C');
        rgChordTypeSelect.value = 'major';
        setActiveButtonInGroup(rgOctaveMinButtonsContainer, 3);
        setActiveButtonInGroup(rgOctaveMaxButtonsContainer, 5);
        setActiveButtonInGroup(rgStepsButtonsContainer, currentSequenceMax);
        openModal(randomGenerateModal);
    }
    function closeRandomGenerateModal() {
        closeModalHelper(randomGenerateModal);
    }

    function executeRandomGeneration() {
        const rootNoteButton = rgRootNoteButtonsContainer.querySelector('button.active');
        const chordTypeKey = rgChordTypeSelect.value;
        const octaveMinButton = rgOctaveMinButtonsContainer.querySelector('button.active');
        const octaveMaxButton = rgOctaveMaxButtonsContainer.querySelector('button.active');
        const stepsButton = rgStepsButtonsContainer.querySelector('button.active');

        if (!rootNoteButton || !octaveMinButton || !octaveMaxButton || !stepsButton) {
            alert("ランダム生成の全ての項目（ルート音、オクターブ最小・最大、適用ステップ数）を選択してください。");
            return;
        }

        const rootNoteName = rootNoteButton.dataset.value;
        const octaveMin = parseInt(octaveMinButton.dataset.value);
        const octaveMax = parseInt(octaveMaxButton.dataset.value);
        const stepsToGen = parseInt(stepsButton.dataset.value);

        if (octaveMin > octaveMax) {
            alert("最小オクターブは最大オクターブ以下にしてください。");
            return;
        }

        const rootNoteOffset = noteOffsets[rootNoteName];
        if (rootNoteOffset === undefined) { alert("無効なルート音です。"); return; }
        const chord = chordTypes[chordTypeKey];
        if (!chord) { alert("無効なコードタイプです。"); return; }

        const availableNotesInChord = [];
        for (let oct = octaveMin; oct <= octaveMax; oct++) {
            chord.intervals.forEach(interval => {
                const midiNoteNumber = (oct + 1) * 12 + rootNoteOffset + interval;
                const noteIndex = midiNoteNumber % 12;
                const actualOctave = Math.floor(midiNoteNumber / 12) - 1;

                let canonicalNoteName = displayNotes.find(n => noteOffsets[n] === noteIndex && !n.includes('♭'));
                if (!canonicalNoteName) {
                    canonicalNoteName = Object.keys(noteOffsets).find(n => noteOffsets[n] === noteIndex);
                }
                canonicalNoteName = canonicalNoteName || displayNotes[noteIndex];

                if (canonicalNoteName && actualOctave >= 1 && actualOctave <= 9) {
                    availableNotesInChord.push({ note: canonicalNoteName, octave: actualOctave });
                }
            });
        }

        if (availableNotesInChord.length === 0) {
            alert("指定された範囲/コードで生成可能な音がありません。"); return;
        }

        for (let i = 0; i < stepsToGen; i++) {
            const randomIndex = Math.floor(Math.random() * availableNotesInChord.length);
            const randomNoteData = availableNotesInChord[randomIndex];

            sequenceData[i].note = randomNoteData.note;
            sequenceData[i].octave = randomNoteData.octave;
            updatePlaybackBlockDisplay(i);
        }

        currentSequenceMax = stepsToGen;
        setActiveButtonInGroup(sequenceMaxButtonsContainer, currentSequenceMax);

        closeRandomGenerateModal();
    }

    function updatePlaybackBlockDisplay(id) {
        const data = sequenceData[id];
        const el = data.playbackElements;
        el.noteDisplay.textContent = `${data.note.replace('♯', '#')}${data.octave}`;
        let waveText = waveforms[data.waveform] || data.waveform;

        if (data.waveform === 'sawtooth') waveText = "ノコギリ";
        else if (data.waveform === 'triangle') waveText = "三角";
        else if (data.waveform === 'square') waveText = "矩形";
        else if (data.waveform === 'sine') waveText = "正弦";
        else if (waveText.length > 3) waveText = waveText.substring(0, 2) + "..";

        el.waveDisplay.textContent = waveText;
        el.volumeDisplay.textContent = `Vol:${Math.round(data.volume * 100)}%`;
    }

    function getFrequency(noteName, octave) {
        const noteVal = noteOffsets[noteName.replace('#', '♯')];
        if (noteVal === undefined) { console.error("Unknown note:", noteName); return 0; }
        const midiNote = (octave + 1) * 12 + noteVal;
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function playSound(data, duration, startTime = audioCtx.currentTime) {
        if (data.volume === 0) return null;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const freq = getFrequency(data.note, data.octave);
        if (freq === 0) return null;

        osc.type = data.waveform;
        osc.frequency.setValueAtTime(freq, startTime);

        const attack = 0.01; const release = Math.min(0.04, duration * 0.3);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(data.volume, startTime + attack);
        if (startTime + duration - release > startTime + attack) {
            gain.gain.linearRampToValueAtTime(data.volume, startTime + duration - release);
        }
        gain.gain.linearRampToValueAtTime(0, startTime + duration);

        osc.connect(gain).connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);

        const active = { oscillator: osc, gainNode: gain, blockId: data.id };
        activeOscillators.push(active);
        setTimeout(() => activeOscillators = activeOscillators.filter(o => o !== active),
            (startTime - audioCtx.currentTime + duration + 0.01) * 1000 + 200);
        return active;
    }

    function playSoundWithResume(data, duration, startTime) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => playSound(data, duration, startTime));
        } else {
            playSound(data, duration, startTime);
        }
    }

    function highlightPlaybackBlock(blockId, duration) {
        const data = sequenceData[blockId];
        if (data && data.playbackElements && data.playbackElements.blockElement) {
            const el = data.playbackElements.blockElement;
            el.classList.add('playing');
            setTimeout(() => el.classList.remove('playing'), duration * 1000);
        }
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
            } catch (e) { }
        });
        activeOscillators = [];
        document.querySelectorAll('.playback-block.playing').forEach(el => el.classList.remove('playing'));
        currentStep = 0;
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
            if (isLooping) {
                currentStep = 0;
            } else {
                stopAllSounds();
                return;
            }
        }

        const data = sequenceData[currentStep];
        const bpmVal = parseFloat(bpmInput.value);
        const stepDurBeats = currentNoteDuration;
        const stepDurSec = (60 / bpmVal) * stepDurBeats;

        highlightPlaybackBlock(currentStep, stepDurSec);
        playSound(data, stepDurSec, audioCtx.currentTime);

        const nextJsCallDelay = stepDurSec * 1000;
        currentStep++;

        if (isPlaying) {
            sequenceTimeoutId = setTimeout(scheduleNextStep, nextJsCallDelay);
        }
    }

    init();
});