/* VoiceMate front end: listens with the browser's speech recognition, sends the
   text to the Flask server, then reads the reply aloud with speech synthesis. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    mic: $('mic'), status: $('status'), log: $('log'), empty: $('empty'), form: $('textForm'), input: $('textInput'),
    lang: $('lang'), voice: $('voice'), rate: $('rate'), rateVal: $('rateVal'), autoSpeak: $('autoSpeak'),
    keepListening: $('keepListening'), clear: $('clear'), stop: $('stopSpeak'), badge: $('aiBadge'),
    settingsBtn: $('settingsBtn'), settings: $('settings'), support: $('support')
  };

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis;
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

  /* ------------------------------------------------------------ settings */
  function loadSettings() { try { return JSON.parse(localStorage.getItem('vm-settings') || '{}'); } catch (e) { return {}; } }
  function saveSettings() { try { localStorage.setItem('vm-settings', JSON.stringify(settings)); } catch (e) {} }

  var knownLangs = Array.prototype.map.call(els.lang.options, function (o) { return o.value; });
  var guess = knownLangs.indexOf(navigator.language) >= 0 ? navigator.language : 'en-US';
  var settings = Object.assign({ lang: guess, voice: '', rate: 1, autoSpeak: true, keepListening: false }, loadSettings());

  els.lang.value = settings.lang;
  els.rate.value = settings.rate;
  els.rateVal.textContent = Number(settings.rate).toFixed(1) + '×';
  els.autoSpeak.checked = !!settings.autoSpeak;
  els.keepListening.checked = !!settings.keepListening;

  els.lang.addEventListener('change', function () { settings.lang = els.lang.value; settings.voice = ''; saveSettings(); populateVoices(); });
  els.voice.addEventListener('change', function () { settings.voice = els.voice.value; saveSettings(); });
  els.rate.addEventListener('input', function () { settings.rate = parseFloat(els.rate.value); els.rateVal.textContent = settings.rate.toFixed(1) + '×'; saveSettings(); });
  els.autoSpeak.addEventListener('change', function () { settings.autoSpeak = els.autoSpeak.checked; saveSettings(); if (!settings.autoSpeak) stopSpeaking(); });
  els.keepListening.addEventListener('change', function () { settings.keepListening = els.keepListening.checked; saveSettings(); });
  els.settingsBtn.addEventListener('click', function () {
    var open = els.settings.hidden;
    els.settings.hidden = !open;
    els.settingsBtn.setAttribute('aria-expanded', String(open));
  });

  /* -------------------------------------------------------------- voices */
  var voices = [];
  function populateVoices() {
    if (!synth) return;
    voices = synth.getVoices();
    var prefix = settings.lang.slice(0, 2).toLowerCase();
    var matching = voices.filter(function (v) { return v.lang.toLowerCase().indexOf(prefix) === 0; });
    els.voice.textContent = '';
    var auto = document.createElement('option');
    auto.value = ''; auto.textContent = 'Automatic';
    els.voice.appendChild(auto);
    matching.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name; o.textContent = v.name + ' (' + v.lang + ')';
      els.voice.appendChild(o);
    });
    els.voice.value = matching.some(function (v) { return v.name === settings.voice; }) ? settings.voice : '';
  }
  function pickVoice() {
    if (settings.voice) {
      var chosen = voices.filter(function (v) { return v.name === settings.voice; })[0];
      if (chosen) return chosen;
    }
    var want = settings.lang.toLowerCase();
    var prefix = want.slice(0, 2);
    return voices.filter(function (v) { return v.lang.toLowerCase().replace('_', '-') === want; })[0] ||
           voices.filter(function (v) { return v.lang.toLowerCase().indexOf(prefix) === 0; })[0] || null;
  }
  if (synth) { populateVoices(); synth.onvoiceschanged = populateVoices; }

  /* --------------------------------------------------------------- state */
  var state = 'idle';
  var LABELS = { idle: 'Tap the mic and speak', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };
  function setState(s, text) {
    state = s;
    document.body.setAttribute('data-state', s);
    els.status.textContent = text || LABELS[s];
    els.mic.setAttribute('aria-pressed', String(s === 'listening'));
    els.stop.hidden = s !== 'speaking';
  }

  /* ------------------------------------------------------------ messages */
  var history = [];
  var liveEl = null;

  function addMsg(role, text) {
    els.empty.hidden = true;
    var div = document.createElement('div');
    div.className = 'msg msg-' + role;
    div.textContent = text;
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
    return div;
  }
  function showLive(text) {
    if (!liveEl) { liveEl = addMsg('user', text); liveEl.classList.add('live'); }
    else { liveEl.textContent = text; }
    els.log.scrollTop = els.log.scrollHeight;
  }
  function clearLive() { if (liveEl) { liveEl.remove(); liveEl = null; } }

  els.clear.addEventListener('click', function () {
    stopSpeaking(); stopListening();
    history = [];
    Array.prototype.slice.call(els.log.querySelectorAll('.msg')).forEach(function (n) { n.remove(); });
    els.empty.hidden = false;
    setState('idle');
  });

  /* ------------------------------------------------------------ speaking */
  var speakToken = 0;
  var keepAlive = [];

  function speak(text, done) {
    if (!synth || !settings.autoSpeak) { done(); return; }
    synth.cancel();
    var token = ++speakToken;
    var chunks = (text.match(/[^.!?।]+[.!?।]*\s*/g) || [text]).map(function (c) { return c.trim(); }).filter(Boolean);
    var i = 0;
    setState('speaking');
    function next() {
      if (token !== speakToken) return;          // cancelled
      if (i >= chunks.length) { done(); return; }
      var u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = settings.lang;
      u.rate = settings.rate;
      var v = pickVoice();
      if (v) u.voice = v;
      u.onend = next;
      u.onerror = next;
      keepAlive = [u];                           // stops some browsers garbage-collecting it mid-speech
      synth.speak(u);
    }
    next();
  }
  function stopSpeaking() {
    speakToken++;
    if (synth) synth.cancel();
    if (state === 'speaking') setState('idle');
  }
  els.stop.addEventListener('click', stopSpeaking);

  function finishedSpeaking() {
    setState('idle');
    if (settings.keepListening) startListening();
  }

  /* ----------------------------------------------------------- listening */
  var recognition = null;
  var ERRORS = {
    'not-allowed': 'Microphone is blocked. Allow it in your browser, or type below.',
    'service-not-allowed': 'Microphone is blocked. Allow it in your browser, or type below.',
    'no-speech': "I didn't hear anything. Tap the mic and try again.",
    'audio-capture': 'No microphone found. You can type instead.',
    'network': 'The speech service is unreachable. You can type instead.',
    'language-not-supported': 'That language is not supported for voice input.'
  };

  function startListening() {
    if (!SR) { els.support.hidden = false; els.input.focus(); return; }
    if (recognition) return;
    stopSpeaking();
    var rec = new SR();
    rec.lang = settings.lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    var finalText = '', errorText = '';

    rec.onstart = function () { setState('listening'); };
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      showLive((finalText + interim).trim());
    };
    rec.onerror = function (e) { if (e.error !== 'aborted') errorText = ERRORS[e.error] || 'Voice input failed. You can type instead.'; };
    rec.onend = function () {
      recognition = null;
      clearLive();
      if (finalText.trim()) handleUserText(finalText.trim());
      else if (state === 'listening') setState('idle', errorText || "Didn't catch that. Tap the mic and try again.");
      else if (errorText) setState('idle', errorText);
    };

    recognition = rec;
    try { rec.start(); } catch (e) { recognition = null; setState('idle'); }
  }
  function stopListening() { if (recognition) { try { recognition.stop(); } catch (e) {} } }

  els.mic.addEventListener('click', function () {
    if (state === 'thinking') return;
    if (state === 'listening') stopListening(); else startListening();
  });

  /* ---------------------------------------------------------- the server */
  function handleUserText(text) {
    if (/^(stop|cancel|be quiet|quiet|shut up|never ?mind)[.!]?$/i.test(text)) { stopSpeaking(); setState('idle'); return; }
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    ask(text);
  }

  function ask(text) {
    setState('thinking');
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 40000);
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: history.slice(-13, -1), tz: tz }),
      signal: ctrl.signal
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok || !res.d.reply) throw new Error((res.d && res.d.error) || 'Something went wrong. Please try again.');
        addMsg('assistant', res.d.reply);
        history.push({ role: 'assistant', content: res.d.reply });
        speak(res.d.reply, finishedSpeaking);
      })
      .catch(function (err) {
        clearTimeout(timer);
        history.pop();                             // drop the unanswered question
        addMsg('error', err.name === 'AbortError' ? 'That took too long. Please try again.' : err.message);
        setState('idle');
      });
  }

  /* --------------------------------------------------------- text + misc */
  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = els.input.value.trim();
    if (!text || state === 'thinking') return;
    els.input.value = '';
    stopSpeaking(); stopListening();
    handleUserText(text);
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      if (state === 'thinking') return;
      stopSpeaking(); stopListening();
      handleUserText(chip.getAttribute('data-say'));
    });
  });

  document.addEventListener('keydown', function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === 'Escape') { stopSpeaking(); stopListening(); }
    else if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) { e.preventDefault(); els.mic.click(); }
  });

  if (!SR) els.support.hidden = false;

  fetch('/api/status').then(function (r) { return r.json(); }).then(function (d) {
    els.badge.textContent = d.ai ? 'AI connected' : 'Offline mode';
    els.badge.className = 'badge ' + (d.ai ? 'on' : 'off');
  }).catch(function () { els.badge.textContent = 'Server unreachable'; els.badge.className = 'badge off'; });
})();
