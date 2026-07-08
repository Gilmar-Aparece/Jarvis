(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  // Don't double-inject if the page somehow loads this twice.
  if (document.getElementById('jarvis-extension-root')) return;

  const host = document.createElement('div');
  host.id = 'jarvis-extension-root';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .wrap {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: 'Courier New', monospace;
        user-select: none;
      }
      .hud-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: rgba(1, 6, 16, 0.92);
        border: 1px solid #00e5ff;
        box-shadow: 0 0 30px rgba(0, 229, 255, 0.25), inset 0 0 40px rgba(0,229,255,0.03);
        padding: 16px;
        border-radius: 10px;
        width: 250px;
        text-align: center;
        position: relative;
        backdrop-filter: blur(4px);
      }
      .corner { position: absolute; width: 10px; height: 10px; border: 2px solid #00e5ff; opacity: .8; }
      .c-tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
      .c-tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
      .c-bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
      .c-br { bottom: -1px; right: -1px; border-left: none; border-top: none; }

      .title { font-size: 10px; letter-spacing: 3px; color: #377196; margin-bottom: 10px; font-weight: bold; }

      .reactor-container { position: relative; width: 130px; height: 130px; margin-bottom: 10px; cursor: pointer; }
      canvas.particles { position: absolute; inset: -20px; width: 170px; height: 170px; pointer-events: none; }

      .hud-panel.listening { border-color: #ff1744; box-shadow: 0 0 30px rgba(255,23,68,.3); }
      .hud-panel.speaking { border-color: #ffd54a; box-shadow: 0 0 30px rgba(255,213,74,.3); }
      .hud-panel.silent-mode { border-color: #e040fb; box-shadow: 0 0 30px rgba(224,64,251,.3); }

      .status { font-size: 11px; color: #4baacb; letter-spacing: 2px; margin-bottom: 8px; text-transform: uppercase; min-height: 14px; }
      .console { font-size: 12px; color: #a9e6ff; background: rgba(0,20,40,.55); border: 1px solid #102a45;
        padding: 8px; width: 100%; min-height: 44px; max-height: 130px; overflow-y: auto; text-align: left; word-wrap: break-word; border-radius: 5px; }
      .console::-webkit-scrollbar { width: 4px; }
      .console::-webkit-scrollbar-thumb { background: #0a3c52; }
      .hint { font-size: 9px; color: #315875; margin-top: 8px; letter-spacing: .5px; }
    </style>

    <div class="wrap">
      <div class="hud-panel" id="hud">
        <div class="corner c-tl"></div><div class="corner c-tr"></div>
        <div class="corner c-bl"></div><div class="corner c-br"></div>
        <div class="title">JARVIS // ONLINE</div>
        <div class="reactor-container" id="reactor">
          <canvas class="particles" id="particles" width="170" height="170"></canvas>
        </div>
        <div class="status" id="statusField">SAY "JARVIS"</div>
        <div class="console" id="consoleField">Awaiting hardware connection handshake...</div>
        <div class="hint">Tap ring to (re)start mic · say "go to sleep" to pause</div>
      </div>
    </div>
  `;

  const hud = shadow.getElementById('hud');
  const reactor = shadow.getElementById('reactor');
  const statusField = shadow.getElementById('statusField');
  const consoleField = shadow.getElementById('consoleField');
  const canvas = shadow.getElementById('particles');
  const ctx = canvas.getContext('2d');

  // ---------- Proton-orb particle core ----------
  // A shell of particles rotating in 3D (spherical coords, orthographic
  // projection) plus three tilted "electron" orbit rings around a glowing
  // core — classic proton/atom look, colored by HUD state.
  let hudState = 'idle'; // idle | listening | speaking | silent
  const stateColor = { idle: '0,229,255', listening: '255,23,68', speaking: '255,213,74', silent: '224,64,251' };

  const SPHERE_COUNT = 70;
  const sphereParticles = Array.from({ length: SPHERE_COUNT }, () => {
    const theta = Math.random() * Math.PI * 2;       // longitude
    const phi = Math.acos(2 * Math.random() - 1);    // latitude (uniform on sphere)
    return { theta, phi, speed: 0.006 + Math.random() * 0.01, size: Math.random() * 1.4 + 0.5 };
  });

  const ORBIT_RINGS = [
    { tiltX: 0.35, tiltZ: 0.1, speed: 0.018, phase: 0 },
    { tiltX: -0.5, tiltZ: 1.1, speed: -0.014, phase: 2.1 },
    { tiltX: 0.15, tiltZ: -1.0, speed: 0.021, phase: 4.2 },
  ];
  let globalSpin = 0;

  function setHudState(state) {
    hudState = state;
    hud.classList.remove('listening', 'speaking');
    if (state === 'listening') hud.classList.add('listening');
    if (state === 'speaking') hud.classList.add('speaking');
  }

  function drawParticles() {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const color = stateColor[hudState] || stateColor.idle;
    const speedMul = hudState === 'speaking' ? 2.2 : hudState === 'listening' ? 1.5 : 1;
    const R = 34; // sphere radius

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height); // keep canvas transparent, no dark square

    ctx.globalCompositeOperation = 'lighter';
    globalSpin += 0.004 * speedMul;

    // Glowing core
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
    coreGrad.addColorStop(0, `rgba(${color},0.9)`);
    coreGrad.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Rotating particle sphere shell
    for (const p of sphereParticles) {
      p.theta += p.speed * speedMul * 0.02;
      const t = p.theta + globalSpin;
      const x3 = R * Math.sin(p.phi) * Math.cos(t);
      const y3 = R * Math.cos(p.phi);
      const z3 = R * Math.sin(p.phi) * Math.sin(t);
      const depth = (z3 + R) / (2 * R); // 0 (back) .. 1 (front)
      const sx = cx + x3;
      const sy = cy + y3 * 0.92;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * (0.5 + depth * 0.9), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color},${0.15 + depth * 0.6})`;
      ctx.fill();
    }

    // Tilted electron orbit rings with a bright traveling electron each
    for (const ring of ORBIT_RINGS) {
      ring.phase += ring.speed * speedMul;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ring.tiltZ);
      ctx.scale(1, 0.32 + Math.abs(Math.sin(ring.tiltX)) * 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, 58, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${color},0.28)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      const ex = Math.cos(ring.phase) * 58;
      const ey = Math.sin(ring.phase) * 58;
      ctx.beginPath();
      ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color},1)`;
      ctx.shadowColor = `rgba(${color},1)`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    requestAnimationFrame(drawParticles);
  }
  requestAnimationFrame(drawParticles);

  // ---------- API key ----------
  let GEMINI_API_KEY = null;
function loadKey(cb) {
    try {
      chrome.storage.local.get(['geminiApiKey'], (res) => cb(res && res.geminiApiKey || null));
    } catch (e) {
      cb(null);
    }
  }
  loadKey((k) => { GEMINI_API_KEY = k; });   // ← remove or comment this line out too
  loadKey((k) => { GEMINI_API_KEY = k; });
  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.geminiApiKey) GEMINI_API_KEY = changes.geminiApiKey.newValue;
    });
  } catch (e) {}

  // ---------- Recognition ----------
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  let awake = false;
  let speaking = false;
  let textOnlyMode = false;
  let manuallyStopped = false;
  let sessionTimeout = null;

  function startVoiceEngine() {
    if (manuallyStopped) return;
    try {
      recognition.start();
      if (!awake) {
        statusField.innerText = textOnlyMode ? "SILENT MODE / SAY 'JARVIS'" : "SAY 'JARVIS'";
        setHudState(textOnlyMode ? 'silent' : 'idle');
      } else {
        statusField.innerText = 'LISTENING...';
        setHudState('listening');
      }
    } catch (e) { /* already running */ }
  }

  reactor.addEventListener('click', () => {
    manuallyStopped = false;
    try { recognition.stop(); } catch (e) {}
    setTimeout(startVoiceEngine, 150);
  });

  function resetSleepTimer() {
    clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
      if (awake) {
        awake = false;
        setHudState(textOnlyMode ? 'silent' : 'idle');
        statusField.innerText = "SAY 'JARVIS'";
        consoleField.innerText = 'Session expired. Awaiting wake command...';
        if (!textOnlyMode) speak('Going to standby mode, sir.');
      }
    }, 15000); // 15s of silence before dropping back to sleep
  }

  window.addEventListener('load', () => startVoiceEngine());
  startVoiceEngine();
  recognition.onend = () => { if (!speaking && !manuallyStopped) startVoiceEngine(); };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      statusField.innerText = 'MIC BLOCKED';
      consoleField.innerText = 'Microphone permission denied for this site. Allow mic access and reload.';
      manuallyStopped = true;
    }
  };

  recognition.onresult = async (event) => {
    const phrase = event.results[0][0].transcript.trim();
    const cleanInput = phrase.toLowerCase();

    // --- Silent / voice toggles ---
    if (/(don'?t speak|only type|please don'?t speak)/.test(cleanInput)) {
      textOnlyMode = true;
      hud.classList.add('silent-mode');
      executeResponse('Stealth protocols activated. Responses will be text-only.');
      return;
    }
    if (/(you can (ask|speak)|speak now)/.test(cleanInput)) {
      textOnlyMode = false;
      hud.classList.remove('silent-mode');
      executeResponse('Voice synthesis online. Ready, sir.');
      return;
    }

    // --- Forced sleep ---
    if (/(go to sleep|standby jarvis)/.test(cleanInput)) {
      awake = false;
      clearTimeout(sessionTimeout);
      setHudState('idle');
      executeResponse('Entering standby, sir.');
      return;
    }

    // --- Wake word gating ---
    if (!awake) {
      if (/\bjarvis\b/.test(cleanInput)) {
        awake = true;
        setHudState('listening');
        statusField.innerText = 'LISTENING...';
        resetSleepTimer();
        let processedInput = cleanInput.replace(/\bhey jarvis\b/g, '').replace(/\bjarvis\b/g, '').trim();
        if (processedInput === '') {
          speak('Online. What do you need, sir?');
          return;
        }
      } else {
        return; // ignore ambient chatter while asleep
      }
    } else {
      resetSleepTimer();
    }

    let activeQuery = cleanInput.replace(/\bhey jarvis\b/g, '').replace(/\bjarvis\b/g, '').trim();
    if (activeQuery === '') return;

    statusField.innerText = 'THINKING...';

    // --- Media controls on the current page ---
    if (/\b(pause|stop|play|resume)\b/.test(activeQuery) && !/youtube|video named|song named/.test(activeQuery)) {
      const media = document.querySelector('video') || document.querySelector('audio');
      if (media) {
        if (/\b(pause|stop)\b/.test(activeQuery)) { media.pause(); executeResponse('Media paused.'); return; }
        if (/\b(play|resume)\b/.test(activeQuery)) { media.play(); executeResponse('Resuming playback.'); return; }
      }
    }

    // --- YouTube router (fixed: uses background tab creation, broader phrasing) ---
    if (/youtube/.test(activeQuery) || /\bplay (music|song)\b/.test(activeQuery)) {
      let target = activeQuery
        .replace(/open youtube and play/g, '')
        .replace(/(search|play|open) (on )?youtube( for)?/g, '')
        .replace(/play (music|song) named/g, '')
        .replace(/play (music|song)/g, '')
        .replace(/\byoutube\b/g, '')
        .trim();

      const url = target
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(target)}`
        : 'https://www.youtube.com';

      openTab(url);
      executeResponse(target ? `Pulling up "${target}" on YouTube, sir.` : 'Opening YouTube, sir.');
      return;
    }

    // --- Safety exception ---
    if (/(turn off my (cell)?phone)/.test(activeQuery)) {
      executeResponse("I can't reach outside the browser sandbox to power down your phone, sir.");
      return;
    }

    // --- Interview coaching ---
    if (/(help me answer|interview help|interview question)/.test(activeQuery)) {
      const prompt = `You are JARVIS, a sharp technical-interview coach. In 2-3 concise, accurate sentences, give a strong answer strategy for this question: "${activeQuery}"`;
      const solution = await queryGemini(prompt);
      executeResponse(solution);
      return;
    }

    // --- General conversation ---
    const dialoguePrompt = `You are JARVIS, Tony Stark's AI assistant. Answer accurately and factually, address the user as "sir". Be concise (1-3 sentences) but never sacrifice correctness for brevity. Question: "${activeQuery}"`;
    const reply = await queryGemini(dialoguePrompt);
    executeResponse(reply);
  };

  // ---------- Tab opening via background worker (reliable, not popup-blocked) ----------
  function openTab(url) {
    try {
      if (chrome && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: 'openTab', url }, () => {});
        return;
      }
    } catch (e) {}
    window.open(url, '_blank'); // fallback when not running as an installed extension
  }

  // ---------- Gemini call with honest error surfacing ----------
  async function queryGemini(promptText) {
    if (!GEMINI_API_KEY) {
      return "I don't have an API key configured yet, sir. Click the JARVIS icon in your toolbar and paste in a Gemini key from Google AI Studio.";
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 220 },
      };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.error) return `My link to the AI core failed: ${data.error.message}`;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? text.trim() : 'I drew a blank on that one, sir. Could you rephrase?';
    } catch (err) {
      return 'Network link to the AI core dropped. Check your connection, sir.';
    }
  }

  function executeResponse(text) {
    consoleField.innerText = text;
    if (textOnlyMode) {
      setTimeout(startVoiceEngine, 50);
    } else {
      speak(text);
    }
  }

  // ---------- Voice: pick the most JARVIS-like voice available ----------
  let cachedVoice = null;
  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const preferenceOrder = [
      v => /google uk english male/i.test(v.name),
      v => /daniel/i.test(v.name),               // Apple UK male
      v => /arthur/i.test(v.name),
      v => /ryan/i.test(v.name),                  // MS Ryan (UK)
      v => /microsoft.*(uk|british)/i.test(v.name),
      v => /en-gb/i.test(v.lang) && /male/i.test(v.name),
      v => /en-gb/i.test(v.lang),
      v => /david/i.test(v.name),
      v => /en-us/i.test(v.lang),
    ];
    for (const test of preferenceOrder) {
      const match = voices.find(test);
      if (match) return match;
    }
    return voices[0];
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => { cachedVoice = pickVoice(); };
    cachedVoice = pickVoice();
  }

  function speak(text) {
    if (!window.speechSynthesis) { executeResponse(text); return; }
    window.speechSynthesis.cancel();
    speaking = true;
    try { recognition.stop(); } catch (e) {}

    const delivery = new SpeechSynthesisUtterance(text);
    if (!cachedVoice) cachedVoice = pickVoice();
    if (cachedVoice) delivery.voice = cachedVoice;
    delivery.pitch = 0.82;
    delivery.rate = 1.05;

    delivery.onstart = () => { statusField.innerText = 'SPEAKING'; setHudState('speaking'); };
    delivery.onend = () => {
      setHudState(awake ? 'listening' : (textOnlyMode ? 'silent' : 'idle'));
      speaking = false;
      setTimeout(startVoiceEngine, 50);
    };
    window.speechSynthesis.speak(delivery);
  }
})();
