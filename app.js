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
  const removeFileBtn = document.getElementById('remove-file-btn');
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

  // Remove file
  removeFileBtn.addEventListener('click', function () {
    clearSelectedFile();
  });

  function setSelectedFile(file) {
    // Validate file type
    const allowed = ['audio/', 'video/', '.mp3', '.mp4', '.m4a', '.wav', '.webm', '.mpeg', '.mpga'];
    const isValid = allowed.some(function (t) {
      return t.startsWith('.') ? file.name.toLowerCase().endsWith(t) : file.type.startsWith(t);
    });
    if (!isValid) {
      showToast('⚠️ サポートされていないファイル形式です');
      return;
    }
    // Check size (25MB limit for Whisper API)
    if (file.size > 25 * 1024 * 1024) {
      showToast('⚠️ ファイルサイズが25MBを超えています');
      return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    dropZone.style.display = 'none';
    fileInfo.style.display = 'flex';
    updateTranscribeBtn();
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    dropZone.style.display = '';
    fileInfo.style.display = 'none';
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

    // Show progress
    const btnText = transcribeBtn.querySelector('.transcribe-btn-text');
    const btnSpinner = transcribeBtn.querySelector('.transcribe-spinner');
    btnText.textContent = '処理中...';
    btnSpinner.style.display = 'block';
    uploadProgress.style.display = 'flex';
    progressFill.classList.add('indeterminate');
    progressText.textContent = 'Groq APIに送信中...';

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
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
      progressText.textContent = '✅ 完了しました';
      showToast('✅ 文字起こしが完了しました');

    } catch (error) {
      console.error('Whisper API error:', error);
      progressFill.classList.remove('indeterminate');
      progressFill.style.width = '0%';
      progressText.textContent = '❌ エラー: ' + error.message;
      showToast('⚠️ ' + error.message);
    } finally {
      isTranscribing = false;
      btnText.textContent = '文字起こし開始';
      btnSpinner.style.display = 'none';
      updateTranscribeBtn();

      // Hide progress after delay
      setTimeout(function () {
        uploadProgress.style.display = 'none';
        progressFill.style.width = '0%';
      }, 4000);
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
