document.addEventListener('DOMContentLoaded', async () => {
    // =================================================================================
    // 1. グローバル変数と定数
    // =================================================================================

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let db, auth;

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
    const fxSlotsContainer = document.getElementById('fx-slots-container');
    const presetMenuButton = document.getElementById('preset-menu-button');
    const presetActionMenu = document.getElementById('preset-action-menu');

    // Modals
    const editModal = document.getElementById('edit-modal');
    const fxEditModal = document.getElementById('fx-edit-modal');
    const bulkEditModal = document.getElementById('bulk-edit-modal');
    const randomGenerateModal = document.getElementById('random-generate-modal');
    const loadPresetModal = document.getElementById('load-preset-modal');
    const renamePresetModal = document.getElementById('rename-preset-modal');
    const confirmationModal = document.getElementById('confirmation-modal');

    // State Variables
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

    const masterGain = audioCtx.createGain();
    let fxSlots = [
        { id: 'B', name: 'FX B', node: null, bypassNode: null, isActive: false, effectType: 'delay', params: { mix: 0.5, time: 0.25, feedback: 0.4, syncMode: 'bpm', rate: 4 } },
        { id: 'C', name: 'FX C', node: null, bypassNode: null, isActive: false, effectType: 'reverb', params: { mix: 0.5 } },
        { id: 'D', name: 'FX D', node: null, bypassNode: null, isActive: false, effectType: 'none', params: {} }
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
    const noteDurations = [{ value: 0.25, label: 