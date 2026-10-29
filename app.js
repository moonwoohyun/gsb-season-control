/* 리넥츠 시즌 관제탑 — 정적 사이트 (GitHub Pages)
 * 데이터: data/manifest.json + data/seasons/{시즌}.json (AES-GCM 암호화, 비밀번호로 열기)
 * 데이터는 Claude가 구글 시트(시즌 진행현황)를 읽어 tools/build_data.py 로 만든다. 이 페이지는 보기 전용.
 */
(function () {
'use strict';

var KEY_STORE = 'renacts.key';
var COLORS = { GN:['#2F5D43','#fff'], NV:['#2A3560','#fff'], BE:['#D9C3A0','#2A2218'], BG:['#D9C3A0','#2A2218'], LBU:['#BCD0E6','#1B2A3D'], BK:['#1E1E1E','#fff'], BL:['#1E1E1E','#fff'], DBL:['#22304F','#fff'], WH:['#F2F0EA','#2A2A28'], IV:['#EFE8D6','#2A2A28'], GR:['#8C8C88','#fff'], CH:['#4A4A48','#fff'], BR:['#6B4A2E','#fff'], KH:['#7A7350','#fff'], RED:['#8E2A25','#fff'], 'RED MULTI':['#8E2A25','#fff'], 'GREEN MULTI':['#2F5D43','#fff'], 'WHITE MULTI':['#ECEAE2','#2A2A28'], 'ORANGE MULTI':['#E0954F','#2A1A0A'] };
var FIELD_LABEL = [['season','시즌'],['type','구분'],['code','품번'],['color','컬러'],['name','아이템명 (영문)'],['plan','기획명'],['stage','현재 단계'],['status','상태'],['updated','업데이트 날짜'],['recent','최근 내용'],['memo','메모']];

var S = { manifest: null, key: null, seasons: [], q: '', type: 'all', cat: 'all', view: null, stagesOff: {}, all: [] };
var QLABEL = [['order','작업 지시'],['cut','재단 수량'],['wash','워싱처 입고'],['finish','완성집 입고'],['store','수납용 입고'],['tpl','3PL 입고']];

function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
function store(kind) { try { return window[kind]; } catch (e) { return null; } }
function sget(k) { var v = null; ['localStorage','sessionStorage'].forEach(function (n) { var s = store(n); try { if (!v && s) v = s.getItem(k); } catch (e) {} }); return v; }
function sset(k, v, remember) { var s = store(remember ? 'localStorage' : 'sessionStorage'); try { if (s) s.setItem(k, v); } catch (e) {} }
function sdel(k) { ['localStorage','sessionStorage'].forEach(function (n) { var s = store(n); try { if (s) s.removeItem(k); } catch (e) {} }); }

/* ---------- 암호 ---------- */
function b2u(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function u2b(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
function deriveKey(pw, kdf) {
  var te = new TextEncoder();
  return crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b2u(kdf.salt), iterations: kdf.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  });
}
function decrypt(key, box) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b2u(box.iv) }, key, b2u(box.ct)).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
}
function importRaw(b64) { return crypto.subtle.importKey('raw', b2u(b64), { name: 'AES-GCM' }, true, ['decrypt']); }

function getJSON(url) {
  return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error(url + ' (' + r.status + ')');
    return r.json();
  });
}

/* ---------- 시작 ---------- */
function start() {
  readHash();
  getJSON('data/manifest.json').then(function (m) {
    S.manifest = m;
    $('#updated').textContent = '최신화 ' + (m.updated || '');
    var saved = sget(KEY_STORE);
    if (saved) {
      var parts = saved.split('.');
      if (parts[0] === m.kdf.salt) {
        return importRaw(parts[1]).then(function (k) { return decrypt(k, m.check).then(function () { return open(k); }); }).catch(function () { sdel(KEY_STORE); showLock(); });
      }
      sdel(KEY_STORE);
    }
    showLock();
  }).catch(function (e) {
    $('#app').innerHTML = '<div class="card lockcard"><h1>데이터를 불러오지 못했어요</h1><p class="sub">' + esc(e.message) + '</p></div>';
  });
}

function showLock(msg) {
  $('#q').disabled = true; $('#lock').hidden = true;
  $('#app').innerHTML = '<div class="card lockcard"><h1>리넥츠 시즌 관제탑</h1><p class="sub">팀 공용 비밀번호를 입력하세요.</p>' +
    '<form id="lockf"><input type="password" id="pw" placeholder="비밀번호" autocomplete="current-password" aria-label="비밀번호" required>' +
    '<label class="rem"><input type="checkbox" id="rem" checked> 이 기기에서 기억하기</label>' +
    '<div class="err" id="err" role="alert">' + esc(msg || '') + '</div><button class="btn pri" type="submit" style="justify-content:center">열기</button></form></div>';
  $('#pw').focus();
  $('#lockf').onsubmit = function (ev) {
    ev.preventDefault();
    var pw = $('#pw').value, rem = $('#rem').checked, btn = $('#lockf button');
    btn.disabled = true; btn.textContent = '여는 중…';
    deriveKey(pw, S.manifest.kdf).then(function (k) {
      return decrypt(k, S.manifest.check).then(function () {
        return crypto.subtle.exportKey('raw', k).then(function (raw) { sset(KEY_STORE, S.manifest.kdf.salt + '.' + u2b(raw), rem); return open(k); });
      });
    }).catch(function () { btn.disabled = false; btn.textContent = '열기'; $('#err').textContent = '비밀번호가 맞지 않아요.'; $('#pw').select(); });
  };
}

function open(key) {
  S.key = key;
  $('#app').innerHTML = '<p class="empty">불러오는 중…</p>';
  return Promise.all(S.manifest.seasons.map(function (s) {
    return getJSON(s.file).then(function (box) { return decrypt(key, box); }).catch(function (e) { return { label: s.label, error: e.message, items: [], stages: [] }; });
  })).then(function (list) {
    S.seasons = list;
    S.all = [];
    list.forEach(function (s) { (s.items || []).forEach(function (it, i) { it._id = s.label + ':' + i; it._season = s.label; it._hay = hay(it); S.all.push(it); }); });
    $('#q').disabled = false; $('#q').value = S.q; $('#lock').hidden = false;
    render();
  });
}

/* ---------- 상태 · 주소 ---------- */
function readHash() {
  var h = location.hash.replace(/^#/, ''), p = {};
  h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  S.q = p.q || ''; S.type = p.t || 'all'; S.cat = p.c || 'all'; S.view = p.v || (window.innerWidth < 720 ? 'list' : 'board');
}
function writeHash() {
  var p = [];
  if (S.q) p.push('q=' + encodeURIComponent(S.q));
  if (S.type !== 'all') p.push('t=' + encodeURIComponent(S.type));
  if (S.cat !== 'all') p.push('c=' + encodeURIComponent(S.cat));
  p.push('v=' + S.view);
  history.replaceState(null, '', '#' + p.join('&'));
}

/* ---------- 검색 ---------- */
function norm(s) { return String(s || '').toLowerCase(); }
function hay(it) {
  var code = it.code || '', color = it.color || '';
  return norm([it.season, it.type, code, color, code && color ? code + '_' + color : '', it.name, it.plan, it.stage, it.status, it.updated, it.recent, it.memo, it.category, it.round, it.file].join(' \u0001 '));
}
function tokens() { return norm(S.q).split(/\s+/).filter(Boolean); }
function matches(it) {
  var t = tokens();
  for (var i = 0; i < t.length; i++) if (it._hay.indexOf(t[i]) < 0) return false;
  if (S.type !== 'all' && (S.type === '드랍' ? it.tab !== '드랍' && it.status !== '드랍' : it.type !== S.type || it.tab === '드랍')) return false;
  if (S.stagesOff[stageLabel(it.stage)]) return false;
  if (S.cat !== 'all' && (it.category || '미분류') !== S.cat) return false;
  return true;
}
function hl(text) {
  text = String(text == null ? '' : text);
  var t = tokens(); if (!t.length || !text) return esc(text);
  var low = text.toLowerCase(), marks = [];
  t.forEach(function (w) { var i = 0; while ((i = low.indexOf(w, i)) >= 0) { marks.push([i, i + w.length]); i += w.length; } });
  if (!marks.length) return esc(text);
  marks.sort(function (a, b) { return a[0] - b[0]; });
  var out = '', pos = 0;
  marks.forEach(function (m) { if (m[0] < pos) { if (m[1] > pos) { out += '<mark>' + esc(text.slice(pos, m[1])) + '</mark>'; pos = m[1]; } return; } out += esc(text.slice(pos, m[0])) + '<mark>' + esc(text.slice(m[0], m[1])) + '</mark>'; pos = m[1]; });
  return out + esc(text.slice(pos));
}

/* ---------- 조각 ---------- */
function stageLabel(st) { return String(st || '').trim(); }
function stageNo(st) { var m = /^(\d{1,2})/.exec(stageLabel(st)); return m ? parseInt(m[1], 10) : 0; }
function stageName(st) { return stageLabel(st).replace(/^\d{1,2}_?\s*/, '') || '단계 미지정'; }
function stageStyle(st) { var n = stageNo(st); return n >= 1 && n <= 8 ? 'background:var(--s' + n + ');color:var(--s' + n + 't)' : 'background:#E9E8E0;color:#4A4A45'; }
function stageColor(st) { var n = stageNo(st); return n >= 1 && n <= 8 ? 'var(--s' + n + 't)' : '#DAD8CD'; }
function colorChip(c) {
  if (!c) return '';
  return String(c).split(/\s*,\s*/).map(function (l) { var m = COLORS[l.toUpperCase()] || ['#E3E1D8', '#333']; return '<span class="chip" style="background:' + m[0] + ';color:' + m[1] + '">' + hl(l) + '</span>'; }).join(' ');
}
function codeText(it) { return it.code ? hl(it.code) : '<span class="sub">품번 미부여</span>'; }
function title(it) { return it.plan || it.name || it.code || '(이름 없음)'; }
function md(d) { var m = /^\d{4}-(\d\d)-(\d\d)/.exec(d || ''); return m ? m[1] + '/' + m[2] : (d || ''); }

function card(it) {
  return '<button class="kcard" style="--kc:' + stageColor(it.stage) + '" data-id="' + esc(it._id) + '">' +
    '<span class="kt"><span class="kc mono">' + codeText(it) + (it.round ? ' <span class="chip gray">' + hl(it.round) + '</span>' : '') + '</span><span>' + colorChip(it.color) + '</span></span>' +
    (it.category ? '<span class="ke">' + hl(it.category) + '</span>' : '') +
    '<span class="kn">' + hl(title(it)) + '</span>' +
    (it.name && it.plan ? '<span class="ke">' + hl(it.name) + '</span>' : '') +
    (it.recent || it.updated ? '<span class="kstat">' + (it.updated ? '<b>' + esc(md(it.updated)) + '</b> · ' : '') + hl(it.recent || '내용 없음') + '</span>' : '') +
    (it.memo ? '<span class="kflag">' + hl(it.memo) + '</span>' : '') + '</button>';
}

function catSelect() {
  var cats = {}; S.all.forEach(function (it) { cats[it.category || '미분류'] = 1; });
  var list = Object.keys(cats).sort();
  if (list.length < 2 && S.cat === 'all') return '';
  return '<select id="cat" class="catsel" aria-label="카테고리"><option value="all">카테고리 전체</option>' + list.map(function (c) {
    return '<option value="' + esc(c) + '"' + (S.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>';
}

function fmtN(v, sign) { if (v == null || v === '') return ''; return (sign && v > 0 ? '+' : '') + Number(v).toLocaleString(); }
function detailHtml(it) {
  var D = it.detail, h = '';
  var info = [['혼용율 · 겉감','mixOuter'],['혼용율 · 안감','mixLining'],['혼용율 · 배색','mixOther'],['원산지','origin'],['봉제공장','factory'],['FIT','fit'],['원단','fabric'],['규격 · 중량','spec'],['워싱','washMethod'],['사이즈 구성','sizes'],['세트 연결','set']];
  h += '<h3 class="dsec">소재 · 생산</h3><div class="kv2">' + info.filter(function (f) { return D.info[f[1]]; }).map(function (f) {
    return '<div class="kv"><span>' + f[0] + '</span><span>' + esc(D.info[f[1]]) + '</span></div>'; }).join('') + '</div>';
  if (D.colors && D.colors.length) h += '<div class="clist">' + D.colors.map(function (c) { return colorChip(c.code) + (c.name ? ' <span class="sub">' + esc(c.name) + '</span>' : ''); }).join('<span class="sep"></span>') + '</div>';
  // 수량
  h += '<h3 class="dsec">수량 <span class="sub">컬러별 · 사이즈별</span></h3>';
  var anyQ = (D.qty || []).some(function (b) { return Object.keys(b.stages).length; });
  if (!anyQ) h += '<p class="empty">아직 입력된 수량이 없어요.</p>';
  (D.qty || []).forEach(function (b) {
    if (!Object.keys(b.stages).length) return;
    var used = [0,1,2,3,4].filter(function (i) { return QLABEL.some(function (q) { var s = b.stages[q[0]]; return s && s.sizes[i] != null; }) || (b.diff && b.diff.sizes[i] != null); });
    h += '<div class="qwrap"><div class="qtitle">' + colorChip(b.color) + '</div><table class="qt"><thead><tr><th>단계</th>' + used.map(function (i) { return '<th class="n">' + (i + 1) + '</th>'; }).join('') + '<th class="n">토탈</th></tr></thead><tbody>' +
      QLABEL.filter(function (q) { return b.stages[q[0]]; }).map(function (q) { var s = b.stages[q[0]];
        return '<tr><td>' + q[1] + '</td>' + used.map(function (i) { return '<td class="n">' + fmtN(s.sizes[i]) + '</td>'; }).join('') + '<td class="n"><b>' + fmtN(s.total) + '</b></td></tr>'; }).join('') +
      (b.diff ? '<tr class="diff"><td>편차</td>' + used.map(function (i) { var v = b.diff.sizes[i]; return '<td class="n ' + (v == null ? '' : v === 0 ? 'ok' : 'bad') + '">' + fmtN(v, true) + '</td>'; }).join('') + '<td class="n"><b>' + fmtN(b.diff.total, true) + '</b></td></tr>' : '') +
      '</tbody></table></div>';
  });
  // 히스토리
  h += '<h3 class="dsec">히스토리 <span class="sub">' + (D.history || []).length + '건</span></h3>';
  h += (D.history || []).length ? '<table class="qt"><tbody>' + D.history.slice().reverse().map(function (r, i) {
    return '<tr' + (i === 0 ? ' class="latest"' : '') + '><td class="mono nowrap">' + esc(r.date) + '</td><td>' + (r.color ? colorChip(r.color) : '<span class="sub">전체</span>') + '</td><td><span class="chip" style="' + stageStyle(r.stage) + '">' + esc(r.stage) + '</span></td><td>' + esc(r.text) + (r.link ? ' <a href="' + esc(r.link) + '" target="_blank" rel="noopener">첨부</a>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="empty">기록이 없어요.</p>';
  // 3PL
  var T = D.tpl || { rows: [] };
  h += '<h3 class="dsec">3PL 검수' + (T.date ? ' <span class="sub">' + esc(T.date) + (T.vendor ? ' · ' + esc(T.vendor) : '') + '</span>' : '') + '</h3>';
  if (T.rows.length) {
    var tp = 0, tc = 0; T.rows.forEach(function (r) { tp += r.packed || 0; tc += r.checked || 0; });
    h += '<table class="qt"><thead><tr><th>컬러</th><th>사이즈</th><th>바코드</th><th class="n">패킹</th><th class="n">검수</th><th class="n">차이</th><th>결과</th></tr></thead><tbody>' + T.rows.map(function (r) {
      var cls = r.result === '일치' ? 'ok' : r.result === '부족' ? 'bad' : r.result === '초과' ? 'amb' : '';
      return '<tr><td>' + colorChip(r.color) + '</td><td>' + esc(r.size) + '</td><td class="mono">' + esc(r.barcode) + '</td><td class="n">' + fmtN(r.packed) + '</td><td class="n">' + fmtN(r.checked) + '</td><td class="n">' + fmtN(r.diff, true) + '</td><td class="' + cls + '">' + esc(r.result) + '</td></tr>'; }).join('') +
      '<tr class="diff"><td colspan="3">TOTAL</td><td class="n">' + fmtN(tp) + '</td><td class="n">' + fmtN(tc) + '</td><td class="n">' + fmtN(tc - tp, true) + '</td><td></td></tr></tbody></table>';
  } else h += '<p class="empty">아직 검수 기록이 없어요.</p>';
  // 바코드
  h += '<h3 class="dsec">바코드 <span class="sub">' + (D.barcodes || []).length + '개</span></h3>';
  h += (D.barcodes || []).length ? '<div class="codes">' + D.barcodes.map(function (b) { return '<div class="code">' + colorChip(b.color) + ' <span class="sub">' + esc(b.size) + '</span><div class="mono">' + esc(b.barcode) + '</div></div>'; }).join('') + '</div>' : '<p class="empty">아직 등록된 바코드가 없어요.</p>';
  if (it.file) h += '<p class="sub" style="margin-top:14px">원본: ' + esc(it.category ? it.category + ' / ' : '') + esc(it.file) + '</p>';
  return h;
}

/* ---------- 화면 ---------- */
function render() {
  writeHash();
  var shown = S.all.filter(matches);
  var stagesAll = (S.seasons[0] && S.seasons[0].stages && S.seasons[0].stages.length) ? S.seasons[0].stages : [];
  var h = '';
  // 필터 줄
  h += '<div class="toolbar"><div class="seg" role="group" aria-label="구분">' + [['all','전체'],['신규','신규'],['리오더','리오더'],['드랍','드랍']].map(function (t) {
    return '<button class="segb' + (S.type === t[0] ? ' on' : '') + '" data-type="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    '<div class="seg" role="group" aria-label="보기">' + [['board','보드'],['list','목록']].map(function (t) {
    return '<button class="segb' + (S.view === t[0] ? ' on' : '') + '" data-view="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    catSelect() + '<div class="grow"></div><div class="result">' + (S.q || S.type !== 'all' || S.cat !== 'all' || Object.keys(S.stagesOff).some(function (k) { return S.stagesOff[k]; }) ? '검색 결과 <b>' + shown.length + '</b>건 / 전체 ' + S.all.length + '건 · <button class="lnk" style="color:var(--navy);border-color:#CFCCC0" id="reset">초기화</button>' : '전체 <b>' + S.all.length + '</b>건') + '</div></div>';
  if (stagesAll.length) h += '<div class="stagef" aria-label="단계 필터">' + stagesAll.map(function (st) {
    return '<button class="sbtn' + (S.stagesOff[st] ? ' off' : '') + '" style="' + stageStyle(st) + '" data-stage="' + esc(st) + '" aria-pressed="' + (!S.stagesOff[st]) + '">' + esc(st.replace('_', ' ')) + '</button>'; }).join('') + '</div>';
  // 시즌 바로가기
  var bySeason = {}; shown.forEach(function (it) { (bySeason[it._season] = bySeason[it._season] || []).push(it); });
  var filtering = !!(S.q || S.type !== 'all' || S.cat !== 'all' || Object.keys(S.stagesOff).some(function (k) { return S.stagesOff[k]; }));
  var visible = S.seasons.filter(function (s) { return !filtering || (bySeason[s.label] || []).length; });
  if (S.seasons.length > 1) h += '<nav class="jump" aria-label="시즌 바로가기"><span class="sub">시즌</span>' + visible.map(function (s) {
    return '<a href="#" data-jump="' + esc(s.label) + '">' + esc(s.label) + '<span>' + (bySeason[s.label] || []).length + '</span></a>'; }).join('') + '</nav>';
  if (!visible.length) h += '<div class="emptyall"><h2>찾는 결과가 없어요</h2><p>품번, 컬러코드(예: NV), 기획명, 최근 내용으로 검색할 수 있어요. 여러 단어는 모두 포함된 건만 보여줘요.</p></div>';
  visible.forEach(function (s) { h += seasonBlock(s, bySeason[s.label] || [], filtering); });
  $('#app').innerHTML = h;
  bind();
}

function seasonBlock(s, items, filtering) {
  var all = S.all.filter(function (it) { return it._season === s.label; });
  var cnt = function (f) { return all.filter(f).length; };
  var h = '<section class="season" id="s-' + esc(s.label) + '"><div class="shead"><h1>' + esc(s.label) + '</h1><div class="meta">' +
    '<span>진행<b>' + cnt(function (it) { return it.tab !== '드랍' && it.status !== '보류' && stageNo(it.stage) !== 7; }) + '</b></span>' +
    '<span>보류<b>' + cnt(function (it) { return it.status === '보류'; }) + '</b></span>' +
    '<span>종결<b>' + cnt(function (it) { return stageNo(it.stage) === 7; }) + '</b></span>' +
    '<span>드랍<b>' + cnt(function (it) { return it.tab === '드랍'; }) + '</b></span></div>' +
    '<span class="upd2">시트 반영 ' + esc(s.updated || '') + (s.sheetUrl ? ' · <a href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">시트 열기</a>' : '') + '</span></div>';
  if (s.error) return h + '<div class="card">이 시즌 파일을 열지 못했어요: ' + esc(s.error) + '</div></section>';
  if (!items.length) return h + '<div class="empty">' + (filtering ? '조건에 맞는 건이 없어요.' : '아직 등록된 건이 없어요.') + '</div></section>';
  return h + (S.view === 'list' ? listView(items) : boardView(s, items)) + '</section>';
}

function boardView(s, items) {
  var stages = (s.stages || []).filter(function (st) { return stageNo(st) !== 8; });
  var onBoard = function (it) { return it.tab !== '드랍' && it.status !== '보류' && it.status !== '드랍' && stages.indexOf(stageLabel(it.stage)) >= 0; };
  var main = items.filter(onBoard), rest = items.filter(function (it) { return !onBoard(it); });
  var rows = ['신규', '리오더'].filter(function (r) { return main.some(function (it) { return it.type === r; }) || (!S.q && (S.type === 'all' || S.type === r)); });
  var h = '';
  if (rows.length && (main.length || !rest.length)) {
    h += '<div class="scroll"><div class="grid" style="--cols:' + stages.length + '"><div></div>' + stages.map(function (st) {
      return '<div class="sh" style="' + stageStyle(st) + '"><span>' + esc(st.replace('_', ' ')) + '</span><span class="mono">' + main.filter(function (it) { return stageLabel(it.stage) === st; }).length + '</span></div>'; }).join('') + '</div>';
    rows.forEach(function (r) {
      var mine = main.filter(function (it) { return it.type === r; });
      h += '<div class="grid" style="--cols:' + stages.length + '"><div class="rl"><b>' + r + '</b><span>' + mine.length + '건</span></div>' + stages.map(function (st) {
        var cs = mine.filter(function (it) { return stageLabel(it.stage) === st; });
        return '<div class="col">' + (cs.length ? cs.map(card).join('') : '<div class="dash">–</div>') + '</div>'; }).join('') + '</div>';
    });
    h += '</div>';
  }
  if (rest.length) {
    h += '<details class="extra"' + (S.q || S.type === '드랍' || !main.length ? ' open' : '') + '><summary>보류 · 드랍 · 단계 미지정 <span class="chip gray">' + rest.length + '</span></summary><div class="hold">' +
      rest.map(function (it) {
        var tag = it.tab === '드랍' || it.status === '드랍' ? ['드랍','bad'] : it.status === '보류' ? ['보류','warn'] : ['단계 확인','gray'];
        return '<button class="hitem" data-id="' + esc(it._id) + '"><span class="chip ' + tag[1] + '">' + tag[0] + '</span><span class="mono">' + codeText(it) + '</span><b>' + hl(title(it)) + '</b>' + (it.memo ? '<span class="sub">' + hl(it.memo) + '</span>' : '') + '</button>'; }).join('') + '</div></details>';
  }
  return h;
}

function listView(items) {
  var sorted = items.slice().sort(function (a, b) { return stageNo(a.stage) - stageNo(b.stage) || String(b.updated).localeCompare(String(a.updated)); });
  return '<div class="tablewrap"><table><thead><tr><th>구분</th><th>품번</th><th>컬러</th><th>기획명 · 아이템명</th><th>현재 단계</th><th>상태</th><th>업데이트</th><th>최근 내용</th><th>메모</th></tr></thead><tbody>' +
    sorted.map(function (it) {
      return '<tr data-id="' + esc(it._id) + '" tabindex="0"><td class="c-type" data-l="구분">' + hl(it.tab === '드랍' ? '드랍' : it.type) + '</td><td class="mono c-code" data-l="품번">' + codeText(it) + ' ' + '<span class="m-only">' + colorChip(it.color) + '</span></td><td class="c-color" data-l="컬러">' + colorChip(it.color) + '</td><td class="c-title" data-l="기획명"><b>' + hl(title(it)) + '</b>' + (it.name && it.plan ? '<div class="sub">' + hl(it.name) + '</div>' : '') + '</td>' +
        '<td class="c-stage" data-l="단계"><span class="chip" style="' + stageStyle(it.stage) + '">' + hl(it.stage || '미지정') + '</span></td><td class="c-status" data-l="상태">' + hl(it.status) + '</td><td class="mono c-upd" data-l="업데이트">' + esc(md(it.updated)) + '</td><td class="c-recent" data-l="최근 내용">' + hl(it.recent) + '</td><td class="c-memo" data-l="메모">' + hl(it.memo) + '</td></tr>'; }).join('') +
    '</tbody></table></div>';
}

function showDetail(id) {
  var it = S.all.filter(function (x) { return x._id === id; })[0]; if (!it) return;
  var season = S.seasons.filter(function (s) { return s.label === it._season; })[0] || {};
  var n = stageNo(it.stage), steps = (season.stages || []).filter(function (st) { return stageNo(st) !== 8; });
  var d = $('#detail');
  d.classList.toggle('wide', !!it.detail);
  d.innerHTML = '<div class="dh"><div><div class="sub" style="color:#C9CEE0">' + esc(it._season) + ' · ' + esc(it.tab === '드랍' ? '드랍' : it.type) + '</div><h2 id="dtitle">' + esc(title(it)) + '</h2>' +
    '<div class="mono" style="margin-top:4px">' + esc(it.code ? it.code + (it.color ? (it.color.indexOf(',') >= 0 ? '  ·  ' + it.color.replace(/,\s*/g, ' · ') : '_' + it.color) : '') : '품번 미부여') + '</div></div><button class="x" aria-label="닫기">×</button></div><div class="db">' +
    (n && n !== 8 ? '<div class="steps" aria-label="진행 단계">' + steps.map(function (st) { return '<i class="' + (stageNo(st) <= n ? 'on' : '') + '" title="' + esc(st) + '"></i>'; }).join('') + '</div>' : '') +
    FIELD_LABEL.map(function (f) { var v = it[f[0]]; if (f[0] === 'season') v = v || it._season; return '<div class="kv"><span>' + f[1] + '</span><span>' + (f[0] === 'color' ? colorChip(v) : f[0] === 'stage' ? '<span class="chip" style="' + stageStyle(v) + '">' + esc(v || '미지정') + '</span>' : esc(v || '–')) + '</span></div>'; }).join('') +
    (it.detail ? detailHtml(it) : '') +
    '<div class="foot">' + (season.sheetUrl && !it.detail ? '<a class="btn" href="' + esc(season.sheetUrl) + '" target="_blank" rel="noopener">진행현황 시트 열기</a>' : '') +
    '<button class="btn" id="copyid">품번 복사</button></div><p class="sub" style="margin:12px 0 0">수정은 시트에서 하고, Claude에게 최신화를 요청하면 이 화면에 반영돼요.</p></div>';
  $('.x', d).onclick = function () { d.close(); };
  $('#copyid', d).onclick = function () { var t = it.code ? it.code + (it.color && it.color.indexOf(',') < 0 ? '_' + it.color : '') : title(it); if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { $('#copyid', d).textContent = '복사됨'; }); };
  d.onclick = function (e) { if (e.target === d) d.close(); };
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

function bind() {
  $$('[data-type]').forEach(function (b) { b.onclick = function () { S.type = b.dataset.type; render(); }; });
  $$('[data-view]').forEach(function (b) { b.onclick = function () { S.view = b.dataset.view; render(); }; });
  $$('[data-stage]').forEach(function (b) { b.onclick = function () { var k = b.dataset.stage; S.stagesOff[k] = !S.stagesOff[k]; render(); }; });
  $$('[data-id]').forEach(function (b) {
    b.onclick = function () { showDetail(b.dataset.id); };
    if (b.tagName === 'TR') b.onkeydown = function (e) { if (e.key === 'Enter') showDetail(b.dataset.id); };
  });
  $$('[data-jump]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var el = document.getElementById('s-' + a.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth' }); }; });
  var cs = $('#cat'); if (cs) cs.onchange = function () { S.cat = cs.value; render(); };
  var r = $('#reset'); if (r) r.onclick = function () { S.q = ''; S.type = 'all'; S.cat = 'all'; S.stagesOff = {}; $('#q').value = ''; render(); };
}

/* ---------- 전역 이벤트 ---------- */
var timer;
$('#q').addEventListener('input', function (e) { clearTimeout(timer); timer = setTimeout(function () { S.q = e.target.value.trim(); render(); }, 120); });
$('#q').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.target.value = ''; S.q = ''; render(); } });
document.addEventListener('keydown', function (e) {
  if (e.key === '/' && document.activeElement !== $('#q') && !$('#q').disabled && !$('#detail').open) { e.preventDefault(); $('#q').focus(); }
});
$('#lock').onclick = function () { sdel(KEY_STORE); S.key = null; S.all = []; S.seasons = []; showLock(); };

start();
})();
