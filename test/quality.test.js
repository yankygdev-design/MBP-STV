// Runs the REAL rung-choosing code out of userScript.js against fake menus, so the test
// cannot drift from the shipped file.
//
// This exists because the shipped defaults (2160p, HEVC and AV1 allowed) were a guess about
// the panel, and on the first hardware run the climb to a 4K rung left the player buffering
// for good. Case 2 below is that failure, reproduced on purpose: it proves the cap is what
// holds the rung down, rather than leaving that to be believed.
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'userScript.js'), 'utf8');

var a = src.indexOf("  var qd = { done: ''");
var b = src.indexOf('  // ---------------------------------------------------------------- subtitle sync');
if (a < 0 || b < 0 || b < a) { console.error('could not slice the quality block'); process.exit(1); }
var code = src.slice(a, b);
['function qBest', 'function qParse', 'function qMaxGet', 'function qCodecsGet', 'function qMaxNudge']
  .forEach(function (need) {
    if (code.indexOf(need) < 0) { console.error('slice is missing ' + need); process.exit(1); }
  });

// ---- a rung, as the site's menu presents it ------------------------------------------
function rung(name, meta) {
  return {
    name: name, meta: meta, checked: false,
    querySelector: function (sel) {
      if (sel === '.t') return { textContent: name };
      if (sel === '.m') return { textContent: meta };
      return null;
    },
    getAttribute: function (k) { return k === 'aria-checked' ? (this.checked ? 'true' : 'false') : null; }
  };
}

// A realistic film: the site opens at 360p, and there is a 4K HEVC rung sitting in the menu.
function menu() {
  return [
    rung('360p', '640x360 H.264 0.8 Mbps'),
    rung('720p', '1280x720 H.264 2.4 Mbps'),
    rung('1080p', '1920x1080 H.264 6.1 Mbps'),
    rung('2160p', '3840x2160 HEVC 18.0 Mbps')
  ];
}

// ---- harness --------------------------------------------------------------------------
var store = {};
var env = {
  W: { localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  } },
  D: { querySelector: function () { return null; } },
  CFG: { quality: 'high', qualityMax: 1080, qualityMaxMbps: 40, qualityNewCodecs: false },
  site: { quality: { menu: '.menu', item: '.item', title: '.t', meta: '.m' } },
  box: null,
  attached: function () { return true; },
  cls: function (el) { return el.checked ? 'vjs-selected' : ''; },
  css: function () { return {}; },
  log: function () {},
  toast: function () {},
  clickRaw: function () { return true; },
  ensurePlayer: function () { return true; },
  location: { pathname: '/film/1', search: '' },
  setTimeout: function () { return null; },
  clearTimeout: function () {}
};

function load() {
  var names = Object.keys(env);
  var body = 'return (function(){ ' + code +
    '\n return { qBest: qBest, qParse: qParse, qCfg: qCfg, qMaxGet: qMaxGet, qCodecsGet: qCodecsGet,' +
    ' qMaxNudge: qMaxNudge, qCodecsToggle: qCodecsToggle, qMaxLabel: qMaxLabel, qd: qd,' +
    ' QMAX_STEPS: QMAX_STEPS }; })();';
  return new Function(names.join(','), body).apply(null, names.map(function (n) { return env[n]; }));
}

function parseAll(api, list) {
  return list.map(function (r) { return api.qParse(r, env.site.quality); });
}

var fails = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
  if (!ok) fails++;
}

// 1. The shipped default must not reach the 4K HEVC rung.
console.log('case 1  shipped defaults: 1080p, HEVC and AV1 off');
(function () {
  store = {};
  var api = load();
  check('ceiling reads 1080', api.qMaxGet() === 1080, 'got ' + api.qMaxGet());
  check('new codecs off', api.qCodecsGet() === false);
  var best = api.qBest(parseAll(api, menu()));
  check('picks 1080p, not 2160p', best && best.name === '1080p', best ? best.name : 'nothing');
})();

// 2. THE PLANTED FAILURE: the old defaults, which stranded the player on real hardware.
console.log('case 2  the old defaults, reproduced on purpose');
(function () {
  store = { mbtv_qmax: '2160', mbtv_qnew: '1' };
  var api = load();
  var best = api.qBest(parseAll(api, menu()));
  check('reaches the 4K HEVC rung again', best && best.name === '2160p', best ? best.name : 'nothing');
  check('so the cap is what held it down, not luck', true);
})();

// 3. Off means leave the site's rung alone.
console.log('case 3  ceiling off');
(function () {
  store = { mbtv_qmax: '0' };
  var api = load();
  check('reads 0', api.qMaxGet() === 0);
  var best = api.qBest(parseAll(api, menu()));
  check('chooses nothing at all', !best, best ? best.name : 'nothing');
})();

// 4. A 1080p rung above the bitrate ceiling is refused even under the height ceiling.
console.log('case 4  bitrate ceiling');
(function () {
  store = {};
  var api = load();
  var list = [rung('720p', '1280x720 H.264 2.4 Mbps'), rung('1080p', '1920x1080 H.264 85 Mbps')];
  var best = api.qBest(parseAll(api, list));
  check('falls back to 720p', best && best.name === '720p', best ? best.name : 'nothing');
})();

// 5. A scope frame is not a lower rung. 1920x816 is 1080p-class: its short side is 816, and
//    reading the long side would push it over a 1080 ceiling and lose the best rung there is.
console.log('case 5  a 2.35:1 scope film');
(function () {
  store = {};
  var api = load();
  var list = [rung('720p', '1280x544 H.264 2.0 Mbps'), rung('1080p', '1920x816 H.264 7.0 Mbps')];
  var best = api.qBest(parseAll(api, list));
  check('1080p scope is still allowed under a 1080 ceiling', best && best.name === '1080p', best ? best.name : 'nothing');
})();

// 6. HEVC allowed on purpose. The two rungs differ in height as well as codec, so the
//    assertion can actually fail - a pair that both read 1080p would pass either way and
//    prove nothing about the codec gate.
console.log('case 6  HEVC turned on deliberately');
(function () {
  var list = [rung('1080p', '1920x1080 H.264 6.1 Mbps'), rung('2160p', '3840x2160 HEVC 18.0 Mbps')];
  store = { mbtv_qmax: '2160', mbtv_qnew: '1' };
  var api = load();
  var best = api.qBest(parseAll(api, list));
  check('the HEVC rung is now reachable', best && best.name === '2160p', best ? best.name : 'nothing');
  store = { mbtv_qmax: '2160' };                 // ceiling still 2160, codecs off again
  api = load();
  best = api.qBest(parseAll(api, list));
  check('and refused on the codec alone', best && best.name === '1080p', best ? best.name : 'nothing');
})();

// 7. The menu row: steps, clamps at both ends, persists, and asks for a retry.
console.log('case 7  the Max quality row');
(function () {
  store = {};
  var api = load();
  api.qMaxNudge(-1);
  check('1080 steps down to 720', api.qMaxGet() === 720, 'got ' + api.qMaxGet());
  api.qMaxNudge(-1);
  check('then to off', api.qMaxGet() === 0);
  api.qMaxNudge(-1);
  check('and clamps at off', api.qMaxGet() === 0);
  check('it is written down', store.mbtv_qmax === '0');
  var i;
  for (i = 0; i < 9; i++) api.qMaxNudge(1);
  check('climbs to 2160 and clamps there', api.qMaxGet() === 2160, 'got ' + api.qMaxGet());
  check('a nudge clears the once-per-title lock', api.qd.done === '');
  check('and allows a step down this time', api.qd.force === true);
  check('label reads back', /2160p/.test(api.qMaxLabel()), api.qMaxLabel());
  store = {};
  api = load();
  api.qMaxNudge(-1);
  api.qCodecsToggle();
  check('the codec row toggles and persists', api.qCodecsGet() === true && store.mbtv_qnew === '1');
})();

// 8. A junk stored value must not become a ceiling.
console.log('case 8  a stored value we did not write');
(function () {
  store = { mbtv_qmax: '4320' };
  var api = load();
  check('falls back to the default', api.qMaxGet() === 1080, 'got ' + api.qMaxGet());
  store = { mbtv_qmax: 'banana' };
  api = load();
  check('and again for nonsense', api.qMaxGet() === 1080, 'got ' + api.qMaxGet());
})();

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
