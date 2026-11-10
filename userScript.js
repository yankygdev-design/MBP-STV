/*!
 * MovieBox Pro TV - TizenBrew site mod for MovieBoxPro (movieboxpro.app)
 *
 * Remote-friendly browsing plus TV-style playback that drives the site's own
 * player, so its subtitles, subtitle sync and quality menus keep working.
 *
 * Plain ES5 on purpose: runs on 2017+ Samsung TVs (Chromium 47+) with no
 * build step, so jsDelivr can serve this file straight from the GitHub repo.
 *
 * Browsing:  D-pad move | OK select | Back go back / close a popup
 *            Red menu | Green search | Yellow history | Blue or Info help
 *            CH+/CH- page up/down | Play open the player on a watch page
 *            A row of posters is a rail: Left/Right slides it and stays in it,
 *            Up/Down changes row. One stop per poster, not one per overlay.
 * Watching:  OK or Play/Pause play-pause | Left/Right skip 10s (keep pressing = bigger jumps)
 *            Up/Down the player's own controls (subtitles, sync, quality...)
 *            FF/RW skip 30s | Red subtitles | Green quality/settings
 *            Yellow, Next or CH+ next episode | Prev or CH- previous episode
 *            Back: close menu > hide controls > leave full screen
 */
(function () {
  'use strict';

  var W = window, D = document;

  // ------------------------------------------------------------------ settings
  var CFG = {
    seekStep: 10,           // seconds per Left/Right press while watching
    seekStepBig: 30,        // FF / RW keys
    autoWatch: true,        // fill the TV by itself when a film or episode starts
    fullscreen: 'pseudo',   // 'pseudo' fills the screen with the player (reliable on TVs); 'native' tries the Fullscreen API first
    controlsTimeout: 7000,  // ms without a key before the player's controls are dismissed
    osdTimeout: 2500,
    // The site opens at whatever rung it last used, which is often 360p even when a 1080p
    // one is sitting in the menu. Pick the best the TV can actually take, once per title.
    quality: 'high',        // 'high' best rung within the limits below | 'auto' the site's adaptive rung | 'off' leave it alone
    qualityMax: 2160,       // the ceiling is the panel, and a current Samsung set is 4K
    qualityMaxMbps: 40,     // a buffering ceiling, not a decoding one: covers any streaming-grade 4K,
                            // and leaves the remux-sized originals that would stall the link alone
    qualityNewCodecs: true, // a current set decodes HEVC and AV1 in hardware; false for an older TV,
                            // where those rungs are a coin toss and H.264 is the safe one
    homeURL: 'https://www.movieboxpro.app/',
    historyURL: '/index/index/history',
    siteRe: /(^|\.)movieboxpro\./i,
    siteAdapters: true,     // use the per-site hints below (tiles, episode changing, player teardown)
    hiddenScroll: true,     // treat overflow:hidden rows that overflow as scrollable (jQuery carousels)
    pageScale: true,        // lift the site's 750px cap so its own rem layout fills a TV screen
    quick: [
      { label: 'Home', url: '/' },
      { label: 'Search', action: 'search' },
      { label: 'Movies', url: '/movie' },
      { label: 'TV shows', url: '/tvshow' },
      { label: 'MovieLists', url: '/playlist' },
      { label: 'Waiting to watch', url: '/index/index/my_box' },
      { label: 'History', url: '/index/index/history' },
      { label: 'Favorites', url: '/index/index/fav_list' },
      { label: 'My lists', url: '/index/playlist?type=mine' },
      { label: 'Sign in with a code', url: '/index/login/code_login' },
      { label: 'Sign in with a QR code', url: '/index/login/qrcode' }
    ],
    debug: false
  };

  // ------------------------------------------------------------------ keys
  var K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 10009,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412,
    NEXT: 10233, PREV: 10232, CHUP: 427, CHDOWN: 428,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, INFO: 457, CAPTION: 10221
  };
  var KNOWN = {};
  (function () { for (var k in K) if (K.hasOwnProperty(k)) KNOWN[K[k]] = true; })();
  var TV_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'MediaTrackNext', 'MediaTrackPrevious', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green',
    'ColorF2Yellow', 'ColorF3Blue', 'Info', 'Caption'];

  // ------------------------------------------------------------------ patterns
  var RE_CC = /caption|subtitle|(^|[\s_-])cc([\s_-]|$)|\u5b57\u5e55/i;
  var RE_SETTINGS = /quality|setting|resolution|(^|\s)hd(\s|$)|gear|\u6e05\u6670|\u753b\u8d28|\u8bbe\u7f6e/i;
  var RE_NEXT = /next\s*-?(ep|episode)|\u4e0b\u4e00\u96c6|(^|[\s_-])next([\s_-]|$)/i;
  var RE_PREV = /prev(ious)?\s*-?(ep|episode)|\u4e0a\u4e00\u96c6|(^|[\s_-])prev(ious)?([\s_-]|$)/i;
  var RE_CLOSE = /(^|[\s_-])(close|cancel|dismiss|done|back)([\s_-]|$)|\u00d7|\u2715|\u2716|\u5173\u95ed|\u8fd4\u56de|\u53d6\u6d88/i;
  var RE_PLAYBTN = /(^|\s)(play|pause)(\s|$)|\u64ad\u653e|\u6682\u505c/i;
  var RE_WATCH = /(^|\s)(play|watch|resume|continue)(\s|$)|\u64ad\u653e/i;
  var RE_START = /(^|\s)(play|start)(\s|$)|\u64ad\u653e/i;
  var RE_SEARCH = /search|keyword|query|\u641c\u7d22/i;
  var RE_SEEKBAR = /progress|seek|timeline|slider|scrub|rail|time-?bar/i;
  var RE_SELECTED = /(^|[\s_-])(active|selected|current|checked|on)([\s_-]|$)/i;
  var PLAYER_RE = /(^|[\s_-])(jwplayer|jw-wrapper|video-js|vjs|plyr|dplayer|art-video-player|artplayer|xgplayer|shaka|clappr|mejs|player|videoplayer|video-player)/i;

  var SEMANTIC = 'a[href],area[href],button,input,select,textarea,summary,iframe,[tabindex],[role="button"],' +
    '[role="link"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="tab"],' +
    '[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="treeitem"],[onclick],[contenteditable="true"]';
  var CLICKY = 'a[href],button,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"],' +
    '[role="menuitemcheckbox"],[role="option"],[role="tab"],[onclick]';
  var POINTER_TAGS = 'div,span,li,i,img,svg,p,em,b,strong,label,h1,h2,h3,h4,h5,h6,figure,dd,dt,td,th,section,article,ul,picture';
  var DIALOG_SEL = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],.modal.in,.modal.show,.layui-layer,' +
    '.el-dialog__wrapper,.ant-modal-wrap,.swal2-container,.mfp-wrap,.fancybox-container';

  // ------------------------------------------------------------------ site adapters
  // A little site knowledge beats guessing: which boxes are one tile (so a poster is one
  // stop instead of three), what is clickable without saying so, how this site changes
  // episode, and how it tears its player down. Everything here is optional - without a
  // match the generic scanner below behaves exactly as before.
  var SITES = [{
    name: 'movieboxpro',
    test: /(^|\.)movieboxpro\./i,
    // the whole catalogue is tiles, so the blind pointer sweep can stay near the viewport
    sweepUp: 0.8, sweepDown: 1.8,
    // one stop per card: posters carry a cover, a play overlay and a "tips" icon, all clickable
    tiles: [
      { sel: '.clear1 li' },
      { sel: '.tv_episode', keep: 'a.start_app_episode,.operation' },
      { sel: '.search_info > a' },
      { sel: '.lists_roll > div', keep: 'a' },
      // My Box's Watching row stacks five controls on one poster - cover, play, the menu,
      // the watched tick and a tips icon. Play and the menu are the two worth a press.
      { sel: '.watching_list li', keep: '.play,.more' }
    ],
    tileOpen: '.tab_con,.operation_list',   // ...except menus that open inside a tile
    // Menus with no close button, which the site dismisses with a click anywhere else.
    // Re-clicking what opened one only toggles it straight back open.
    dismiss: '.operation_list,.personal,.tab_con',
    // clickable with no href, button or onclick to show for it (jQuery handlers)
    extra: '.left,.left_show,.right,.right2,.right_show,.right_none,.lower,.filter,.elect,.elected,.elect_none,' +
      '.operation,.tab_con li,.watch_plan,.favorite,.add_list2,.comment,.like2,.dislike,.episode_like,.episode_dislike,' +
      '.open2,.hide,.lang_btn,.lang_list p,.sidebarbg2 li,.sidebarcon2 .close img,.season_waiting,.watch_progress,' +
      '.episode,.spread_episode,.off_episode,.add_fav_waiting,.add_fav_watched,.create_playlist,.popup_close,.fav_close,' +
      '.newlist_back,.newlist_close,.tips_close,.search_close,.search_submit,.search_submit2,.player-option,.radio,' +
      '.quit,.confirm,.turn_on,.manage_lists,.set_lists,#dialog_close,.video_player_close,.del_all,.sort,.back,' +
      '.player_back,.user_more_operation,.report,.block,.delete,.send,.list_scroll p,.translate_lang_list p,' +
      '.letter_list a,.checkbox label,.del_subtitle_con .btn p,.screenbg .close,.season_con .close2,' +
      // inside the player: its panels are plain divs and list items with jQuery handlers
      '.subtitle_con .right2 li,.subtitle_con .off,.subtitle_con .more,.lang_more,.srt_set,.reset_srt,' +
      '.srt_color_set p,.font_opacity_set p,.font_size_set p,.font_family_set p,.bg_color_set p,' +
      '.bg_opacity_set p,#qualityOptions p,.mbp-resource-item,.jian,.jia,.delay_btn,.font_btn,' +
      '.translate_btn,.restart,.next_play,.replay,.close2,.back2,.left_skip,.right_skip,.apply_all,' +
      '.disable,.vjs-seek-button,.vjs-menu-item,.movie_skip_con .close span,.change2,.lang_select,' +
      '.del_close,.mbp-resource-modal-close-btn,' +
      // My Box and MovieLists: the per-card menu and its items, the watched ticks, and the
      // chips that clear one active filter - all images and paragraphs with jQuery handlers
      '.more,.tab_watched,.watch_status,.operation_list p,.create_list,.manage_lists,' +
      '#clear_filter,.clear_type,.clear_sort,.clear_rating,.clear_quality,.clear_year,' +
      '.clear_genr,.clear_genre,.clear_country,.clear_tomatometer,' +
      // The sign-in gate: the "more" dots that reveal QR and code login are a bare <img>
      // carrying a jQuery handler - no href, no onclick, no cursor:pointer - so every other
      // pass here misses it and the Google link is the only thing on the page you can reach.
      // The img, not the <p>: the handler is bound to the image, and the <p> spans the row.
      '.login_more img',
    // Long lists that live inside one panel each, swept only while that panel is open: the
    // language pickers run to a couple of hundred entries, and a style lookup per entry is
    // more than the oldest sets this runs on can afford on every keypress.
    heavy: [
      { when: '.subtitle_translate_con', sel: '.lang_list2 p' },
      { when: '.subtitle_preview_con', sel: '.language_code2 p' },
      { when: '.subtitle_transcode_con', sel: '.lang_list2 p,.code_list2 li' }
    ],
    // the player is video.js 8 with the site's own skin, so its controls can be named outright
    // instead of guessed at: far more reliable than matching labels, and it skips the retry loop
    player: {
      subtitles: '.vjs-cc-button',
      // the settings sheet is the hub - quality, subtitles, speed, autoplay next, skip - so
      // Green opens that rather than the quality pill, which is one row inside it
      settings: '.vjs-player-settings-button,.vjs-source-pill-control',
      episodes: '.vjs-episodes-button',
      next: '.vjs-next-button'
    },
    // The quality menu is built up front and only moved to the player root when it opens,
    // so it can be read - and clicked - without putting a menu on the screen. Each row names
    // the rung and spells out resolution, bitrate and codec, which is enough to choose on.
    quality: {
      menu: '.vjs-mbp-quality-menu',
      item: '.vjs-mbp-quality-item',
      title: '.vjs-mbp-quality-item-title',
      meta: '.vjs-mbp-quality-item-meta',
      fallback: '#qualityOptions p'   // the site's other picker, same rungs in the same order
    },
    // subtitle sync: the one setting that wants nudging mid-scene, so it gets its own keys
    delay: {
      panel: '.subtitle_delay_con',
      open: '.subtitle_set2 .delay_btn',
      down: '.jian', up: '.jia', value: '.time', close: '.close2'
    },
    title: '.vjs-mbp-title',   // names the episode on screen, which document.title does not
    episode: mbpEpisode,
    close: mbpClose
  }];
  // A named player control, if this site has one and it is on screen.
  function playerBtn(key) {
    if (!site || !site.player || !site.player[key] || !box || !attached(box)) return null;
    var list = box.querySelectorAll(site.player[key]), i;
    for (i = 0; i < list.length; i++) if (shownQuick(list[i])) return list[i];
    return null;
  }
  function pickSite() {
    if (!CFG.siteAdapters) return null;
    var want = W.__mbtvForceSite;   // set before load to try an adapter on a saved copy of a page
    for (var i = 0; i < SITES.length; i++) {
      if (want ? SITES[i].name === want : SITES[i].test.test(location.hostname)) return SITES[i];
    }
    return null;
  }
  // Click without aiming: used for the site's own buttons, which may be hidden behind an overlay.
  function clickRaw(el) {
    if (!el) return false;
    try { if (typeof el.click === 'function') { el.click(); return true; } } catch (e) {}
    var c = center(el);
    fire(el, 'click', c.x, c.y);
    return true;
  }
  // Which episode is on screen: the site leaves it in globals, the play button, or the URL.
  function mbpPlaying() {
    var s = parseInt(W.play_season, 10), e = parseInt(W.play_episode, 10), m, m2;
    if (s > 0 && e > 0) return { s: s, e: e };
    var a = D.querySelector('.play_btn[play],.start_app[play]');
    if (a) {
      m = /season=(\d+)[\s\S]*?episode=(\d+)/.exec(a.getAttribute('play') || '');
      if (m) return { s: parseInt(m[1], 10), e: parseInt(m[2], 10) };
    }
    m = /[?&]season=(\d+)/.exec(location.search);
    m2 = /[?&]episode=(\d+)/.exec(location.search);
    if (m && m2) return { s: parseInt(m[1], 10), e: parseInt(m2[1], 10) };
    return null;
  }
  // The watch-plan panel lists every season, so a neighbouring season's length is in the page.
  function mbpLastEpisode(season) {
    var list = D.querySelectorAll('.season_info[season="' + season + '"] .episode');
    if (!list.length) return 0;
    return parseInt(list[list.length - 1].getAttribute('episode'), 10) || 0;
  }
  function mbpSeasonExists(season) {
    return !!D.querySelector('.season_info[season="' + season + '"],.season_list2 a[href$="season=' + season + '"]');
  }
  // No next/prev buttons on this site: episodes are a grid, so work out the neighbour ourselves.
  function mbpEpisode(dir) {
    if (!/\/tvshow\//.test(location.pathname)) return false;
    var cur = mbpPlaying();
    if (!cur) return false;
    // the grid on screen must be the season we are watching, or we would be counting someone else's
    if (!D.querySelector('.tv_episode a.start_app_episode[season="' + cur.s + '"]')) return false;
    var e = cur.e + dir, el = null;
    if (e > 0) el = D.querySelector('.tv_episode a.start_app_episode[season="' + cur.s + '"][episode="' + e + '"]');
    if (el) {
      toast(dir > 0 ? 'Next episode' : 'Previous episode');
      exitWatch();                                    // dispose the open player first, saving progress
      setTimeout(function () { clickRaw(el); }, 320); // the site then builds a fresh one
      return true;
    }
    var ns = cur.s + dir;
    if (ns < 1 || !mbpSeasonExists(ns)) return false;
    var ne = dir > 0 ? 1 : mbpLastEpisode(ns);
    if (!ne) return false;
    toast('Season ' + ns + ', episode ' + ne);
    exitWatch();
    goTo(location.pathname + '?season=' + ns + '&episode=' + ne + '&play=1');
    return true;
  }
  // Let the site close its own player: that saves the position and disposes video.js/JW properly.
  function mbpClose(v) {
    var c;
    if (v && v === D.getElementById('video_player')) {   // trailer overlay
      c = D.querySelector('.video_player_close');
      if (c) return clickRaw(c);
    }
    var host = D.getElementById('my_dialog');
    if (host && v && host.contains(v)) {
      try { v.pause(); } catch (e) {}
      c = D.getElementById('dialog_close');
      if (c) return clickRaw(c);
    }
    return false;
  }

  // ------------------------------------------------------------------ state
  var IS_TOP = (function () { try { return W.top === W; } catch (e) { return false; } })();
  var site = null;              // matched entry from SITES, if any
  var mode = 'page';            // page | watch | controls | frame | idle
  var focusEl = null;
  var traps = [];               // open popups/menus that hold the focus: { opener, box }
  var video = null, box = null; // main <video> and its player container
  var ui = {};
  var panel = null;             // open help / menu / picker
  var handledKeys = {};
  var lastKey = 0, lastMove = 0;
  var dirty = true, caches = [], scanSeq = 0, scanId = 0;
  var frameEl = null;           // top window: iframe that currently gets the keys
  var frameActive = false;      // inside an iframe: the parent page handed us the keys
  var pseudo = { el: null, chain: [], hidden: [], inner: [], sy: 0 };
  var ctl = { timer: null, tick: 0 };
  var sk = { target: null, timer: null, count: 0, dir: 0, at: 0, quiet: false };
  var osdTimer = null, osdTick = null, toastTimer = null;
  var HAS_POINTER = typeof W.PointerEvent === 'function';
  var leaving = false;

  // ------------------------------------------------------------------ utils
  function now() { return new Date().getTime(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function log() {
    if (CFG.debug && W.console) W.console.log.apply(W.console, ['[mbtv]'].concat([].slice.call(arguments)));
  }
  function rect(el) {
    var r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  }
  function area(r) { return r.w * r.h; }
  function attached(el) { return !!el && el.nodeType === 1 && D.documentElement.contains(el); }
  function css(el) { return W.getComputedStyle(el) || {}; }
  function inUI(el) { return !!(ui.root && ui.root.contains(el)); }
  function cls(el) { var c = el.getAttribute && el.getAttribute('class'); return c ? String(c) : ''; }
  function shortText(el) {
    var t = (el.textContent || '').replace(/\s+/g, ' ');
    return t.length <= 48 ? t.replace(/^\s+|\s+$/g, '') : '';
  }
  function labelText(el) {
    if (!el.getAttribute) return '';
    return ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' +
      (el.getAttribute('data-title') || '') + ' ' + (el.getAttribute('alt') || '') + ' ' +
      (el.getAttribute('data-tooltip') || '') + ' ' + (el.getAttribute('value') && el.tagName === 'INPUT' ? el.getAttribute('value') : '') + ' ' +
      shortText(el)).toLowerCase();
  }
  function labelAttr(el) { return (cls(el) + ' ' + (el.id || '')).toLowerCase(); }
  function center(el) { var r = rect(el); return { x: r.l + r.w / 2, y: r.t + r.h / 2 }; }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function onSite() { return CFG.siteRe.test(location.hostname); }
  function siteURL(path) {
    var base = onSite() ? location.protocol + '//' + location.host : CFG.homeURL.replace(/\/+$/, '');
    return base + path;
  }
  function markDirty() { dirty = true; }
  function typing() {
    var a = D.activeElement;
    if (!a || a === D.body) return false;
    if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
    if (a.tagName !== 'INPUT') return false;
    return /^(text|search|email|password|number|tel|url)$/.test((a.type || 'text').toLowerCase());
  }

  // ------------------------------------------------------------------ visibility
  function hiddenByOpacity(el, s0) {
    var n = el, path = [], res = false, i;
    while (n && n.nodeType === 1) {
      if (n.__mbtvOpS === scanId) { res = n.__mbtvOp; break; }
      path.push(n);
      var s = (n === el && s0) ? s0 : css(n);
      if (s.display === 'none' || parseFloat(s.opacity) < 0.05) { res = true; break; }
      n = n.parentElement;
    }
    for (i = 0; i < path.length; i++) { path[i].__mbtvOpS = scanId; path[i].__mbtvOp = res; }
    return res;
  }
  function shown(el, r) {
    r = r || rect(el);
    if (r.w < 2 || r.h < 2) return false;
    var s = css(el), v = s.visibility;    // one style lookup, shared with the opacity walk
    if (v === 'hidden' || v === 'collapse') return false;
    return !hiddenByOpacity(el, s);
  }
  function shownQuick(el) { return attached(el) && shown(el); }
  // How a box clips and scrolls its children. Rows share ancestors, so cache it per scan:
  // this is the hottest style lookup there is (every candidate walks its whole chain).
  function ovf(n) {
    if (n.__mbtvOvS === scanId) return n.__mbtvOv;
    var s = css(n), ox = s.overflowX, oy = s.overflowY;
    var o = {
      fixed: s.position === 'fixed',
      visible: ox === 'visible' && oy === 'visible',
      // a jQuery carousel is overflow:hidden yet scrolls fine when you set scrollLeft
      sx: ox === 'auto' || ox === 'scroll' || (CFG.hiddenScroll && ox === 'hidden' && n.scrollWidth > n.clientWidth + 1),
      sy: oy === 'auto' || oy === 'scroll' || (CFG.hiddenScroll && oy === 'hidden' && n.scrollHeight > n.clientHeight + 1),
      r: rect(n)
    };
    n.__mbtvOvS = scanId; n.__mbtvOv = o;
    return o;
  }
  // The row an element sits in, if any: a carousel is a rail, so Left/Right should stay inside it.
  function scrollerOf(el) {
    if (el.__mbtvScrS === scanId) return el.__mbtvScr;
    var n = el.parentElement, res = null;
    while (n && n !== D.body && n !== D.documentElement) {
      var o = ovf(n);
      if (o.sx && n.scrollWidth > n.clientWidth + 1) { res = n; break; }
      if (o.fixed) break;
      n = n.parentElement;
    }
    el.__mbtvScrS = scanId; el.__mbtvScr = res;
    return res;
  }
  // Off-screen items in a box that cannot scroll can't be reached at all: skip them.
  function clipped(el, r) {
    var n = el.parentElement;
    while (n && n !== D.body && n !== D.documentElement) {
      var o = ovf(n);
      if (o.fixed) return false;
      if (!o.visible) {
        var p = o.r;
        if (p.w < 2 || p.h < 2) return true;
        if (!o.sx && Math.min(r.r, p.r) - Math.max(r.l, p.l) < Math.min(r.w, p.w) * 0.6) return true;
        if (!o.sy && Math.min(r.b, p.b) - Math.max(r.t, p.t) < Math.min(r.h, p.h) * 0.6) return true;
        if (o.sx || o.sy) return false;
      }
      n = n.parentElement;
    }
    return false;
  }

  // ------------------------------------------------------------------ candidates
  function okSemantic(el) {
    if (inUI(el)) return false;
    var tag = el.tagName;
    if (tag === 'VIDEO') return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (tag === 'INPUT' && (el.type || '').toLowerCase() === 'hidden') return false;
    if (tag === 'IFRAME' && !IS_TOP) return false;
    var ti = el.getAttribute('tabindex');
    if (ti !== null && parseInt(ti, 10) < 0 && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/.test(tag) &&
      !el.getAttribute('role') && !el.hasAttribute('onclick')) return false;
    return true;
  }
  // Is this node part of a tile we already collapsed to a single stop?
  function inTile(el, stamp) {
    var n = el.parentElement, d = 0;
    while (n && d++ < 10) {
      if (n.__mbtvTile === stamp) {
        return !(site.tileOpen && el.closest && el.closest(site.tileOpen));   // a menu inside a tile still counts
      }
      n = n.parentElement;
    }
    return false;
  }
  // display:none and not-yet-built nodes have no box. Dropping those from the adapter's list keeps
  // them out of the per-keypress pass - a TV show page hides hundreds of watch-plan rows. Safe here
  // because this site reveals them with a class or style change, which marks the scan dirty.
  // Not applied to links and buttons, which a site may reveal on hover alone.
  function laidOut(el) {
    var r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }
  // One stop per tile: the tile itself, or the first match of each keep selector.
  function tileKeeps(t, keep) {
    if (!keep) return [t];
    var toks = keep.split(','), out = [], i, el;
    for (i = 0; i < toks.length; i++) {
      el = t.querySelector(toks[i]);
      if (el) out.push(el);
    }
    return out.length ? out : [t];
  }
  function rescan(scope) {
    var list = [], i, j, el, stamp = ++scanSeq, vh = W.innerHeight;
    var tiles = site && site.tiles, nodes, keeps;
    if (tiles) {
      for (i = 0; i < tiles.length; i++) {
        nodes = scope.querySelectorAll(tiles[i].sel);
        for (j = 0; j < nodes.length; j++) {
          el = nodes[j];
          if (el.__mbtvTile === stamp || inUI(el)) continue;
          el.__mbtvTile = stamp;
          keeps = tileKeeps(el, tiles[i].keep);
          for (var k = 0; k < keeps.length; k++) {
            if (keeps[k].__mbtvCand === stamp) continue;
            keeps[k].__mbtvCand = stamp;
            list.push(keeps[k]);
          }
        }
      }
    }
    nodes = scope.querySelectorAll(SEMANTIC);
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.__mbtvCand === stamp) continue;
      if (tiles && inTile(el, stamp)) continue;
      if (okSemantic(el)) { el.__mbtvCand = stamp; list.push(el); }
    }
    // things this site makes clickable with a jQuery handler and nothing else to show for it
    if (site && site.extra) {
      nodes = scope.querySelectorAll(site.extra);
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (el.__mbtvCand === stamp || inUI(el)) continue;
        if (tiles && inTile(el, stamp)) continue;
        if (!laidOut(el)) continue;
        el.__mbtvCand = stamp; list.push(el);
      }
    }
    // the same, for lists too long to sweep while the panel holding them is shut
    var heavy = site && site.heavy, hb;
    for (i = 0; heavy && i < heavy.length; i++) {
      hb = (scope.matches && scope.matches(heavy[i].when)) ? scope : scope.querySelector(heavy[i].when);
      if (!hb || !shownQuick(hb)) continue;
      nodes = hb.querySelectorAll(heavy[i].sel);
      for (j = 0; j < nodes.length; j++) {
        el = nodes[j];
        if (el.__mbtvCand === stamp || inUI(el)) continue;
        if (!laidOut(el)) continue;
        el.__mbtvCand = stamp; list.push(el);
      }
    }
    // div/span "buttons" that only reveal themselves through cursor: pointer. The style lookup is
    // the expensive part, so skip tile innards and stay near the viewport when a site adapter ran.
    var up = (site && site.sweepUp) || 2.5, down = (site && site.sweepDown) || 3.5;
    var pts = scope.querySelectorAll(POINTER_TAGS);
    for (i = 0; i < pts.length; i++) {
      el = pts[i];
      if (el.__mbtvCand === stamp || inUI(el)) continue;
      if (tiles && inTile(el, stamp)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.bottom < -vh * up || r.top > vh * down) continue;
      if (css(el).cursor !== 'pointer') continue;
      var p = el.parentElement;
      if (p && p !== scope && css(p).cursor === 'pointer') continue;
      if (p && p.closest && p.closest(CLICKY)) continue;
      el.__mbtvCand = stamp; list.push(el);
    }
    var c = { scope: scope, list: list, sy: W.pageYOffset, t: now(), mode: mode };
    caches.unshift(c);
    if (caches.length > 3) caches.pop();   // page, open dialog and player box stop evicting each other
    dirty = false;
    return c;
  }
  function cacheFor(scope) {
    var c = null, i;
    if (dirty) { caches = []; return rescan(scope); }
    for (i = 0; i < caches.length; i++) if (caches[i].scope === scope) { c = caches[i]; break; }
    if (c && (c.mode !== mode || Math.abs(W.pageYOffset - c.sy) > W.innerHeight * 0.6 || now() - c.t > 5000)) c = null;
    return c || rescan(scope);
  }
  function candidates(scope) {
    scope = scope || D.body;
    var cache = cacheFor(scope);
    scanId++;
    var out = [], vh = W.innerHeight, vw = W.innerWidth, i;
    var tile = (mode === 'page' && scope === D.body) ? playerTile() : null;
    var boxArea = (mode === 'controls' && box) ? area(rect(box)) : 0;
    for (i = 0; i < cache.list.length; i++) {
      var el = cache.list[i];
      if (!attached(el)) continue;
      if (tile && tile.contains(el)) continue;
      var r = rect(el);
      if (r.w < 4 || r.h < 4) continue;
      if (r.b < -vh * 2 || r.t > vh * 3 || r.r < -vw || r.l > vw * 2.5) continue;
      if (el.tagName === 'IFRAME' && (r.w < 200 || r.h < 120)) continue;
      if (boxArea && (el === box || area(r) > boxArea * 0.5)) continue;
      if (!shown(el, r) || clipped(el, r)) continue;
      out.push({ el: el, r: r });
    }
    if (tile) {
      var tr = rect(tile);
      if (tr.w > 50 && shown(tile, tr)) out.push({ el: tile, r: tr });
    }
    return out;
  }
  function elems(list) { var a = []; for (var i = 0; i < list.length; i++) a.push(list[i].el); return a; }

  // ------------------------------------------------------------------ spatial navigation
  function findNext(cur, dir, cands) {
    var c = rect(cur), ccx = c.l + c.w / 2, ccy = c.t + c.h / 2, horiz = dir === 'left' || dir === 'right';
    var best = [null, null], bestScore = [Infinity, Infinity];
    var rail = horiz ? scrollerOf(cur) : null;   // inside a carousel, Left/Right never leaves it
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i].el, r = cands[i].r;
      if (el === cur || el.contains(cur) || cur.contains(el)) continue;
      var cx = r.l + r.w / 2, cy = r.t + r.h / 2, primary, overlap;
      if (dir === 'right') {
        if (r.l < c.r - 4 && !(cx > c.r && r.l > c.l + 4)) continue;
        primary = Math.max(0, r.l - c.r);
        overlap = Math.min(c.b, r.b) - Math.max(c.t, r.t);
      } else if (dir === 'left') {
        if (r.r > c.l + 4 && !(cx < c.l && r.r < c.r - 4)) continue;
        primary = Math.max(0, c.l - r.r);
        overlap = Math.min(c.b, r.b) - Math.max(c.t, r.t);
      } else if (dir === 'down') {
        if (r.t < c.b - 4 && !(cy > c.b && r.t > c.t + 4)) continue;
        primary = Math.max(0, r.t - c.b);
        overlap = Math.min(c.r, r.r) - Math.max(c.l, r.l);
      } else {
        if (r.b > c.t + 4 && !(cy < c.t && r.b < c.b - 4)) continue;
        primary = Math.max(0, c.t - r.b);
        overlap = Math.min(c.r, r.r) - Math.max(c.l, r.l);
      }
      var ortho = overlap > 0 ? 0 : -overlap;
      var dPri = horiz ? Math.abs(cx - ccx) : Math.abs(cy - ccy);
      var dOrt = horiz ? Math.abs(cy - ccy) : Math.abs(cx - ccx);
      // left/right: same row only (or nearly level). up/down: same column or roughly below/above first,
      // then anything below/above so you can always get out of a header or a short row.
      var tier;
      if (horiz) {
        if (!(overlap > 0 || ortho <= Math.max(20, c.h * 0.5))) continue;
        if (rail && scrollerOf(el) !== rail) continue;   // don't slip into the row above or below
        tier = 0;
      } else tier = (overlap > 0 || dPri >= dOrt * 0.3) ? 0 : 1;
      var score = primary + ortho * 4 + dOrt * 0.15 - (overlap > 0 ? Math.min(overlap, 40) * 0.5 : 0);
      if (score < bestScore[tier]) { bestScore[tier] = score; best[tier] = el; }
    }
    return best[0] || best[1];
  }
  var hdr = { at: 0, v: 0 };
  function headerOffset() {
    if (now() - hdr.at < 500) return hdr.v;          // asked once per move: a sticky bar does not come and go
    var h = 0, els = D.querySelectorAll('header,nav,[class*="header"],[class*="nav"],[id*="header"],[class*="top"]');
    for (var i = 0; i < els.length && i < 80; i++) {
      var s = css(els[i]);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      var r = rect(els[i]);
      if (r.t <= 2 && r.b > 0 && r.b < W.innerHeight * 0.35 && r.w > W.innerWidth * 0.5) h = Math.max(h, r.b);
    }
    hdr.at = now(); hdr.v = h;
    return h;
  }
  // Bring an element into view: inner scrollers first (rows, lists), then the page, keeping focus near the middle.
  function reveal(el) {
    var r = rect(el), n = el.parentElement;
    while (n && n !== D.body && n !== D.documentElement) {
      var o = ovf(n);
      var sx = o.sx && n.scrollWidth > n.clientWidth + 1;
      var sy = o.sy && n.scrollHeight > n.clientHeight + 1;
      if (sx || sy) {
        var p = rect(n), pad = 40;
        if (sx) {
          if (r.l < p.l + pad) n.scrollLeft -= (p.l + pad - r.l);
          else if (r.r > p.r - pad) n.scrollLeft += (r.r - (p.r - pad));
        }
        if (sy) {
          if (r.t < p.t + pad) n.scrollTop -= (p.t + pad - r.t);
          else if (r.b > p.b - pad) n.scrollTop += (r.b - (p.b - pad));
        }
        r = rect(el);
      }
      if (o.fixed) return;
      n = n.parentElement;
    }
    if (mode !== 'page') return;
    var top = headerOffset() + 24, bottom = W.innerHeight - 32;
    if (r.t < top || r.b > bottom) {
      var mid = top + (W.innerHeight - top) / 2;
      var delta = r.h > bottom - top ? r.t - top : (r.t + r.h / 2) - mid;
      W.scrollBy(0, Math.round(delta));
    }
    if (r.l < 0 || r.r > W.innerWidth) W.scrollBy(r.l < 0 ? Math.round(r.l - 40) : Math.round(r.r - W.innerWidth + 40), 0);
  }
  function pickInitial(cands, scope) {
    if (!cands || !cands.length) return null;
    var vh = W.innerHeight, inPage = mode === 'page' && (!scope || scope === D.body);
    var top = inPage ? headerOffset() : 0, best = null, bestS = Infinity, play = null, i;
    if (inPage && box) for (i = 0; i < cands.length; i++) if (cands[i].el === box && cands[i].r.t < vh && cands[i].r.b > 0) return box;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i], r = c.r;
      if (r.b < 0 || r.t > vh) continue;
      var s = (r.t < top ? 5000 : 0) + r.t * 2 + r.l;
      if (s < bestS) { bestS = s; best = c.el; }
      if (!play && inPage && r.w >= 70 && r.h >= 28 && RE_WATCH.test(labelText(c.el))) play = c.el;
    }
    if (!inPage) {
      for (i = 0; i < cands.length; i++) {
        var el = cands[i].el;
        if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || RE_SELECTED.test(cls(el))) return el;
      }
    }
    return play || best || cands[0].el;
  }
  function pickControl(cands) {
    if (!cands.length || !box) return cands.length ? cands[0].el : null;
    var br = rect(box), best = null, bs = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i].el, r = cands[i].r;
      if (RE_PLAYBTN.test(labelText(el)) && r.t > br.t + br.h * 0.5) return el;
      var s = Math.abs((r.t + r.h / 2) - (br.b - 40)) + Math.abs(r.l - br.l) * 0.3;
      if (s < bs) { bs = s; best = el; }
    }
    return best;
  }
  function findLabeled(scope, re, loose) {
    var list = loose ? looseList(scope) : candidates(scope), best = null, bs = 0, ba = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i].el, s = re.test(labelText(el)) ? 2 : (re.test(labelAttr(el)) ? 1 : 0);
      if (!s) continue;
      var a = area(list[i].r);
      if (s > bs || (s === bs && a < ba)) { best = el; bs = s; ba = a; }
    }
    return best;
  }
  // Everything clickable with a size, visible or not (used while full screen hides the rest of the page).
  function looseList(scope) {
    var out = [], nodes = scope.querySelectorAll(CLICKY);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (inUI(el)) continue;
      var r = rect(el);
      if (r.w > 4 && r.h > 4) out.push({ el: el, r: r });
    }
    return out;
  }

  // ------------------------------------------------------------------ synthetic input
  function fire(el, type, x, y) {
    var nb = /enter|leave/.test(type), ev;
    var init = { bubbles: !nb, cancelable: !nb, view: W, clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: /down/.test(type) ? 1 : 0 };
    if (type.indexOf('pointer') === 0) {
      if (!HAS_POINTER) return;
      init.pointerId = 1; init.pointerType = 'mouse'; init.isPrimary = true; init.width = 1; init.height = 1;
      try { ev = new W.PointerEvent(type, init); } catch (e) { return; }
    } else {
      try { ev = new W.MouseEvent(type, init); } catch (e2) {
        ev = D.createEvent('MouseEvents');
        ev.initMouseEvent(type, init.bubbles, init.cancelable, W, 0, x, y, x, y, false, false, false, false, 0, null);
      }
    }
    try { el.dispatchEvent(ev); } catch (e3) {}
  }
  function hover(el) {
    var c = center(el);
    fire(el, 'pointerover', c.x, c.y); fire(el, 'pointerenter', c.x, c.y);
    fire(el, 'mouseover', c.x, c.y); fire(el, 'mouseenter', c.x, c.y); fire(el, 'mousemove', c.x, c.y);
  }
  function unhover(el) {
    var c = center(el);
    fire(el, 'pointerout', c.x, c.y); fire(el, 'pointerleave', c.x, c.y);
    fire(el, 'mouseout', c.x, c.y); fire(el, 'mouseleave', c.x, c.y);
  }
  function clickEl(el) {
    if (!el || !attached(el)) return;
    var r = rect(el), x = r.l + r.w / 2, y = r.t + r.h / 2, t = el;
    try { var hit = D.elementFromPoint(x, y); if (hit && hit !== el && el.contains(hit)) t = hit; } catch (e) {}
    fire(t, 'pointerover', x, y); fire(t, 'mouseover', x, y);
    fire(t, 'pointerdown', x, y); fire(t, 'mousedown', x, y);
    fire(t, 'pointerup', x, y); fire(t, 'mouseup', x, y);
    if (t === el && typeof el.click === 'function' && /^(A|BUTTON|INPUT|SUMMARY|LABEL)$/.test(el.tagName)) el.click();
    else fire(t, 'click', x, y);
  }
  function sendKey(target, keyCode, key) {
    var types = ['keydown', 'keyup'];
    for (var i = 0; i < types.length; i++) {
      var ev;
      try {
        ev = new W.KeyboardEvent(types[i], { key: key, code: key, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true });
      } catch (e) { ev = D.createEvent('Event'); ev.initEvent(types[i], true, true); }
      try {
        Object.defineProperty(ev, 'keyCode', { get: function () { return keyCode; } });
        Object.defineProperty(ev, 'which', { get: function () { return keyCode; } });
        if (!ev.key) Object.defineProperty(ev, 'key', { get: function () { return key; } });
      } catch (e2) {}
      ev.__mbtv = true;   // old engines without isTrusted: never treat our own Escape as a remote press
      try { (target || D).dispatchEvent(ev); } catch (e3) {}
    }
  }

  // ------------------------------------------------------------------ focus
  function setFocus(el, opts) {
    if (!el) return;
    var prev = focusEl;
    if (prev && prev !== el && attached(prev)) unhover(prev);
    focusEl = el;
    if (!opts || !opts.noScroll) reveal(el);
    hover(el);
    var tag = el.tagName, ti = el.getAttribute('tabindex');
    if (!/^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(tag) && !el.isContentEditable &&
      (/^(A|BUTTON)$/.test(tag) || (ti !== null && parseInt(ti, 10) >= 0))) {
      try { el.focus({ preventScroll: true }); } catch (e) {}
    }
    drawRing();
  }
  function refocus() {
    var scope = currentScope(), c = candidates(scope);
    var el = (mode === 'controls' && !traps.length) ? pickControl(c) : pickInitial(c, scope);
    if (el) setFocus(el); else { focusEl = null; drawRing(); }
  }
  function move(dir, e) {
    if (e && e.repeat && now() - lastMove < 90) return;
    lastMove = now();
    var scope = currentScope(), cands = candidates(scope);
    if (!cands.length) { if (mode === 'page' && (dir === 'up' || dir === 'down')) nudge(dir); return; }
    var cur = focusEl && attached(focusEl) && scope.contains(focusEl) && shown(focusEl) ? focusEl : null;
    if (!cur) { setFocus((mode === 'controls' && !traps.length) ? pickControl(cands) : pickInitial(cands, scope)); return; }
    var next = findNext(cur, dir, cands);
    if (next) setFocus(next);
    else if (mode === 'page' && scope === D.body && (dir === 'up' || dir === 'down')) nudge(dir);
  }
  function nudge(dir) {
    W.scrollBy(0, (dir === 'down' ? 1 : -1) * Math.round(W.innerHeight * 0.4));
    markDirty(); drawRing();
  }
  function pageJump(dir) {
    W.scrollBy(0, dir * Math.round(W.innerHeight * 0.8));
    markDirty();
    var cands = candidates(currentScope()), top = headerOffset(), best = null, bs = Infinity;
    var x = focusEl && attached(focusEl) ? center(focusEl).x : W.innerWidth / 2;
    for (var i = 0; i < cands.length; i++) {
      var r = cands[i].r;
      if (r.t < top || r.b > W.innerHeight) continue;
      var s = r.t * 2 + Math.abs(r.l + r.w / 2 - x);
      if (s < bs) { bs = s; best = cands[i].el; }
    }
    if (best) setFocus(best, { noScroll: true }); else drawRing();
  }

  // ------------------------------------------------------------------ popups that hold the focus
  function commonAncestor(nodes) {
    var a = nodes[0];
    for (var i = 1; i < nodes.length && a; i++) { while (a && !a.contains(nodes[i])) a = a.parentElement; }
    return a;
  }
  function overlayish(el) {
    var n = el, depth = 0;
    while (n && n !== D.body && depth < 10) {
      var s = css(n), role = (n.getAttribute && n.getAttribute('role')) || '';
      if (s.position === 'fixed') return true;
      if (s.position === 'absolute' && (s.zIndex !== 'auto' || /menu|pop|drop|modal|dialog|layer|overlay|panel|list|select|option/i.test(cls(n)))) return true;
      if (/dialog|menu|listbox/.test(role) || (n.getAttribute && n.getAttribute('aria-modal') === 'true')) return true;
      n = n.parentElement; depth++;
    }
    return false;
  }
  function baseScope() { return (mode === 'controls' && box && attached(box)) ? box : D.body; }
  function pruneTraps() {
    while (traps.length) {
      var t = traps[traps.length - 1];
      if (attached(t.box) && shown(t.box) && candidates(t.box).length) break;
      traps.pop();
    }
  }
  function currentScope() { pruneTraps(); return traps.length ? traps[traps.length - 1].box : baseScope(); }
  function pushTrap(opener, container) {
    for (var i = 0; i < traps.length; i++) if (traps[i].box === container) { traps.splice(i + 1); return; }
    traps.push({ opener: opener, box: container });
  }
  function preferred(nodes) {
    var best = null, bs = Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || RE_SELECTED.test(cls(el))) return el;
      var r = rect(el), s = r.t * 2 + r.l;
      if (s < bs) { bs = s; best = el; }
    }
    return best;
  }
  function watchForPopup(opener, before) {
    var tries = 0;
    var check = function () {
      tries++;
      markDirty();
      var after = candidates(baseScope()), fresh = [];
      for (var i = 0; i < after.length; i++) if (before.indexOf(after[i].el) < 0) fresh.push(after[i].el);
      if (fresh.length) {
        var container = commonAncestor(fresh);
        var isMenu = mode === 'controls' ?
          (fresh.length >= 2 && box && (overlayish(container) || area(rect(container)) < area(rect(box)) * 0.5)) :
          overlayish(container);
        if (container && container !== D.body && isMenu) {
          pushTrap(opener, container);
          setFocus(preferred(fresh), { noScroll: mode !== 'page' });
          return;
        }
      }
      if (focusEl && (!attached(focusEl) || !shown(focusEl))) {
        var snap = traps.slice(), target = null, k;
        pruneTraps();
        for (k = snap.length - 1; k >= traps.length && !target; k--) {
          var o = snap[k].opener;
          if (o && attached(o) && shown(o)) target = o;
        }
        if (!target && opener && attached(opener) && shown(opener)) target = opener;
        if (target) setFocus(target, { noScroll: mode !== 'page' }); else refocus();
        return;
      }
      if (tries < 3) setTimeout(check, 220);
    };
    setTimeout(check, 160);
  }
  function openDialog() {
    var list = D.querySelectorAll(DIALOG_SEL), best = null, bestZ = -1;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (inUI(el)) continue;
      var r = rect(el);
      if (r.w < 120 || r.h < 80 || !shown(el, r)) continue;
      var z = parseInt(css(el).zIndex, 10) || 0;
      if (z >= bestZ) { bestZ = z; best = el; }
    }
    return best;
  }
  function adoptDialog() {
    if (traps.length || mode !== 'page') return false;
    var dlg = openDialog();
    if (!dlg) return false;
    var c = candidates(dlg);
    if (!c.length) return false;
    traps.push({ opener: focusEl, box: dlg });
    if (!focusEl || !dlg.contains(focusEl)) { setFocus(pickInitial(c, dlg), { noScroll: true }); return true; }
    return false;
  }
  // A menu the site closes by noticing a click somewhere else. Clicking its opener again would
  // reopen it, and it has no close button of its own, so Back has to behave like that outside
  // click instead: send one at the page root, where it reaches the site's own window handler.
  function dismissable(box) {
    return !!(site && site.dismiss && box && box.closest && box.closest(site.dismiss));
  }
  function clickAway() {
    fire(D.documentElement, 'click', 0, 0);
  }
  function closeTop() {
    var t = traps[traps.length - 1];
    if (!t) return;
    sendKey(focusEl && t.box.contains(focusEl) ? focusEl : t.box, 27, 'Escape');
    setTimeout(function () {
      markDirty();
      if (attached(t.box) && shown(t.box) && candidates(t.box).length) {
        var closer = findLabeled(t.box, RE_CLOSE);
        if (closer) clickEl(closer);
        else if (dismissable(t.box)) clickAway();
        else if (t.opener && attached(t.opener) && !t.box.contains(t.opener) && shown(t.opener)) clickEl(t.opener);
      }
      setTimeout(function () {
        markDirty();
        var i = traps.indexOf(t);
        if (i >= 0) traps.splice(i);
        pruneTraps();
        if (t.opener && attached(t.opener) && shown(t.opener)) setFocus(t.opener, { noScroll: mode !== 'page' });
        else refocus();
      }, 160);
    }, 120);
  }

  // ------------------------------------------------------------------ activation
  function activate(el) {
    if (!el || !attached(el)) return;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) {
      if (/^(checkbox|radio|submit|button|reset|image|file|range|color)$/i.test(el.type || '')) { clickEl(el); return; }
      try { el.focus(); } catch (e) {}   // the TV keyboard opens
      return;
    }
    if (tag === 'SELECT') { openSelect(el); return; }
    if (tag === 'IFRAME') { enterFrame(el); return; }
    if (mode === 'page' && box && el === box) { enterWatch(true); return; }
    if (tag === 'A') {
      var tg = el.getAttribute('target');
      if (tg && tg !== '_self') el.setAttribute('target', '_self');
      savePos();
    }
    markDirty();
    var before = elems(candidates(baseScope()));
    clickEl(el);
    watchForPopup(el, before);
  }
  function openSelect(sel) {
    var items = [], opts = sel.options;
    for (var i = 0; i < opts.length; i++) (function (idx) {
      if (opts[idx].disabled) return;
      items.push({ label: opts[idx].text, selected: opts[idx].selected, run: function () {
        sel.selectedIndex = idx;
        var evs = ['input', 'change'];
        for (var j = 0; j < evs.length; j++) {
          var ev; try { ev = new Event(evs[j], { bubbles: true }); } catch (e) { ev = D.createEvent('HTMLEvents'); ev.initEvent(evs[j], true, false); }
          sel.dispatchEvent(ev);
        }
        markDirty(); setFocus(sel, { noScroll: true });
      } });
    })(i);
    var title = sel.getAttribute('aria-label') || sel.getAttribute('title') || '';
    if (!title && sel.id) { var lb = D.querySelector('label[for="' + sel.id + '"]'); if (lb) title = shortText(lb); }
    openPanel(title || 'Choose', items, 'picker');
  }

  // ------------------------------------------------------------------ player
  function mainVideo() {
    var vids = D.getElementsByTagName('video'), best = null, bestA = 0;
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i], r = rect(v), a = area(r);
      if (r.w < 240 || r.h < 130) continue;
      if (v.muted && (v.loop || v.autoplay) && v.paused === false && mode === 'page') continue; // background trailers
      if (!v.paused) a *= 4;
      if (a > bestA) { bestA = a; best = v; }
    }
    return best;
  }
  function playerBoxOf(v) {
    var vr = rect(v), same = v, named = null, n = v.parentElement, depth = 0;
    while (n && n !== D.body && n !== D.documentElement && depth < 10) {
      var r = rect(n);
      if (r.w > vr.w * 1.6 + 4 || r.h > vr.h * 1.9 + 4) break;
      if (r.w <= vr.w * 1.15 + 4 && r.h <= vr.h * 1.4 + 4) same = n;
      if (PLAYER_RE.test(cls(n) + ' ' + (n.id || ''))) named = n;
      n = n.parentElement; depth++;
    }
    return (named && named.contains(same)) ? named : same;
  }
  function playerTile() {
    var v = mainVideo();
    if (!v) return null;
    if (v !== video || !box || !attached(box) || !box.contains(v)) { video = v; box = playerBoxOf(v); }
    return box;
  }
  function ensurePlayer() {
    var v = (video && attached(video) && box && attached(box) && box.contains(video)) ? video : mainVideo();
    if (!v) return false;
    if (v !== video || !box || !attached(box) || !box.contains(v)) {
      video = v; box = playerBoxOf(v);
      if (pseudo.el && pseudo.el.tagName !== 'IFRAME' && pseudo.el !== box) pseudoFS(box, true);
    }
    return true;
  }
  function html5(v) {
    return {
      play: function () { try { var p = v.play(); if (p && p['catch']) p['catch'](function () {}); } catch (e) {} },
      pause: function () { try { v.pause(); } catch (e) {} },
      toggle: function () { if (v.paused || v.ended) this.play(); else this.pause(); },
      time: function () { return v.currentTime || 0; },
      duration: function () {
        var d = v.duration;
        if (!isFinite(d) || d <= 0) { try { if (v.seekable && v.seekable.length) d = v.seekable.end(v.seekable.length - 1); } catch (e) {} }
        return (isFinite(d) && d > 0) ? d : 0;
      },
      seek: function (t) { try { v.currentTime = t; } catch (e) {} }
    };
  }
  function api() { return ensurePlayer() ? html5(video) : null; }
  function startPlayback() {
    var v = video;
    if (!v) return;
    if (v.currentSrc || v.src || v.querySelector('source')) html5(v).play();
    setTimeout(function () {
      if (video && video.paused && box) {
        var big = findLabeled(box, RE_START);
        if (big) clickEl(big);
      }
    }, 600);
  }
  function seekBy(dir, step, quiet) {
    var a = api();
    if (!a) return;
    var t = now();
    if (dir === sk.dir && t - sk.at < 1100) sk.count++; else sk.count = 0;
    sk.dir = dir; sk.at = t;
    if (!step) step = sk.count >= 8 ? 60 : (sk.count >= 3 ? 30 : CFG.seekStep);
    var from = sk.target !== null ? sk.target : a.time(), d = a.duration();
    var to = from + dir * step;
    to = d ? clamp(to, 0, Math.max(0, d - 2)) : Math.max(0, to);
    sk.target = to; sk.quiet = !!quiet;
    if (!quiet) osd(true);
    clearTimeout(sk.timer);
    sk.timer = setTimeout(applySeek, quiet ? 250 : 450);
  }
  function applySeek() {
    if (sk.target === null) return;
    var a = api(), to = sk.target;
    sk.target = null;
    if (a) a.seek(to);
    if (!sk.quiet && mode === 'watch') osd(true);
  }
  function fsElement() { return D.fullscreenElement || D.webkitFullscreenElement || D.webkitCurrentFullScreenElement || null; }
  function requestNativeFS(el) {
    try {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.webkitRequestFullScreen) el.webkitRequestFullScreen();
    } catch (e) {}
  }
  function exitNativeFS() {
    try {
      if (D.exitFullscreen) D.exitFullscreen();
      else if (D.webkitExitFullscreen) D.webkitExitFullscreen();
      else if (D.webkitCancelFullScreen) D.webkitCancelFullScreen();
    } catch (e) {}
  }
  function kickResize() {
    setTimeout(function () {
      var ev;
      try { ev = new Event('resize'); } catch (e) { ev = D.createEvent('UIEvents'); ev.initUIEvent('resize', true, false, W, 0); }
      W.dispatchEvent(ev);
      markDirty(); drawRing();
    }, 60);
  }
  // Fill the screen with one element and hide everything around it (no Fullscreen API needed).
  function pseudoFS(el, on) {
    var i;
    if (pseudo.el && (!on || pseudo.el !== el)) {
      var sy = pseudo.sy;
      pseudo.el.classList.remove('mbtv-fs');
      for (i = 0; i < pseudo.chain.length; i++) pseudo.chain[i].classList.remove('mbtv-fs-chain');
      for (i = 0; i < pseudo.hidden.length; i++) pseudo.hidden[i].classList.remove('mbtv-fs-hide');
      for (i = 0; i < pseudo.inner.length; i++) pseudo.inner[i].classList.remove('mbtv-fs-inner');
      pseudo = { el: null, chain: [], hidden: [], inner: [], sy: 0 };
      D.documentElement.classList.remove('mbtv-fs-on');
      W.scrollTo(0, sy);
      kickResize();
    }
    if (!on || !el || pseudo.el === el) return;
    pseudo.el = el; pseudo.sy = W.pageYOffset;
    el.classList.add('mbtv-fs');
    if (video && el !== video && el.contains(video)) {
      for (var m = video; m && m !== el; m = m.parentElement) { m.classList.add('mbtv-fs-inner'); pseudo.inner.push(m); }
    }
    var n = el;
    while (n.parentElement) {
      var p = n.parentElement;
      if (p === D.documentElement) break;
      p.classList.add('mbtv-fs-chain'); pseudo.chain.push(p);
      for (var k = p.firstElementChild; k; k = k.nextElementSibling) {
        if (k !== n && k !== ui.root && !k.classList.contains('mbtv-fs-hide')) { k.classList.add('mbtv-fs-hide'); pseudo.hidden.push(k); }
      }
      if (p === D.body) break;
      n = p;
    }
    D.documentElement.classList.add('mbtv-fs-on');
    kickResize();
  }
  function enterWatch(fromKey) {
    if (!ensurePlayer()) return false;
    stopControls();
    mode = 'watch'; traps = [];
    if (focusEl && attached(focusEl)) unhover(focusEl);
    focusEl = null;
    var f = fsElement();
    if (!(f && f.contains(video))) {
      if (CFG.fullscreen === 'native' && fromKey) {
        requestNativeFS(box);
        setTimeout(function () { if (mode !== 'page' && !fsElement()) pseudoFS(box, true); }, 400);
      } else pseudoFS(box, true);
    }
    if (!IS_TOP) postParent({ mbtv: 'fs', on: true });
    if (video.paused && fromKey) startPlayback();
    video.__mbtvDismissed = null;
    qSoon();
    markDirty(); drawRing(); osd(true);
    return true;
  }
  function exitWatch() {
    stopControls();
    hideOSD();
    pseudoFS(null, false);
    if (fsElement()) exitNativeFS();
    // Prefer the site's own close button: it saves the watched position and disposes the player,
    // instead of leaving it running behind the page.
    var closed = false;
    if (site && site.close && video && attached(video)) { try { closed = !!site.close(video); } catch (e) { log(e); } }
    if (video && !closed) video.__mbtvDismissed = video.currentSrc || video.src || 'x';
    if (!IS_TOP) { postParent({ mbtv: 'fs', on: false }); exitFrame(); return; }
    mode = 'page'; traps = [];
    markDirty();
    if (closed) {
      video = null; box = null; focusEl = null;
      drawRing();
      setTimeout(function () { if (mode === 'page' && !focusEl) { markDirty(); refocus(); } }, 300);
      return;
    }
    if (box && attached(box)) setFocus(box); else refocus();
  }
  function wake() {
    if (!box || !attached(box)) return;
    ctl.tick++;
    var r = rect(box), x = r.l + r.w / 2 + (ctl.tick % 2 ? 1 : -1), y = r.t + r.h * 0.6, t = null;
    try { t = D.elementFromPoint(x, y); } catch (e) {}
    if (!t || !box.contains(t)) t = (video && box.contains(video)) ? video : box;
    fire(t, 'pointermove', x, y); fire(t, 'mousemove', x, y);
    if (t !== box) fire(box, 'mousemove', x, y);
  }
  function enterControls() {
    if (!ensurePlayer()) return;
    mode = 'controls'; traps = [];
    hideOSD(); markDirty(); wake();
    clearInterval(ctl.timer);
    ctl.timer = setInterval(controlsTick, 1200);
    setTimeout(function () {
      if (mode !== 'controls') return;
      markDirty();
      var c = candidates(currentScope());
      if (c.length) setFocus(pickControl(c), { noScroll: true });
      else setTimeout(function () { if (mode === 'controls' && !focusEl) { markDirty(); refocus(); } }, 300);
    }, 180);
  }
  function controlsTick() {
    if (mode !== 'controls') { clearInterval(ctl.timer); return; }
    pruneTraps();
    if (!traps.length && now() - lastKey > CFG.controlsTimeout) { leaveControls(); return; }
    wake();
  }
  function stopControls() { clearInterval(ctl.timer); ctl.timer = null; }
  function leaveControls() {
    stopControls();
    if (focusEl && attached(focusEl)) unhover(focusEl);
    traps = []; focusEl = null; mode = 'watch';
    drawRing();
    if (box && attached(box)) { var c = center(box); fire(box, 'mouseout', c.x, c.y); fire(box, 'mouseleave', c.x, c.y); }
    try { if (D.activeElement && box && box.contains(D.activeElement)) D.activeElement.blur(); } catch (e) {}
  }
  function openPlayerMenu(re, name, key) {
    if (!ensurePlayer()) return;
    if (mode !== 'controls') enterControls();
    wake();
    var tries = 0;
    var go = function () {
      tries++;
      markDirty(); wake();
      var btn = playerBtn(key) || findLabeled(box, re);
      if (!btn) { if (tries < 3) setTimeout(go, 250); else toast('No ' + name + ' button in this player'); return; }
      setFocus(btn, { noScroll: true });
      activate(btn);
    };
    setTimeout(go, 260);
  }
  function episode(dir) {
    // the player's own next button keeps playback going without a reload: much the best route
    if (dir > 0) {
      var nb = playerBtn('next');
      if (nb) { toast('Next episode'); clickRaw(nb); return; }
    }
    // no previous button exists, and next is hidden on a season's last episode: use the grid
    if (site && site.episode) { try { if (site.episode(dir)) return; } catch (e) { log(e); } }
    var re = dir > 0 ? RE_NEXT : RE_PREV;
    var el = (box && attached(box)) ? findLabeled(box, re) : null;
    if (!el) el = findLabeled(D.body, re, true);
    if (!el) { toast(dir > 0 ? 'No next-episode button found' : 'No previous-episode button found'); return; }
    toast(dir > 0 ? 'Next episode' : 'Previous episode');
    if (el.tagName === 'A') { var tg = el.getAttribute('target'); if (tg && tg !== '_self') el.setAttribute('target', '_self'); }
    clickEl(el);
  }
  // ---------------------------------------------------------------- quality
  // Left alone, the site reopens at whatever rung it used last, and that is frequently 360p
  // on a film that has a 1080p rung ready. This reads the menu once per title and moves up
  // if it can. It only ever moves up: a rung the viewer picked by hand is never overridden.
  var qd = { done: '', tries: 0, timer: null };
  function qCfg() { return (site && site.quality) || null; }
  function qParse(li, c) {
    var t = li.querySelector(c.title), m = li.querySelector(c.meta);
    var q = { el: li, name: t ? String(t.textContent || '').replace(/\s+/g, ' ') : '',
      meta: m ? String(m.textContent || '') : '', h: 0, mbps: 0, adaptive: false, newCodec: false };
    q.adaptive = /adaptive/i.test(q.meta) || /^auto$/i.test(q.name);
    q.newCodec = /hevc|h\.?265|av1|vp9/i.test(q.meta);   // anything past H.264
    // "1920x816" is a scope frame at 1080p: the short side is the one the panel has to push,
    // and using it keeps the rungs in the right order while reading honestly against the cap
    var res = q.meta.match(/(\d{3,5})\s*[x\u00d7]\s*(\d{3,5})/);
    if (res) q.h = Math.min(parseInt(res[1], 10), parseInt(res[2], 10));
    if (!q.h) { var n = q.name.match(/(\d{3,4})\s*p/i); if (n) q.h = parseInt(n[1], 10); }
    if (!q.h && /4k|uhd|2160/i.test(q.name)) q.h = 2160;
    var b = q.meta.match(/([\d.]+)\s*mbps/i), k = q.meta.match(/([\d.]+)\s*kbps/i);
    if (b) q.mbps = parseFloat(b[1]); else if (k) q.mbps = parseFloat(k[1]) / 1000;
    return q;
  }
  function qList() {
    var c = qCfg();
    if (!c || !box || !attached(box)) return [];
    var menu = box.querySelector(c.menu) || D.querySelector(c.menu);
    if (!menu) return [];
    var nodes = menu.querySelectorAll(c.item), out = [], i;
    for (i = 0; i < nodes.length; i++) out.push(qParse(nodes[i], c));
    return out;
  }
  function qPicked(q) {
    return q.el.getAttribute('aria-checked') === 'true' || /(^|\s)vjs-selected(\s|$)/.test(cls(q.el));
  }
  function qBest(list) {
    var i, q, best = null;
    if (CFG.quality === 'auto') {
      for (i = 0; i < list.length; i++) if (list[i].adaptive) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      q = list[i];
      if (q.adaptive || !q.h) continue;                 // nothing here to judge a rung by
      if (q.h > CFG.qualityMax) continue;               // more than the panel can show
      if (CFG.qualityMaxMbps && q.mbps > CFG.qualityMaxMbps) continue;
      if (q.newCodec && !CFG.qualityNewCodecs) continue;
      if (!best || q.h > best.h || (q.h === best.h && q.mbps > best.mbps)) best = q;
    }
    return best;
  }
  // One title, one attempt. Keyed on the on-screen name rather than the source, because
  // switching rung swaps the source and would otherwise look like a fresh video to us.
  function qKey() {
    var t = (site && site.title && box) ? box.querySelector(site.title) : null;
    return location.pathname + location.search + '|' + (t ? String(t.textContent || '') : '');
  }
  function qSoon() {
    if (!qCfg() || CFG.quality === 'off') return;
    clearTimeout(qd.timer);
    qd.timer = setTimeout(applyQuality, 900);
  }
  function applyQuality() {
    var c = qCfg();
    if (!c || CFG.quality === 'off' || !ensurePlayer()) return;
    var key = qKey();
    if (qd.done === key) return;
    var list = qList(), i, cur = null;
    if (!list.length) {       // the menu is filled a moment after the stream attaches
      if (qd.tries++ < 6) { clearTimeout(qd.timer); qd.timer = setTimeout(applyQuality, 1200); }
      return;
    }
    qd.tries = 0;
    for (i = 0; i < list.length; i++) if (qPicked(list[i])) cur = list[i];
    var best = qBest(list);
    qd.done = key;            // whatever happens next, don't come back at this title again
    if (!best || (cur && cur.el === best.el)) return;
    if (cur && !cur.adaptive && cur.h >= best.h) return;   // never step down behind the viewer
    log('quality ' + (cur ? cur.name : '?') + ' -> ' + best.name + ' (' + best.meta + ')');
    toast('Quality \u2192 ' + best.name);
    clickRaw(best.el);
    // A menu item that was never on screen may not take. The site's other picker lists the
    // same rungs under the same names, so check and go round again rather than quietly lie.
    setTimeout(function () {
      var l2 = qList(), j, now2 = null;
      for (j = 0; j < l2.length; j++) if (qPicked(l2[j])) now2 = l2[j];
      if (now2 && now2.name === best.name) return;
      if (!c.fallback || !box || !attached(box)) return;
      var ps = box.querySelectorAll(c.fallback);
      for (j = 0; j < ps.length; j++) {
        if (String(ps[j].textContent || '').replace(/\s+/g, '') === best.name) { clickRaw(ps[j]); return; }
      }
    }, 2400);
  }

  // ---------------------------------------------------------------- subtitle sync
  // CH+ / CH- drive the site's own delay control. Inside the player those two keys were a
  // third name for next/previous episode - Yellow and the media track keys still do that -
  // so nothing is lost, and the setting that actually needs nudging mid-scene gets a dial
  // instead of a trip through two menus.
  var dly = { timer: null };
  function delayCfg() { return (site && site.delay) || null; }
  function delayPanel() {
    var c = delayCfg();
    if (!c || !box || !attached(box)) return null;
    var p = box.querySelector(c.panel);
    if (!p) return null;
    // measure the panel itself rather than ask shown(): that answer is memoised per scan, and
    // these keys open the panel and read it back inside one scan generation
    var r = p.getBoundingClientRect();
    return (r.width > 2 && r.height > 2 && css(p).visibility !== 'hidden') ? p : null;
  }
  function delayText(p) {
    var c = delayCfg(), v = (c && c.value) ? p.querySelector(c.value) : null;
    var t = v ? String(v.textContent || '').replace(/\s+/g, '') : '';
    if (!t) { t = p.getAttribute('data-delay') || ''; if (t) t += 's'; }
    return t;
  }
  function delayStep(p, dir) {
    var c = delayCfg(), btn = p.querySelector(dir > 0 ? c.up : c.down);
    if (!btn) { toast('No subtitle-delay control in this player'); return; }
    clickRaw(btn);
    // the readout is written by the site's own handler, so read it back after that has run
    setTimeout(function () {
      var open = delayPanel(), t = open ? delayText(open) : '';
      toast('Subtitle delay ' + (t || (dir > 0 ? 'later' : 'earlier')));
    }, 60);
    // hold the panel open while the key repeats, then put it away again
    clearTimeout(dly.timer);
    dly.timer = setTimeout(hideDelay, 2200);
  }
  function hideDelay() {
    var p = delayPanel(), c = delayCfg();
    if (!p) return;
    var x = c.close ? p.querySelector(c.close) : null;
    if (x) clickRaw(x); else p.style.display = 'none';
    markDirty();
  }
  function subDelay(dir) {
    var c = delayCfg();
    if (!c) { episode(dir); return; }     // no adapter for this site: keep the old meaning
    if (!ensurePlayer()) return;
    var p = delayPanel();
    if (p) { delayStep(p, dir); return; }
    // Not open yet. The delay button sits on the player's subtitle toolbar, which is itself
    // hidden at TV window sizes; a direct click still runs the site's handler. Should it ever
    // stop being wired that way, show the panel ourselves rather than swallow the key.
    var opener = c.open ? box.querySelector(c.open) : null;
    if (opener) clickRaw(opener);
    setTimeout(function () {
      var open = delayPanel();
      if (!open) {
        var raw = box.querySelector(c.panel);
        if (raw) { raw.style.display = 'block'; markDirty(); open = delayPanel(); }
      }
      if (open) delayStep(open, dir);
      else toast('No subtitle-delay control in this player');
    }, 140);
  }

  function isSeekBar(el) {
    if (!box) return false;
    var wide = rect(el).w > rect(box).w * 0.3;
    return wide && (el.getAttribute('role') === 'slider' || RE_SEEKBAR.test(labelAttr(el)));
  }
  function onPlaying(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    if (rect(v).w >= 240) qSoon();   // pick the rung on any real playback, watching or not
    if (!CFG.autoWatch || mode !== 'page' || panel) return;
    if (!IS_TOP && !frameActive) return;
    if (v.__mbtvDismissed && v.__mbtvDismissed === (v.currentSrc || v.src || 'x')) return;
    if (v.muted || rect(v).w < W.innerWidth * 0.35) return;
    var d = v.duration;
    if (isFinite(d) && d > 0 && d < 240) return; // trailers and previews
    video = v; box = playerBoxOf(v);
    enterWatch(false);
  }
  function onFSChange() {
    var f = fsElement(), host = (f && f.tagName !== 'VIDEO') ? f : D.body;
    if (ui.root && ui.root.parentNode !== host) host.appendChild(ui.root);
    if (f) {
      var v = mainVideo();
      if (v && f.contains(v) && mode === 'page') { video = v; box = playerBoxOf(v); mode = 'watch'; focusEl = null; drawRing(); osd(true); }
    } else if ((mode === 'watch' || mode === 'controls') && !pseudo.el) {
      stopControls(); hideOSD(); mode = 'page'; traps = []; markDirty();
      if (box && attached(box)) setFocus(box);
    }
  }

  // ------------------------------------------------------------------ iframes (in case the player lives in one)
  function postTo(win, msg) { try { win.postMessage(msg, '*'); } catch (e) {} }
  function postParent(msg) { if (!IS_TOP) postTo(W.parent, msg); }
  function frameFor(win) {
    var fs = D.getElementsByTagName('iframe');
    for (var i = 0; i < fs.length; i++) { try { if (fs[i].contentWindow === win) return fs[i]; } catch (e) {} }
    return null;
  }
  function takeFocusBack() {
    try { if (D.activeElement && D.activeElement.tagName === 'IFRAME') D.activeElement.blur(); } catch (e) {}
    try { W.focus(); } catch (e2) {}
  }
  function enterFrame(ifr) {
    frameEl = ifr; mode = 'frame';
    if (focusEl && attached(focusEl)) unhover(focusEl);
    drawRing();
    try { ifr.focus(); } catch (e) {}
    try { ifr.contentWindow.focus(); } catch (e2) {}
    postTo(ifr.contentWindow, { mbtv: 'enter' });
  }
  function exitFrame() {
    frameActive = false; mode = 'idle'; traps = [];
    if (focusEl && attached(focusEl)) unhover(focusEl);
    focusEl = null; drawRing(); hideOSD(); closePanel();
    postParent({ mbtv: 'exit' });
  }
  function onMessage(e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || !d.mbtv) return;
    if (IS_TOP) {
      var ifr = frameFor(e.source);
      if (!ifr) return;
      if (d.mbtv === 'exit') {
        if (pseudo.el === ifr) pseudoFS(null, false);
        if (frameEl === ifr) { frameEl = null; mode = 'page'; markDirty(); takeFocusBack(); setFocus(ifr); }
      } else if (d.mbtv === 'fs') {
        if (d.on) pseudoFS(ifr, true); else if (pseudo.el === ifr) pseudoFS(null, false);
      } else if (d.mbtv === 'reclaim') {
        takeFocusBack();
        if (mode === 'frame') { frameEl = null; mode = 'page'; }
        dispatchCode(d.code, null);
      }
    } else {
      if (e.source !== W.parent) return;
      if (d.mbtv === 'enter') {
        frameActive = true; mode = 'page';
        if (!enterWatch(true)) refocus();
      } else if (d.mbtv === 'key' && frameActive) {
        dispatchCode(d.code, { repeat: !!d.repeat });
      }
    }
  }

  // ------------------------------------------------------------------ back, history, position memory
  function posKey() { return 'mbtv:pos:' + location.href; }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== D.body && parts.length < 14) {
      var i = 1, s = el.previousElementSibling;
      while (s) { if (s.tagName === el.tagName) i++; s = s.previousElementSibling; }
      parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  }
  function savePos() {
    if (!IS_TOP || mode !== 'page') return;
    try {
      var st = { sx: W.pageXOffset, sy: W.pageYOffset, t: now() };
      if (focusEl && attached(focusEl)) {
        var a = focusEl.tagName === 'A' ? focusEl : (focusEl.closest ? focusEl.closest('a[href]') : null);
        st.href = a ? a.href : null;
        st.path = cssPath(focusEl);
      }
      W.sessionStorage.setItem(posKey(), JSON.stringify(st));
    } catch (e) {}
  }
  function restorePos() {
    var st = null;
    try { st = JSON.parse(W.sessionStorage.getItem(posKey()) || 'null'); } catch (e) {}
    if (!st || now() - st.t > 6 * 3600 * 1000) return false;
    var tries = 0;
    var attempt = function () {
      tries++;
      if (focusEl || mode !== 'page') return;
      var el = null, i;
      if (st.href) {
        var as = D.querySelectorAll('a[href]');
        for (i = 0; i < as.length; i++) if (as[i].href === st.href && shownQuick(as[i])) { el = as[i]; break; }
      }
      if (!el && st.path) { try { el = D.querySelector(st.path); } catch (e2) {} if (el && !shownQuick(el)) el = null; }
      W.scrollTo(st.sx, st.sy);   // also nudges lazy-loading lists to fetch the rows we were in
      if (el) { markDirty(); setFocus(el); return; }
      if (tries < 15) setTimeout(attempt, 200);
      else { markDirty(); refocus(); }
    };
    attempt();
    return true;
  }
  function goBack() {
    if (!IS_TOP) { exitFrame(); return; }
    var href = location.href;
    savePos();
    history.back();
    setTimeout(function () { if (!leaving && location.href === href && mode === 'page' && !panel) openQuick(true); }, 1200);
  }
  function exitApp() {
    try { W.tizen.application.getCurrentApplication().exit(); return; } catch (e) {}
    history.back();
  }
  function pageBack() {
    if (typing()) { D.activeElement.blur(); drawRing(); return; }
    pruneTraps();
    if (traps.length) { closeTop(); return; }
    var dlg = openDialog();
    if (dlg && candidates(dlg).length) { traps.push({ opener: focusEl, box: dlg }); closeTop(); return; }
    goBack();
  }
  function findSearchInput() {
    var ins = D.querySelectorAll('input,textarea'), fallback = null;
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], ty = (el.type || '').toLowerCase();
      if (ty && !/^(search|text)$/.test(ty)) continue;
      var hint = ty + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + cls(el) + ' ' + (el.getAttribute('aria-label') || '');
      if (ty === 'search' || RE_SEARCH.test(hint)) { if (shownQuick(el)) return el; if (!fallback) fallback = el; }
    }
    return fallback;
  }
  function focusSearch() {
    if (mode !== 'page') return;
    var inp = findSearchInput();
    if (inp && shownQuick(inp)) { setFocus(inp); try { inp.focus(); } catch (e) {} return; }
    var trig = findLabeled(D.body, RE_SEARCH);
    if (trig) {
      clickEl(trig);
      setTimeout(function () {
        markDirty();
        var i2 = findSearchInput();
        if (i2 && shownQuick(i2)) { setFocus(i2); try { i2.focus(); } catch (e) {} } else if (attached(trig)) setFocus(trig);
      }, 400);
      return;
    }
    toast('No search box on this page');
  }
  function goTo(path) { savePos(); location.href = siteURL(path); }

  // ------------------------------------------------------------------ key handling per mode
  function typingKey(code, e) {
    var a = D.activeElement;
    if (code === K.BACK) { a.blur(); drawRing(); return true; }
    if (code === K.UP || code === K.DOWN) { a.blur(); move(code === K.UP ? 'up' : 'down', e); return true; }
    if ((code === K.LEFT || code === K.RIGHT) && !a.value) { a.blur(); move(code === K.LEFT ? 'left' : 'right', e); return true; }
    return false;   // OK submits, Left/Right move the caret
  }
  function pageKey(code, e) {
    if (typing()) return typingKey(code, e);
    if ((code >= 37 && code <= 40) || code === K.OK) { if (adoptDialog()) return true; }
    switch (code) {
      case K.LEFT: move('left', e); return true;
      case K.RIGHT: move('right', e); return true;
      case K.UP: move('up', e); return true;
      case K.DOWN: move('down', e); return true;
      case K.OK:
        if (!focusEl || !attached(focusEl) || !shown(focusEl)) { refocus(); return true; }
        activate(focusEl); return true;
      case K.BACK: pageBack(); return true;
      case K.PLAY: case K.PLAYPAUSE:
        if (playerTile()) { enterWatch(true); return true; }
        return false;
      case K.RED: openQuick(false); return true;
      case K.GREEN: focusSearch(); return true;
      case K.YELLOW: if (onSite()) goTo(CFG.historyURL); return true;
      case K.BLUE: case K.INFO: showHelp(); return true;
      case K.CHUP: pageJump(-1); return true;
      case K.CHDOWN: pageJump(1); return true;
    }
    return false;
  }
  function playbackKey(code) {
    var a = api();
    if (!a) return false;
    switch (code) {
      case K.PLAYPAUSE: a.toggle(); break;
      case K.PLAY: a.play(); break;
      case K.PAUSE: a.pause(); break;
      case K.FF: seekBy(1, CFG.seekStepBig, mode === 'controls'); return true;
      case K.RW: seekBy(-1, CFG.seekStepBig, mode === 'controls'); return true;
      case K.STOP: a.pause(); exitWatch(); return true;
      case K.RED: case K.CAPTION: openPlayerMenu(RE_CC, 'subtitles', 'subtitles'); return true;
      case K.GREEN: openPlayerMenu(RE_SETTINGS, 'settings', 'settings'); return true;
      case K.YELLOW: case K.NEXT: episode(1); return true;
      case K.PREV: episode(-1); return true;
      case K.CHUP: subDelay(1); return true;
      case K.CHDOWN: subDelay(-1); return true;
      case K.BLUE: showHelp(); return true;
      default: return false;
    }
    if (mode === 'watch') osd(true);
    return true;
  }
  function watchKey(code, e) {
    if (!ensurePlayer()) { exitWatch(); return true; }
    switch (code) {
      case K.OK: api().toggle(); osd(true); return true;
      case K.LEFT: seekBy(-1); return true;
      case K.RIGHT: seekBy(1); return true;
      case K.UP: case K.DOWN: enterControls(); return true;
      case K.INFO: osd(true, 6000); return true;
      case K.BACK: exitWatch(); return true;
    }
    return playbackKey(code);
  }
  function controlsKey(code, e) {
    if (!ensurePlayer()) { exitWatch(); return true; }
    wake();
    switch (code) {
      case K.LEFT: move('left', e); return true;
      case K.RIGHT: move('right', e); return true;
      case K.UP: move('up', e); return true;
      case K.DOWN: move('down', e); return true;
      case K.OK:
        if (focusEl && attached(focusEl) && shown(focusEl)) {
          // clicking a seek bar would jump to wherever its middle is: go back to watching instead
          if (!traps.length && isSeekBar(focusEl)) { leaveControls(); osd(true); toast('\u25c0 \u25b6 skip while watching'); }
          else activate(focusEl);
        } else refocus();
        return true;
      case K.BACK:
        pruneTraps();
        if (traps.length) closeTop(); else leaveControls();
        return true;
      case K.INFO: showHelp(); return true;
    }
    return playbackKey(code);
  }
  function frameKey(code, e) {
    if (!frameEl || !attached(frameEl)) { frameEl = null; mode = 'page'; return pageKey(code, e); }
    postTo(frameEl.contentWindow, { mbtv: 'key', code: code, repeat: !!(e && e.repeat) });
    return true;
  }
  function handle(code, e) {
    if (panel) return panelKey(code);
    if (mode === 'frame') return frameKey(code, e);
    if (mode === 'watch') return watchKey(code, e);
    if (mode === 'controls') return controlsKey(code, e);
    if (mode === 'idle') return false;
    return pageKey(code, e);
  }
  function dispatchCode(code, e) {
    scanId++;
    lastKey = now();
    try { return handle(code, e); } catch (err) { log(err); return false; }
  }
  function norm(e) {
    var c = e.keyCode || e.which;
    switch (c) {
      case 27: return K.BACK;
      case 8: return typing() ? 0 : K.BACK;
      case 33: return K.CHUP;
      case 34: return K.CHDOWN;
      case 32: return (mode === 'watch' && !typing()) ? K.PLAYPAUSE : 0;
    }
    if (!typing() && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // keyboard stand-ins for the colour keys, handy when testing on a computer
      switch (c) { case 82: return K.RED; case 71: return K.GREEN; case 89: return K.YELLOW; case 66: return K.BLUE; case 73: return K.INFO; case 75: return K.PLAYPAUSE; }
    }
    return KNOWN[c] ? c : 0;
  }
  function stop(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  function onKeyDown(e) {
    if (e.isTrusted === false || e.__mbtv) return;   // ignore events we (or the site) synthesise
    var code = norm(e);
    if (!code) return;
    if (!IS_TOP && !frameActive) {
      // an iframe grabbed the focus without being asked: hand the key back to the page
      if (typing()) return;
      postParent({ mbtv: 'reclaim', code: code });
      stop(e); return;
    }
    if (mode === 'idle') return;
    if (dispatchCode(code, e)) { handledKeys[e.keyCode] = true; stop(e); }
  }
  function onKeyOther(e) {
    if (e.isTrusted === false || e.__mbtv || !handledKeys[e.keyCode]) return;
    if (e.type === 'keyup') delete handledKeys[e.keyCode];
    stop(e);
  }

  // ------------------------------------------------------------------ overlay UI
  var STYLE = [
    '#mbtv-ui,#mbtv-ui *{box-sizing:border-box!important;}',
    '#mbtv-ui{position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;overflow:visible!important;',
    'z-index:2147483647!important;pointer-events:none!important;margin:0!important;padding:0!important;border:0!important;',
    'font-family:SamsungOne,"Samsung One","Samsung Sharp Sans",Roboto,"Helvetica Neue",Arial,sans-serif!important;',
    'visibility:visible!important;opacity:1!important;transform:none!important;}',
    '#mbtv-ui .mbtv-ring{position:fixed;display:none;border:4px solid #3ea6ff;border-radius:10px;',
    'box-shadow:0 0 0 3px rgba(0,0,0,.55),0 0 24px 4px rgba(62,166,255,.7);',
    'transition:left .12s ease-out,top .12s ease-out,width .12s ease-out,height .12s ease-out;}',
    '#mbtv-ui .mbtv-osd{position:fixed;left:0;right:0;bottom:0;display:none;padding:80px 72px 46px;color:#fff;',
    'background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.88));}',
    '#mbtv-ui .mbtv-osd-row{display:flex;align-items:center;font-size:30px;line-height:1.3;}',
    '#mbtv-ui .mbtv-osd-state{width:58px;font-size:32px;}',
    '#mbtv-ui .mbtv-osd-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:24px;}',
    '#mbtv-ui .mbtv-osd-bar{position:relative;height:8px;margin-top:18px;background:rgba(255,255,255,.25);border-radius:4px;}',
    '#mbtv-ui .mbtv-osd-fill{position:absolute;left:0;top:0;bottom:0;background:#3ea6ff;border-radius:4px;}',
    '#mbtv-ui .mbtv-osd-mark{position:absolute;top:-8px;width:4px;height:24px;margin-left:-2px;background:#fff;border-radius:2px;display:none;}',
    '#mbtv-ui .mbtv-osd-hint{margin-top:16px;font-size:20px;color:rgba(255,255,255,.72);}',
    '#mbtv-ui .mbtv-toast{position:fixed;top:44px;right:44px;max-width:780px;padding:16px 26px;border-radius:14px;',
    'background:rgba(20,20,24,.94);color:#fff;font-size:24px;line-height:1.35;display:none;box-shadow:0 8px 30px rgba(0,0,0,.5);}',
    '#mbtv-ui .mbtv-panel{position:fixed;left:50%;top:50%;width:780px;margin-left:-390px;max-height:88vh;overflow:hidden;',
    'padding:34px 40px;border-radius:20px;background:rgba(18,18,22,.97);color:#fff;display:none;',
    'box-shadow:0 20px 60px rgba(0,0,0,.65);transform:translateY(-50%);-webkit-transform:translateY(-50%);}',
    '#mbtv-ui .mbtv-panel h2{margin:0 0 20px;font-size:32px;font-weight:600;color:#fff;line-height:1.25;}',
    '#mbtv-ui .mbtv-item{padding:14px 22px;margin:6px 0;border-radius:12px;font-size:26px;color:#ddd;line-height:1.3;',
    'background:rgba(255,255,255,.06);border:3px solid transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#mbtv-ui .mbtv-item.mbtv-sel{background:rgba(62,166,255,.22);border-color:#3ea6ff;color:#fff;}',
    '#mbtv-ui .mbtv-more{font-size:20px;color:rgba(255,255,255,.5);text-align:center;height:24px;}',
    '#mbtv-ui .mbtv-help{font-size:21px;line-height:1.55;color:#ddd;}',
    '#mbtv-ui .mbtv-help h3{font-size:23px;margin:14px 0 4px;color:#3ea6ff;font-weight:600;}',
    '#mbtv-ui .mbtv-row{display:flex;}',
    '#mbtv-ui .mbtv-help b{flex:0 0 240px;color:#fff;font-weight:600;}',
    '#mbtv-ui .mbtv-help .mbtv-row span{flex:1;}',
    'html.mbtv-fs-on,html.mbtv-fs-on body{overflow:hidden!important;}',
    'html.mbtv-fs-on .mbtv-fs-hide{visibility:hidden!important;}',
    'html.mbtv-fs-on .mbtv-fs-chain{transform:none!important;-webkit-transform:none!important;filter:none!important;',
    '-webkit-filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important;animation:none!important;}',
    'html.mbtv-fs-on .mbtv-fs.mbtv-fs{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;',
    'width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;',
    'min-height:0!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;',
    'z-index:2147483000!important;background:#000!important;transform:none!important;-webkit-transform:none!important;',
    'visibility:visible!important;opacity:1!important;}',
    'html.mbtv-fs-on video.mbtv-fs,html.mbtv-fs-on video.mbtv-fs-inner{object-fit:contain!important;}',
    'html.mbtv-fs-on .mbtv-fs-inner.mbtv-fs-inner{width:100%!important;height:100%!important;max-width:none!important;',
    'max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;transform:none!important;}'
  ].join('');
  function mk(tag, className, parent) {
    var n = D.createElement(tag);
    if (className) n.className = className;
    if (parent) parent.appendChild(n);
    return n;
  }
  function buildUI() {
    if (!D.getElementById('mbtv-style')) {
      var st = D.createElement('style');
      st.id = 'mbtv-style';
      st.appendChild(D.createTextNode(STYLE));
      (D.head || D.documentElement).appendChild(st);
    }
    var root = mk('div', '', null);
    root.id = 'mbtv-ui';
    root.setAttribute('aria-hidden', 'true');
    ui.root = root;
    ui.ring = mk('div', 'mbtv-ring', root);
    ui.osd = mk('div', 'mbtv-osd', root);
    var row = mk('div', 'mbtv-osd-row', ui.osd);
    ui.osdState = mk('span', 'mbtv-osd-state', row);
    ui.osdTitle = mk('span', 'mbtv-osd-title', row);
    ui.osdTime = mk('span', 'mbtv-osd-time', row);
    var bar = mk('div', 'mbtv-osd-bar', ui.osd);
    ui.osdFill = mk('div', 'mbtv-osd-fill', bar);
    ui.osdMark = mk('div', 'mbtv-osd-mark', bar);
    ui.osdHint = mk('div', 'mbtv-osd-hint', ui.osd);
    ui.osdHint.textContent = 'OK pause  \u00b7  \u25c0 \u25b6 skip  \u00b7  \u25b2\u25bc player controls (subtitles, quality)  \u00b7  Back exit full screen';
    ui.toast = mk('div', 'mbtv-toast', root);
    ui.panel = mk('div', 'mbtv-panel', root);
    D.body.appendChild(root);
  }
  function drawRing() {
    var ring = ui.ring;
    if (!ring) return;
    if (ui.root && !attached(ui.root)) (fsElement() && fsElement().tagName !== 'VIDEO' ? fsElement() : D.body).appendChild(ui.root);
    if (!focusEl || !attached(focusEl) || mode === 'watch' || mode === 'frame' || mode === 'idle') { ring.style.display = 'none'; return; }
    var r = rect(focusEl);
    if (r.w < 1 || r.h < 1) { ring.style.display = 'none'; return; }
    var pad = 4;
    ring.style.display = 'block';
    ring.style.left = Math.round(r.l - pad) + 'px';
    ring.style.top = Math.round(r.t - pad) + 'px';
    ring.style.width = Math.round(r.w + pad * 2) + 'px';
    ring.style.height = Math.round(r.h + pad * 2) + 'px';
  }
  var ringQueued = false;
  function drawRingSoon() {
    if (ringQueued) return;
    ringQueued = true;
    (W.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () { ringQueued = false; drawRing(); });
  }
  function pageTitle() {
    if (site && site.title && (mode === 'watch' || mode === 'controls')) {
      var own = D.querySelector(site.title);   // the player knows which episode is on, the page title does not
      if (own && shortText(own)) return shortText(own);
    }
    var t = (D.title || '').split(/\s[-|\u2013\u2014]\s/)[0];
    if (!t || t.length < 2) { var h = D.querySelector('h1'); t = h ? shortText(h) : ''; }
    return t;
  }
  function osd(show, ms) {
    if (!ui.osd || !show) return;
    if (mode === 'controls') return;
    renderOSD();
    ui.osd.style.display = 'block';
    clearTimeout(osdTimer);
    if (!osdTick) osdTick = setInterval(renderOSD, 500);
    osdTimer = setTimeout(hideOSD, ms || CFG.osdTimeout);
  }
  function hideOSD() {
    if (ui.osd) ui.osd.style.display = 'none';
    clearInterval(osdTick); osdTick = null; clearTimeout(osdTimer);
  }
  function renderOSD() {
    var v = video;
    if (!v || !ui.osd) return;
    var a = html5(v), t = a.time(), d = a.duration(), tgt = sk.target;
    ui.osdState.textContent = v.paused ? '\u275a\u275a' : '\u25b6';
    ui.osdTitle.textContent = pageTitle();
    var at = tgt !== null ? tgt : t, txt = fmt(at) + (d ? ' / ' + fmt(d) : '');
    if (tgt !== null) txt += '   (' + (tgt >= t ? '+' : '\u2212') + fmt(Math.abs(tgt - t)) + ')';
    ui.osdTime.textContent = txt;
    ui.osdFill.style.width = (d ? clamp(t / d, 0, 1) * 100 : 0) + '%';
    if (tgt !== null && d) { ui.osdMark.style.display = 'block'; ui.osdMark.style.left = (clamp(tgt / d, 0, 1) * 100) + '%'; }
    else ui.osdMark.style.display = 'none';
  }
  function toast(msg, ms) {
    if (!ui.toast) return;
    ui.toast.textContent = msg;
    ui.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.style.display = 'none'; }, ms || 2400);
  }
  // ------------------------------------------------------------------ page scale
  // The catalogue is a 750px-wide phone design. The site's own index.js does
  //     var w = window.innerWidth; if (w > 750) { w = 750 }
  //     html.style.fontSize = w / 7.5 + 'px'
  // so every rem in its stylesheet is pinned to a 750px canvas. On a 1920 set the page
  // renders 750px wide - under 40% of the screen - which is what "everything is tiny"
  // means on a TV. Lifting the cap drives the site's own mechanism, so the layout scales
  // the way its author already intended at narrower widths rather than by our guesswork.
  //
  // Written as an !important rule rather than onto html.style, because the site re-applies
  // its own inline value on every resize and an !important stylesheet rule still beats it.
  //
  // CSS zoom was the obvious one-liner and is wrong here. Measured on this site: under zoom
  // getBoundingClientRect keeps reporting unzoomed coordinates while elementFromPoint wants
  // visual pixels, so the hit test behind every synthetic click in this file comes back null
  // and nothing on the page can be activated. Do not swap this for zoom.
  //
  // Scaling by width scales height with it, so a layout built to fill one phone screen ends
  // up taller than a TV screen and has to be scrolled. That is inherent in honouring a
  // portrait design on a landscape panel rather than a fault here, and it is the reason this
  // is adjustable at all: Red, then Screen size, then Left and Right.
  var SCALE_KEY = 'mbtv_scale', SCALE_MIN = 0.4, SCALE_MAX = 1.4, scaleEl = null;
  function scaleClamp(v) { return Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(v * 20) / 20)); }
  function scaleGet() {
    var v = NaN;
    try { v = parseFloat(W.localStorage.getItem(SCALE_KEY)); } catch (e) {}
    return scaleClamp(v > 0 ? v : 1);          // 1 means the design filling the screen width
  }
  function scaleApply() {
    if (!CFG.pageScale || !onSite()) return;
    var px = (W.innerWidth / 7.5) * scaleGet();
    if (!(px > 0)) return;                     // a zero-width viewport: leave the site alone
    if (!attached(scaleEl)) {
      scaleEl = D.createElement('style');
      scaleEl.setAttribute('data-mbtv', 'scale');
      (D.head || D.documentElement).appendChild(scaleEl);
    }
    var want = 'html{font-size:' + px.toFixed(2) + 'px !important;}';
    if (scaleEl.textContent !== want) { scaleEl.textContent = want; markDirty(); }
  }
  function scaleNudge(dir) {
    var v = scaleClamp(scaleGet() + dir * 0.1);
    try { W.localStorage.setItem(SCALE_KEY, String(v)); } catch (e) {}
    scaleApply();
    return v;
  }
  function scaleLabel() { return 'Screen size  ' + Math.round(scaleGet() * 100) + '%   \u25c0 \u25b6'; }

  function openPanel(title, items, kind, html) {

    panel = { title: title, items: items || [], idx: 0, kind: kind, html: html || '' };
    for (var i = 0; i < panel.items.length; i++) if (panel.items[i].selected) panel.idx = i;
    renderPanel();
  }
  function closePanel() {
    panel = null;
    if (ui.panel) { ui.panel.style.display = 'none'; ui.panel.innerHTML = ''; }
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function renderPanel() {
    if (!panel || !ui.panel) return;
    var h = '<h2>' + esc(panel.title) + '</h2>';
    if (panel.kind === 'help') h += panel.html;
    else {
      var n = panel.items.length, max = 8, start = clamp(panel.idx - 3, 0, Math.max(0, n - max));
      h += '<div class="mbtv-more">' + (start > 0 ? '\u25b2' : '') + '</div>';
      for (var i = start; i < Math.min(n, start + max); i++) {
        h += '<div class="mbtv-item' + (i === panel.idx ? ' mbtv-sel' : '') + '">' + esc(panel.items[i].label) + '</div>';
      }
      h += '<div class="mbtv-more">' + (start + max < n ? '\u25bc' : '') + '</div>';
    }
    ui.panel.innerHTML = h;
    ui.panel.style.display = 'block';
  }
  function panelKey(code) {
    if (panel.kind === 'help') { closePanel(); return true; }
    var n = panel.items.length;
    switch (code) {
      case K.UP: if (n) { panel.idx = (panel.idx + n - 1) % n; renderPanel(); } return true;
      case K.DOWN: if (n) { panel.idx = (panel.idx + 1) % n; renderPanel(); } return true;
      case K.OK:
        var it = panel.items[panel.idx];
        closePanel();
        if (it && it.run) it.run();
        return true;
      case K.LEFT: case K.RIGHT:
        // a row that can be adjusted in place keeps the panel open; everything else swallows
        var row = panel.items[panel.idx];
        if (row && row.step) row.step(code === K.RIGHT ? 1 : -1);
        return true;
      case K.BACK: case K.RED: closePanel(); return true;
    }
    return true;
  }
  function openQuick(atRoot) {
    var items = [], site = onSite();
    for (var i = 0; i < CFG.quick.length; i++) (function (q) {
      if (!site && q.action) return;
      items.push({ label: q.label, run: function () { if (q.action === 'search') focusSearch(); else goTo(q.url); } });
    })(CFG.quick[i]);
    if (site && CFG.pageScale) items.push({ label: scaleLabel(), step: function (d) {
      scaleNudge(d);
      if (panel && panel.items[panel.idx]) { panel.items[panel.idx].label = scaleLabel(); renderPanel(); }
    } });
    items.push({ label: 'Remote help', run: showHelp });
    items.push({ label: 'Exit', run: exitApp });
    openPanel(atRoot ? 'Nothing more to go back to' : 'Menu', items, 'menu');
  }
  function showHelp() {
    var watch = '<h3>Watching</h3>' +
      '<div class=\"mbtv-row\"><b>OK, Play/Pause</b><span>Play or pause</span></div>' +
      '<div class=\"mbtv-row\"><b>\u25c0 \u25b6</b><span>Skip 10 s (keep pressing for bigger jumps)</span></div>' +
      '<div class=\"mbtv-row\"><b>\u25b2 \u25bc</b><span>The player\'s own controls (subtitles, sync, quality)</span></div>' +
      '<div class=\"mbtv-row\"><b>FF / RW</b><span>Skip 30 s</span></div>' +
      '<div class=\"mbtv-row\"><b>Red / Green</b><span>Subtitle list / Settings sheet</span></div>' +
      '<div class=\"mbtv-row\"><b>Yellow, \u23ed \u23ee</b><span>Next / previous episode</span></div>' +
      '<div class=\"mbtv-row\"><b>CH+ / CH\u2212</b><span>Subtitle sync later / earlier</span></div>' +
      '<div class=\"mbtv-row\"><b>Back</b><span>Close menu, hide controls, leave full screen</span></div>';
    var browse = '<h3>Browsing</h3>' +
      '<div class=\"mbtv-row\"><b>\u25c0 \u25b2 \u25bc \u25b6, OK</b><span>Move and select</span></div>' +
      '<div class=\"mbtv-row\"><b>Back</b><span>Go back or close a popup</span></div>' +
      '<div class=\"mbtv-row\"><b>Red</b><span>Menu (home, history, favorites, sign in, screen size)</span></div>' +
      '<div class=\"mbtv-row\"><b>Green / Yellow</b><span>Search / History</span></div>' +
      '<div class=\"mbtv-row\"><b>CH+ / CH\u2212</b><span>Page up / down</span></div>' +
      '<div class=\"mbtv-row\"><b>Blue or Info</b><span>This help</span></div>';
    var inPlayer = mode === 'watch' || mode === 'controls';
    openPanel('Remote controls', [], 'help', '<div class="mbtv-help">' + (inPlayer ? watch + browse : browse + watch) +
      '<div style="margin-top:14px;color:rgba(255,255,255,.55)">Press any key to close</div></div>');
  }

  // ------------------------------------------------------------------ start-up
  function registerKeys() {
    try {
      if (W.tizen && W.tizen.tvinputdevice) {
        for (var i = 0; i < TV_KEYS.length; i++) { try { W.tizen.tvinputdevice.registerKey(TV_KEYS[i]); } catch (e) {} }
      }
    } catch (e2) {}
  }
  function patchOpen() {
    var orig = W.open;
    W.open = function (url) {
      try {
        if (url) {
          var a = D.createElement('a');
          a.href = url;
          if (a.host === location.host) { savePos(); location.href = a.href; return W; }
        }
      } catch (e) {}
      return orig ? orig.apply(W, arguments) : null;
    };
  }
  function observe() {
    if (!W.MutationObserver) return;
    var mo = new W.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (!ui.root || !ui.root.contains(records[i].target)) { dirty = true; return; }
      }
    });
    mo.observe(D.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'open', 'disabled'] });
  }
  function start() {
    if (!D.body) { setTimeout(start, 50); return; }
    site = pickSite();
    scaleApply();      // before the first focus, so the ring is drawn against the final layout
    buildUI();
    W.addEventListener('keydown', onKeyDown, true);
    W.addEventListener('keyup', onKeyOther, true);
    W.addEventListener('keypress', onKeyOther, true);
    W.addEventListener('message', onMessage, false);
    W.addEventListener('scroll', drawRingSoon, true);
    W.addEventListener('resize', function () { markDirty(); drawRingSoon(); scaleApply(); }, false);
    D.addEventListener('fullscreenchange', onFSChange, false);
    D.addEventListener('webkitfullscreenchange', onFSChange, false);
    D.addEventListener('playing', onPlaying, true);
    W.addEventListener('pagehide', function () { leaving = true; savePos(); }, false);
    W.addEventListener('beforeunload', function () { leaving = true; savePos(); }, false);
    W.addEventListener('pageshow', function () { leaving = false; markDirty(); drawRing(); }, false);
    observe();
    // the ring also follows scrolling and resizes: this is only a safety net for layout we miss
    setInterval(function () { if (!D.hidden && focusEl) drawRing(); }, 600);
    registerKeys();
    if (IS_TOP) {
      patchOpen();
      setTimeout(function () {
        if (focusEl || mode !== 'page') return;
        if (!restorePos()) setTimeout(function () { if (!focusEl && mode === 'page') { markDirty(); refocus(); } }, 250);
      }, 250);
      try {
        if (!W.sessionStorage.getItem('mbtv:hello')) {
          W.sessionStorage.setItem('mbtv:hello', '1');
          setTimeout(function () { toast('Remote mode on. Press Blue or Info for the controls.', 4000); }, 900);
        }
      } catch (e) {}
    } else {
      mode = 'idle';
    }
    W.__mbtv = {
      version: '1.2.0', cfg: CFG, sites: SITES,
      state: function () {
        return { mode: mode, site: site ? site.name : null, focus: focusEl, traps: traps.length,
          video: video, box: box, panel: panel ? panel.kind : null, cands: candidates(currentScope()).length };
      }
    };
  }
  function boot() {
    var root = D.documentElement;
    if (!root) { setTimeout(boot, 30); return; }
    if (root.getAttribute('data-mbtv')) return;   // already running in this document
    root.setAttribute('data-mbtv', IS_TOP ? 'top' : 'frame');
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start, false);
    else start();
  }
  boot();
})();
