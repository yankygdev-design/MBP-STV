// Runs the REAL delay block out of userScript.js against a stub DOM, so the test cannot
// drift from the shipped code. Four cases, including a planted failure.
var fs = require('fs');
var path = require('path');
// Default to the script next door, so 'npm test' needs no arguments.
var src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'userScript.js'), 'utf8');

// ---- slice the real code out of the file -------------------------------------------
var a = src.indexOf('  var dly = { timer');
var b = src.indexOf('  function isSeekBar(');
if (a < 0 || b < 0 || b < a) { console.error('could not slice the delay block'); process.exit(1); }
var code = src.slice(a, b);
['function hideDelay', 'function forceHide', 'function unforce', 'function delayPanels', 'function subDelay'].forEach(function (need) {
  if (code.indexOf(need) < 0) { console.error('slice is missing ' + need); process.exit(1); }
});

// ---- stub DOM ----------------------------------------------------------------------
function El(cls, opts) {
  opts = opts || {};
  this.cls = cls; this.kids = []; this.handlers = [];
  // `base` is what the site's own stylesheet/class says. Whether the element is really on
  // screen is that, overridden by any inline display - which is the whole point of the
  // test: removing our inline style must hand the element back to the site's own state.
  this.base = opts.visible !== false;
  this._style = {};
  var self = this;
  this.style = {
    get display() { return self._style.display || ''; },
    set display(v) { self._style.display = v; self._style._prio = ''; },
    setProperty: function (k, v, prio) { self._style[k] = v; self._style._prio = prio || ''; },
    removeProperty: function (k) { delete self._style[k]; self._style._prio = ''; }
  };
}
Object.defineProperty(El.prototype, 'visible', {
  get: function () {
    var d = this._style.display;
    if (d === 'none') return false;
    if (d) return true;
    return this.base;
  }
});
El.prototype.add = function (c) { this.kids.push(c); return c; };
El.prototype.all = function () {
  var out = [this], i;
  for (i = 0; i < this.kids.length; i++) out = out.concat(this.kids[i].all());
  return out;
};
El.prototype.querySelectorAll = function (sel) {
  var want = sel.split(',').map(function (s) { return '.' + s.trim().replace(/^.*\./, ''); });
  return this.all().slice(1).filter(function (e) { return want.indexOf('.' + e.cls) >= 0; });
};
El.prototype.querySelector = function (sel) { var l = this.querySelectorAll(sel); return l.length ? l[0] : null; };
El.prototype.getBoundingClientRect = function () {
  return this.visible ? { width: 300, height: 90 } : { width: 0, height: 0 };
};
El.prototype.getAttribute = function () { return null; };
El.prototype.click = function () { this.handlers.forEach(function (h) { h(); }); };
El.prototype.forcedImportant = function () { return this._style.display === 'none' && this._style._prio === 'important'; };

// ---- a clock we can run by hand -----------------------------------------------------
var clock = [];
function setTimeoutStub(fn, ms) { var t = { fn: fn, at: ms, dead: false }; clock.push(t); return t; }
function clearTimeoutStub(t) { if (t) t.dead = true; }
function runClock() {
  for (var pass = 0; pass < 8; pass++) {
    var batch = clock; clock = [];
    if (!batch.length) return;
    batch.sort(function (x, y) { return x.at - y.at; }).forEach(function (t) { if (!t.dead) t.fn(); });
  }
}

function build(closeBehaviour, panelCount) {
  var box = new El('player'), panels = [], i, p, t, x;
  for (i = 0; i < (panelCount || 1); i++) {
    p = box.add(new El('subtitle_delay_con'));
    p.add(new El('jia')); p.add(new El('jian'));
    t = p.add(new El('time')); t.textContent = '-1.5s';
    x = p.add(new El('close2'));
    // 'dead' is a close button that exists and does nothing: the planted failure
    if (closeBehaviour === 'works') (function (pp) { x.handlers.push(function () { pp.style.display = 'none'; }); })(p);
    panels.push(p);
  }
  return { box: box, panels: panels };
}

function load(env) {
  var names = Object.keys(env);
  var body = 'return (function(){ ' + code +
    '\n return { hideDelay: hideDelay, delayStep: delayStep, delayPanel: delayPanel,' +
    ' delayPanels: delayPanels, dly: dly, unforce: unforce, subDelay: subDelay }; })();';
  return new Function(names.join(','), body).apply(null, names.map(function (n) { return env[n]; }));
}

var toasts = [];
function envFor(world) {
  return {
    site: { delay: { panel: '.subtitle_delay_con', open: '.subtitle_set2 .delay_btn', down: '.jian', up: '.jia', value: '.time', close: '.close2' } },
    box: world.box,
    attached: function () { return true; },
    css: function () { return { visibility: 'visible' }; },
    clickRaw: function (el) { if (el) el.click(); return true; },
    markDirty: function () {},
    toast: function (m) { toasts.push(m); },
    ensurePlayer: function () { return true; },
    episode: function () {},
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub
  };
}

var fails = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
  if (!ok) fails++;
}

// 1. POSITIVE CONTROL: the close button works. Panel must end up hidden, and we must NOT
//    have stamped a style of our own onto it.
console.log("case 1  the site's own close button works");
(function () {
  clock = [];
  var w = build('works', 1), api = load(envFor(w));
  api.delayStep(w.panels[0], 1);
  runClock();
  check('panel is gone', api.delayPanel() === null);
  check('we did not force a style (no over-fire)', !w.panels[0].forcedImportant(), 'style=' + JSON.stringify(w.panels[0]._style));
  check('nothing recorded as forced', api.dly.forced.length === 0);
})();

// 2. PLANTED FAILURE: the close button exists but does nothing - the reported bug.
console.log('case 2  the close button exists and does nothing (the reported bug)');
(function () {
  clock = [];
  var w = build('dead', 1), api = load(envFor(w));
  api.delayStep(w.panels[0], 1);
  var mid = api.delayPanel() !== null;
  runClock();
  check('panel was still up before the timers ran', mid);
  check('panel is gone afterwards', api.delayPanel() === null);
  check('we forced it with !important', w.panels[0].forcedImportant());
  check('recorded so it can be given back', api.dly.forced.length === 1);
  api.unforce();
  check('unforce makes it reopenable', api.delayPanel() !== null);
})();

// 3. TWO panels up at once, both with dead close buttons.
console.log('case 3  two delay panels on screen at once');
(function () {
  clock = [];
  var w = build('dead', 2), api = load(envFor(w));
  api.delayStep(w.panels[0], 1);
  runClock();
  check('both panels gone', api.delayPanels().length === 0, 'still visible: ' + api.delayPanels().length);
})();

// 4. Nothing on screen: hideDelay must be a no-op.
console.log('case 4  nothing on screen');
(function () {
  clock = [];
  var w = build('dead', 1), api = load(envFor(w));
  w.panels[0].base = false;
  api.hideDelay();
  runClock();
  check('no style stamped on an already-hidden panel', !w.panels[0].forcedImportant());
  check('nothing recorded', api.dly.forced.length === 0);
})();

// 5. A nudge that repeats: the second press must push the hide out, not hide early.
console.log('case 5  the key repeats');
(function () {
  clock = [];
  var w = build('dead', 1), api = load(envFor(w));
  api.delayStep(w.panels[0], 1);
  var first = api.dly.timer;
  api.delayStep(w.panels[0], 1);
  check('the earlier hide was cancelled', first.dead === true);
  check('a new one is armed', api.dly.timer !== first && !api.dly.timer.dead);
  runClock();
  check('panel still ends up gone', api.delayPanel() === null);
})();

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
