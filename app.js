// ========================================
// VoiceScribe — 音声文字起こしアプリ
// ========================================

(function () {
  'use strict';

  // --- DOM Elements ---
  const recordBtn = document.getElementById('record-btn');
  const statusText = document.getElementById('status-text');
  const timer = document.getElementById('timer');
  const waveform = document.getElementById('waveform');
  const transcriptArea = document.getElementById('transcript-area');
  const wordCount = document.getElementById('word-count');
  const languageSelect = document.getElementById('language-select');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const clearBtn = document.getElementById('clear-btn');
  const errorBanner = document.getElementById('error-banner');
  const toast = document.getElementById('toast');

  // Tab elements
  const tabMic = document.getElementById('tab-mic');
  const tabFile = document.getElementById('tab-file');
  const micPanel = document.getElementById('mic-panel');
  const filePanel = document.getElementById('file-panel');

  // File upload elements
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyBtn = document.getElementById('toggle-key-btn');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileInfo = document.getElementById('file-info');
  const fileName = document.getElementById('file-name');
  const fileSize = document.getElementById('file-size');
  const fileBadge = document.getElementById('file-badge');
  const fileActionHint = document.getElementById('file-action-hint');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const compressedAudioRow = document.getElementById('compressed-audio-row');
  const compressedInfo = document.getElementById('compressed-info');
  const downloadAudioBtn = document.getElementById('download-audio-btn');
  const whisperLangSelect = document.getElementById('whisper-lang-select');
  const transcribeBtn = document.getElementById('transcribe-btn');
  const uploadProgress = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // --- State ---
  let isRecording = false;
  let recognition = null;
  let finalTranscript = '';
  let timerInterval = null;
  let startTime = null;
  let selectedFile = null;
  let isTranscribing = false;
  let lastCompressedBlob = null;
  let lastCompressedFileName = '';

  // --- Load saved API key ---
  const savedKey = localStorage.getItem('voicescribe_groq_key');
  if (savedKey) apiKeyInput.value = savedKey;

  // Save API key on change
  apiKeyInput.addEventListener('input', function () {
    localStorage.setItem('voicescribe_groq_key', apiKeyInput.value.trim());
    updateTranscribeBtn();
  });

  // Toggle API key visibility
  toggleKeyBtn.addEventListener('click', function () {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '👁️';
    }
  });

  // ========================================
  // Tab Switching
  // ========================================
  tabMic.addEventListener('click', function () {
    tabMic.classList.add('active');
    tabFile.classList.remove('active');
    micPanel.style.display = '';
    filePanel.style.display = 'none';
  });

  tabFile.addEventListener('click', function () {
    tabFile.classList.add('active');
    tabMic.classList.remove('active');
    filePanel.style.display = '';
    micPanel.style.display = 'none';
    // Stop recording if active
    if (isRecording) stopRecording();
  });

  // ========================================
  // File Upload
  // ========================================

  // Click to select
  dropZone.addEventListener('click', function () {
    fileInput.click();
  });

  // File selected
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      setSelectedFile(fileInput.files[0]);
    }
  });

  // Drag and drop
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  });

  // Download compressed audio button
  downloadAudioBtn.addEventListener('click', function () {
    if (!lastCompressedBlob) return;
    const url = URL.createObjectURL(lastCompressedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = lastCompressedFileName || 'extracted_audio.mp3';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📥 抽出したMP3を保存しました');
  });

  // Remove file
  removeFileBtn.addEventListener('click', function () {
    clearSelectedFile();
  });

  function setSelectedFile(file) {
    // Validate file type
    const allowed = ['audio/', 'video/', '.mp3', '.mp4', '.mov', '.m4a', '.wav', '.webm', '.mpeg', '.mpga', '.mkv', '.ogg', '.flac', '.aac'];
    const isValid = allowed.some(function (t) {
      return t.startsWith('.') ? file.name.toLowerCase().endsWith(t) : file.type.startsWith(t);
    });
    if (!isValid) {
      showToast('⚠️ サポートされていないファイル形式です');
      return;
    }

    // Safety limit: 1GB
    if (file.size > 1024 * 1024 * 1024) {
      showToast('⚠️ ファイルサイズが大きすぎます (上限: 1GB)');
      return;
    }

    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|flv)$/i.test(file.name);
    const isLarge = file.size > 25 * 1024 * 1024;
    const needsCompression = isVideo || isLarge;

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);

    if (needsCompression) {
      fileBadge.style.display = 'inline-block';
      fileBadge.textContent = isVideo ? '🎬 動画・自動圧縮' : '⚡ 大容量・自動圧縮';
      fileActionHint.style.display = 'block';
      fileActionHint.textContent = isVideo
        ? '💡 動画から音声を抽出・軽量化（64kbps MP3）して文字起こしします'
        : '💡 25MB以下に高圧縮（64kbps MP3）して文字起こしします';
    } else {
      fileBadge.style.display = 'none';
      fileActionHint.style.display = 'none';
    }

    // Reset previous compression state
    compressedAudioRow.style.display = 'none';
    lastCompressedBlob = null;
    lastCompressedFileName = '';

    dropZone.style.display = 'none';
    fileInfo.style.display = 'flex';
    updateTranscribeBtn();
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    dropZone.style.display = '';
    fileInfo.style.display = 'none';
    fileBadge.style.display = 'none';
    fileActionHint.style.display = 'none';
    compressedAudioRow.style.display = 'none';
    lastCompressedBlob = null;
    lastCompressedFileName = '';
    updateTranscribeBtn();
  }

  function updateTranscribeBtn() {
    const hasKey = apiKeyInput.value.trim().length > 0;
    const hasFile = selectedFile !== null;
    transcribeBtn.disabled = !hasKey || !hasFile || isTranscribing;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ========================================
  // Audio Extraction & MP3 Compression
  // ========================================
  async function extractAndCompressAudio(file, onProgress) {
    onProgress({ percent: 5, text: '📂 ファイルを読み込み中...' });
    const arrayBuffer = await file.arrayBuffer();

    onProgress({ percent: 15, text: '🎬 音声を抽出・デコード中...' });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('お使いのブラウザはWeb Audio APIに対応していません。');
    }
    const audioCtx = new AudioContextClass();

    let audioBuffer;
    try {
      // Decode audio data (supporting both Promise and callback styles)
      audioBuffer = await new Promise((resolve, reject) => {
        const res = audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(reject);
        }
      });
    } catch (err) {
      throw new Error('音声データの抽出に失敗しました（対応していない動画/音声コーデックの可能性があります）。');
    } finally {
      if (audioCtx.close) {
        audioCtx.close().catch(() => {});
      }
    }

    const duration = audioBuffer.duration;
    onProgress({ percent: 35, text: `🔄 音声を最適化中 (16kHz モノラル / ${formatTime(duration)})...` });

    // Resample to 16kHz mono via OfflineAudioContext (Whisper standard)
    const targetSampleRate = 16000;
    const targetLength = Math.ceil(duration * targetSampleRate);
    const OfflineCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtx = new OfflineCtxClass(1, targetLength, targetSampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const resampledBuffer = await offlineCtx.startRendering();
    const pcmData = resampledBuffer.getChannelData(0); // Float32Array (-1.0 to 1.0)

    // Convert Float32Array to Int16Array for MP3 encoder
    const samples = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      const s = Math.max(-1, Math.min(1, pcmData[i]));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Encode to MP3 with lamejs (mono, 16000Hz, 64kbps)
    if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
      throw new Error('MP3エンコーダー（lamejs）が読み込まれていません。');
    }

    const mp3encoder = new lamejs.Mp3Encoder(1, targetSampleRate, 64);
    const sampleBlockSize = 11520; // Chunk size
    const mp3Data = [];
    const totalSamples = samples.length;

    for (let i = 0; i < totalSamples; i += sampleBlockSize) {
      const chunk = samples.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      // Update progress smoothly (allocated range: 40% ~ 85%)
      if (i % (sampleBlockSize * 4) === 0 || i + sampleBlockSize >= totalSamples) {
        const pct = Math.min(85, Math.round(40 + (i / totalSamples) * 45));
        const currentSec = Math.round(i / targetSampleRate);
        onProgress({
          percent: pct,
          text: `⚡ MP3に圧縮中... ${pct}% (${formatTime(currentSec)} / ${formatTime(duration)})`
        });
        await new Promise(r => setTimeout(r, 0)); // Yield to event loop
      }
    }

    const finalMp3buf = mp3encoder.flush();
    if (finalMp3buf.length > 0) {
      mp3Data.push(finalMp3buf);
    }

    const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const compressedFileName = `${baseName}_audio.mp3`;
    const compressedFile = new File([mp3Blob], compressedFileName, { type: 'audio/mp3' });

    onProgress({
      percent: 88,
      text: `✅ 音声抽出・圧縮完了 (${formatFileSize(compressedFile.size)})`
    });

    return {
      file: compressedFile,
      blob: mp3Blob,
      fileName: compressedFileName,
      duration: duration
    };
  }

  // ========================================
  // Whisper API Transcription
  // ========================================
  transcribeBtn.addEventListener('click', transcribeFile);

  async function transcribeFile() {
    if (!selectedFile || isTranscribing) return;

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showToast('⚠️ APIキーを入力してください');
      return;
    }

    isTranscribing = true;
    updateTranscribeBtn();

    const btnText = transcribeBtn.querySelector('.transcribe-btn-text');
    const btnSpinner = transcribeBtn.querySelector('.transcribe-spinner');
    btnText.textContent = '処理中...';
    btnSpinner.style.display = 'block';
    uploadProgress.style.display = 'flex';
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '0%';
    progressText.textContent = '準備中...';

    const isVideo = selectedFile.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|flv)$/i.test(selectedFile.name);
    const isLarge = selectedFile.size > 25 * 1024 * 1024;
    const needsCompression = isVideo || isLarge;

    let fileToSend = selectedFile;

    try {
      // Step 1: Extract and compress audio if video or > 25MB
      if (needsCompression) {
        const result = await extractAndCompressAudio(selectedFile, function (progress) {
          progressFill.style.width = progress.percent + '%';
          progressText.textContent = progress.text;
        });

        fileToSend = result.file;
        lastCompressedBlob = result.blob;
        lastCompressedFileName = result.fileName;

        // Show compressed download row
        compressedInfo.textContent = `🎵 抽出完了: ${formatFileSize(result.file.size)} (${formatTime(result.duration)})`;
        compressedAudioRow.style.display = 'flex';
      }

      // Step 2: Validate size before sending to Whisper (Groq limit: 25MB)
      if (fileToSend.size > 25 * 1024 * 1024) {
        throw new Error(`圧縮後も25MBを超えています (${formatFileSize(fileToSend.size)})。動画の長さを短くしてください。`);
      }

      // Step 3: Send to Groq Whisper API
      progressFill.classList.add('indeterminate');
      progressText.textContent = `🚀 Groq Whisper AIに送信中 (${formatFileSize(fileToSend.size)})...`;

      const formData = new FormData();
      formData.append('file', fileToSend);
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', whisperLangSelect.value);
      formData.append('response_format', 'text');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(function () { return {}; });
        const errorMsg = errorData.error ? errorData.error.message : 'HTTP ' + response.status;
        throw new Error(errorMsg);
      }

      const text = await response.text();

      // Append to transcript
      if (transcriptArea.value.trim()) {
        transcriptArea.value += '\n\n';
      }
      transcriptArea.value += text;
      finalTranscript = transcriptArea.value;
      updateWordCount();
      transcriptArea.scrollTop = transcriptArea.scrollHeight;

      progressFill.classList.remove('indeterminate');
      progressFill.style.width = '100%';
      progressText.textContent = '✅ 文字起こしが完了しました';
      showToast('✅ 文字起こしが完了しました');

    } catch (error) {
      console.error('Transcription error:', error);
      progressFill.classList.remove('indeterminate');
      progressFill.style.width = '0%';
      progressText.textContent = '❌ エラー: ' + error.message;
      showToast('⚠️ ' + error.message);
    } finally {
      isTranscribing = false;
      btnText.textContent = '文字起こし開始';
      btnSpinner.style.display = 'none';
      updateTranscribeBtn();

      // Hide progress after delay if completed
      setTimeout(function () {
        if (!isTranscribing) {
          uploadProgress.style.display = 'none';
          progressFill.style.width = '0%';
        }
      }, 5000);
    }
  }

  // ========================================
  // Mic Recording (Web Speech API)
  // ========================================
  // --- Check Browser Support (Mic only) ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    errorBanner.innerHTML = 'このブラウザはマイク入力（リアルタイム文字起こし）に対応していません。<br>ファイル読込機能は引き続きご利用いただけます。';
    errorBanner.classList.add('visible');
    recordBtn.disabled = true;
    recordBtn.style.opacity = '0.3';
    recordBtn.style.cursor = 'not-allowed';
    statusText.textContent = 'マイク入力非対応のブラウザです';
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.lang = languageSelect.value;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = function (event) {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      transcriptArea.value = finalTranscript + interimTranscript;
      updateWordCount();
      transcriptArea.scrollTop = transcriptArea.scrollHeight;
    };

    rec.onerror = function (event) {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        showToast('⚠️ マイクのアクセスが拒否されました');
        stopRecording();
      } else if (event.error !== 'no-speech') {
        showToast('⚠️ エラー: ' + event.error);
      }
    };

    rec.onend = function () {
      if (isRecording) {
        try { rec.start(); } catch (e) { stopRecording(); }
      }
    };

    return rec;
  }

  function startRecording() {
    if (!SpeechRecognition) return;
    finalTranscript = transcriptArea.value;
    recognition = createRecognition();
    try { recognition.start(); } catch (e) {
      showToast('⚠️ 録音を開始できませんでした');
      return;
    }

    isRecording = true;
    recordBtn.classList.add('recording');
    statusText.textContent = '録音中...';
    statusText.classList.add('recording');
    waveform.classList.add('active');
    timer.classList.add('visible');
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function stopRecording() {
    isRecording = false;
    if (recognition) { recognition.stop(); recognition = null; }
    recordBtn.classList.remove('recording');
    statusText.textContent = 'マイクボタンを押して開始';
    statusText.classList.remove('recording');
    waveform.classList.remove('active');
    timer.classList.remove('visible');
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function toggleRecording() {
    if (isRecording) { stopRecording(); } else { startRecording(); }
  }

  function updateTimer() {
    if (!startTime) return;
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    var minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
    var seconds = String(elapsed % 60).padStart(2, '0');
    timer.textContent = minutes + ':' + seconds;
  }

  // ========================================
  // Shared Utilities
  // ========================================

  function updateWordCount() {
    var text = transcriptArea.value.trim();
    wordCount.textContent = text.length + ' 文字';
  }

  function copyTranscript() {
    var text = transcriptArea.value.trim();
    if (!text) { showToast('コピーするテキストがありません'); return; }
    navigator.clipboard.writeText(text).then(function () {
      showToast('✅ クリップボードにコピーしました');
      copyBtn.classList.add('success');
      setTimeout(function () { copyBtn.classList.remove('success'); }, 2000);
    }).catch(function () {
      transcriptArea.select();
      document.execCommand('copy');
      showToast('✅ コピーしました');
    });
  }

  function downloadTranscript() {
    var text = transcriptArea.value.trim();
    if (!text) { showToast('ダウンロードするテキストがありません'); return; }
    var now = new Date();
    var dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');
    var filename = 'transcript_' + dateStr + '.txt';
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📥 ダウンロードしました');
  }

  function clearTranscript() {
    if (transcriptArea.value.trim() && !confirm('テキストをすべて削除しますか？')) return;
    transcriptArea.value = '';
    finalTranscript = '';
    updateWordCount();
    showToast('🗑️ クリアしました');
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 2500);
  }

  // --- Event Listeners ---
  recordBtn.addEventListener('click', toggleRecording);
  copyBtn.addEventListener('click', copyTranscript);
  downloadBtn.addEventListener('click', downloadTranscript);
  clearBtn.addEventListener('click', clearTranscript);
  transcriptArea.addEventListener('input', function () {
    finalTranscript = transcriptArea.value;
    updateWordCount();
  });

  languageSelect.addEventListener('change', function () {
    if (isRecording) { stopRecording(); setTimeout(startRecording, 300); }
  });

  // Keyboard shortcut: Space to toggle (when not in inputs)
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      // Only toggle mic if mic tab is active
      if (tabMic.classList.contains('active')) toggleRecording();
    }
  });

})();
