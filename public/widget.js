/* Nexo widget — autocontenido, sin dependencias. */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var scripts = document.querySelectorAll("script[data-nexo-url]");
    script = scripts[scripts.length - 1];
  }
  if (!script || document.getElementById("nexo-launcher")) return;

  var url = String(script.getAttribute("data-nexo-url") || "").replace(/\/+$/, "");
  var visitorId = script.getAttribute("data-nexo-visitor-id") || "";
  var title = script.getAttribute("data-nexo-title") || "Chatea con nosotros";
  var name = script.getAttribute("data-nexo-name") || "";
  var email = script.getAttribute("data-nexo-email") || "";
  if (!url) return;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  var style = document.createElement("style");
  style.textContent = [
    '#nexo-launcher{position:fixed;right:calc(20px + env(safe-area-inset-right));bottom:calc(20px + env(safe-area-inset-bottom));width:56px;height:56px;border:0;border-radius:50%;background:#1877f2;color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 8px 24px #1877f240;z-index:2147483000;transition:transform .18s}',
    '#nexo-launcher:hover{transform:translateY(-2px)}',
    '#nexo-panel{position:fixed;right:calc(20px + env(safe-area-inset-right));bottom:calc(88px + env(safe-area-inset-bottom));width:min(360px,calc(100vw - 32px));height:min(520px,calc(100dvh - 120px));display:none;flex-direction:column;overflow:hidden;background:#fff;color:#1a1d21;border:1px solid #e6e3dc;border-radius:14px;box-shadow:0 12px 40px #1a1d211f;z-index:2147483001;font:14px/1.55 Inter,system-ui,sans-serif}',
    '#nexo-panel[data-open=true]{display:flex}',
    '#nexo-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #e6e3dc}',
    '#nexo-head strong{font:650 15px Manrope,system-ui,sans-serif}',
    '#nexo-close{margin-left:auto;border:0;background:none;color:#6f7480;cursor:pointer;padding:4px;border-radius:6px;display:grid;place-items:center}',
    '#nexo-close:hover{background:#f1efe9;color:#1a1d21}',
    '#nexo-log{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fcfbf8}',
    '.nexo-msg{max-width:86%;padding:9px 13px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.nexo-them{align-self:flex-start;background:color-mix(in srgb,#1877f2 10%,white);border:1px solid color-mix(in srgb,#1877f2 14%,white);border-bottom-left-radius:4px}',
    '.nexo-mine{align-self:flex-end;background:#f1efe9;border:1px solid #e6e3dc;border-bottom-right-radius:4px}',
    '#nexo-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e6e3dc}',
    '#nexo-input{flex:1;min-width:0;min-height:42px;padding:0 12px;border:1px solid #e6e3dc;border-radius:8px;background:#fff;color:#1a1d21;font:inherit}',
    '#nexo-input::placeholder{color:#a3a7ae}',
    '#nexo-send{flex:0 0 42px;height:42px;border:0;border-radius:8px;background:#1877f2;color:#fff;display:grid;place-items:center;cursor:pointer}',
    '#nexo-send:disabled{opacity:.45;cursor:not-allowed}',
    '.nexo-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    '#nexo-launcher:focus-visible,#nexo-panel :focus-visible{outline:2px solid #1877f2;outline-offset:2px}',
    '@media(prefers-reduced-motion:reduce){#nexo-launcher{transition:none}}'
  ].join("");
  document.head.appendChild(style);

  var svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var chatIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16v12H8l-4 3V5z"/></svg>';
  var closeIcon = svg + '<path d="M18 6 6 18M6 6l12 12"/></svg>';
  var sendIcon = svg + '<path d="m4 12 16-8-6 16-2.5-6.5L4 12z"/></svg>';

  var launcher = document.createElement("button");
  launcher.id = "nexo-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Abrir chat");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "nexo-panel");
  launcher.innerHTML = chatIcon;

  var panel = document.createElement("div");
  panel.id = "nexo-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", title);
  panel.dataset.open = "false";
  panel.innerHTML =
    '<div id="nexo-head"><strong>' + escapeHtml(title) + '</strong>' +
    '<button id="nexo-close" type="button" aria-label="Cerrar chat">' + closeIcon + '</button></div>' +
    '<div id="nexo-log" role="log" aria-live="polite" aria-relevant="additions"></div>' +
    '<form id="nexo-form"><label class="nexo-sr" for="nexo-input">Escribe tu mensaje</label>' +
    '<input id="nexo-input" type="text" autocomplete="off" placeholder="Escribe tu mensaje…" />' +
    '<button id="nexo-send" type="submit" aria-label="Enviar mensaje">' + sendIcon + '</button></form>';

  document.body.appendChild(panel);
  document.body.appendChild(launcher);

  var log = document.getElementById("nexo-log");
  var form = document.getElementById("nexo-form");
  var input = document.getElementById("nexo-input");
  var send = document.getElementById("nexo-send");
  var close = document.getElementById("nexo-close");
  var lastOwn = "";

  function addMessage(text, mine) {
    var bubble = document.createElement("div");
    bubble.className = mine ? "nexo-msg nexo-mine" : "nexo-msg nexo-them";
    bubble.textContent = text;
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }

  function setOpen(open) {
    panel.dataset.open = open ? "true" : "false";
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) input.focus();
    else launcher.focus();
  }

  launcher.addEventListener("click", function () {
    setOpen(panel.dataset.open !== "true");
  });
  close.addEventListener("click", function () {
    setOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.dataset.open === "true") setOpen(false);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    addMessage(text, true);
    lastOwn = text;
    input.value = "";
    input.focus();
    fetch(url + "/api/widget/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: visitorId, name: name, email: email, text: text })
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
    }).catch(function () {
      addMessage("No pudimos enviar tu mensaje. Inténtalo de nuevo.", false);
    });
  });

  function extractText(raw) {
    try {
      var payload = JSON.parse(raw);
      var candidates = [payload, payload.data, payload.data && payload.data.message, payload.message];
      for (var i = 0; i < candidates.length; i++) {
        var item = candidates[i];
        if (!item || typeof item !== "object") continue;
        if (item.direction === "inbound" || item.senderType === "contact") continue;
        if (typeof item.text === "string" && item.text.trim()) return item.text;
      }
    } catch (_) {}
    return "";
  }

  function listen() {
    if (typeof EventSource === "undefined") return;
    try {
      var stream = new EventSource(url + "/api/stream?visitorId=" + encodeURIComponent(visitorId));
      stream.addEventListener("message.created", function (event) {
        var text = extractText(event.data);
        if (!text) return;
        if (text === lastOwn) {
          lastOwn = "";
          return;
        }
        addMessage(text, false);
      });
      stream.onerror = function () {
        stream.close();
        window.setTimeout(listen, 5000);
      };
    } catch (_) {}
  }

  listen();
})();
