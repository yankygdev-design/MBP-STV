// Runs the REAL page-scale code out of userScript.js against a stub head.
//
// The thing under test is the viewport tag. A photograph of the help screen on the set
// showed root at 256px while the catalogue still rendered small, which proves the catalogue
// is the site's desktop layout and sized in px - so the root font-size this file also sets
// cannot be what makes it bigger. Asking the engine for a narrower viewport is what does,
// and 100% must remain the page exactly as the site ships it.
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'userScript.js'), 'utf8');

var a = src.indexOf('  var SCALE_KEY =');
var mark = src.indexOf('  function scaleLabel()');
if (a < 0 || mark < 0 || mark < a) { console.error('could not slice the scale block'); process.exit(1); }
var b = src.indexOf('\n', mark) + 1;
var code = src.slice(a, b);
['function vpApply', 'function scaleApply', 'function scaleNudge', 'function scaleClamp']
  .forEach(function (need) {
    if (code.indexOf(need) < 0) { console.error('slice is missing ' + need); process.exit(1); }
  });

// ---- stub head ------------------------------------------------------------------------
function Node(tag) {
  this.tag = tag; this.attrs = {}; this.textContent = ''; this.parentNode = null;
}
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
};
Node.prototype.removeChild = function (c) {
  var i = this.kids.indexOf(c);
  if (i >= 0) { this.kids.splice(i, 1); c.parentNode = null; }
  return c;
};

var head = new Node('head');
head.kids = [];
head.appendChild = function (c) { head.kids.push(c); c.parentNode = head; return c; };
head.removeChild = Node.prototype.removeChild.bind(head);

var store = {};
var dirty = 0, rings = 0;
var win = {
  innerWidth: 1920,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  }
};
var env = {
  W: win,
  D: { createElement: function (t) { return new Node(t); }, head: head, documentElement: head },
  CFG: { pageScale: true },
  onSite: function () { return true; },
  attached: function (el) { return !!el && el.parentNode === head; },
  markDirty: function () { dirty++; },
  drawRingSoon: function () { rings++; }
};

function load() {
  var names = Object.keys(env);
  var body = 'return (function(){ var BASE_W = 0; ' + code +
    '\n return { scaleApply: scaleApply, scaleNudge: scaleNudge, scaleGet: scaleGet,' +
    ' scaleClamp: scaleClamp, scaleLabel: scaleLabel, base: function(){ return BASE_W; } }; })();';
  return new Function(names.join(','), body).apply(null, names.map(function (n) { return env[n]; }));
}

function meta() {
  for (var i = 0; i < head.kids.length; i++) if (head.kids[i].tag === 'meta') return head.kids[i];
  return null;
}
function styleText() {
  for (var i = 0; i < head.kids.length; i++) if (head.kids[i].tag === 'style') return head.kids[i].textContent;
  return '';
}
// `w || 1920` would turn the zero-width case - the one case 6 exists to test - back into
// 1920 and quietly pass it.
function reset(w) {
  head.kids.length = 0; store = {}; dirty = 0; rings = 0;
  win.innerWidth = (w === undefined ? 1920 : w);
}

var fails = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
  if (!ok) fails++;
}

// 1. 100% must not touch the viewport at all. This is the safety property: a set where the
//    tag misbehaves is one Left press from the page exactly as the site ships it.
console.log('case 1  at 100% the page is left alone');
(function () {
  reset();
  var api = load();
  api.scaleApply();
  check('no viewport tag written', meta() === null);
  check('the rem cap is still lifted', /font-size:256\.00px !important/.test(styleText()), styleText());
})();

// 2. Above 100%, a narrower viewport - which is what magnifies a px layout.
console.log('case 2  140% asks for a narrower viewport');
(function () {
  reset();
  store[ 'mbtv_scale' ] = '1.4';
  var api = load();
  api.scaleApply();
  var m = meta();
  check('a viewport tag is written', !!m);
  check('width is 1920/1.4', m && /width=1371\b/.test(m.getAttribute('content')), m && m.getAttribute('content'));
  check('initial-scale matches the ratio', m && /initial-scale=1\.40/.test(m.getAttribute('content')), m && m.getAttribute('content'));
  check('it is ours, not the site’s', m && m.getAttribute('data-mbtv') === 'viewport');
})();

// 3. The root font-size must NOT carry the factor as well. It did once, and on a rem page
//    that scales by the square of what the menu says.
console.log('case 3  the factor is applied once, not twice');
(function () {
  reset();
  store['mbtv_scale'] = '1.4';
  var api = load();
  api.scaleApply();
  check('root is innerWidth/7.5 with no factor', /font-size:256\.00px/.test(styleText()), styleText());
  // and once the engine honours the tag, innerWidth really is the smaller number
  win.innerWidth = 1371;
  api.scaleApply();
  check('and follows the viewport down', /font-size:182\.80px/.test(styleText()), styleText());
})();

// 4. Coming back to 100% has to remove the tag, not leave a stale one.
console.log('case 4  stepping back down');
(function () {
  reset();
  store['mbtv_scale'] = '1.4';
  var api = load();
  api.scaleApply();
  check('tag present at 140%', meta() !== null);
  var i;
  for (i = 0; i < 4; i++) api.scaleNudge(-1);
  check('back at 100%', api.scaleGet() === 1, 'got ' + api.scaleGet());
  check('tag removed again', meta() === null);
  check('and the ring was told to redraw', rings > 0);
})();

// 5. The range, including a value stored by an older build.
console.log('case 5  range and old stored values');
(function () {
  reset();
  var api = load();
  check('clamps high', api.scaleClamp(9) === 2.5, 'got ' + api.scaleClamp(9));
  check('clamps low', api.scaleClamp(0.01) === 0.5, 'got ' + api.scaleClamp(0.01));
  reset();
  store['mbtv_scale'] = '1.4';          // written by 1.2.x, still inside the new range
  api = load();
  check('an older 1.4 survives the upgrade', api.scaleGet() === 1.4, 'got ' + api.scaleGet());
  reset();
  store['mbtv_scale'] = 'banana';
  api = load();
  check('nonsense falls back to 100%', api.scaleGet() === 1, 'got ' + api.scaleGet());
  check('label reads back', /100%/.test(api.scaleLabel()), api.scaleLabel());
})();

// 6. A zero-width viewport must not produce a nonsense tag.
console.log('case 6  a viewport of zero');
(function () {
  reset(0);
  store['mbtv_scale'] = '1.4';
  var api = load();
  api.scaleApply();
  check('no viewport tag', meta() === null);
  check('no font-size rule', styleText() === '');
})();

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
