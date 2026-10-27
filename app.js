(function () {
'use strict';
var CFG = window.APP_CONFIG || {};
var SEASONS = CFG.SEASONS && CFG.SEASONS.length ? CFG.SEASONS : [{ label: '시즌', sheetId: '' }];
var DEMO = !CFG.CLIENT_ID;
var TABS = ['10_제품마스터','11_컬러','12_히스토리','13_작업지시서','14_사이즈치수','15_이동수량','20_3PL검수','21_패킹리스트','22_패킹보관함','30_바코드마스터','99_설정'];
var MOVE_STAGES = ['작업 요청','재단','워싱처 입고','완성집 입고','수납용 입고','3PL 입고'];
var MOVE_COLS = ['요청수량','재단','워싱처 입고','완성집 입고','수납용 입고','3PL 입고'];
var CMAP = { 'GN':['#2F5D43','#fff'],'NV':['#2A3560','#fff'],'BE':['#D9C3A0','#2A2218'],'LBU':['#BCD0E6','#1B2A3D'],'GREEN MULTI':['#2F5D43','#fff'],'WHITE MULTI':['#ECEAE2','#2A2A28'],'RED MULTI':['#8E2A25','#fff'],'ORANGE MULTI':['#E0954F','#2A1A0A'] };

var S = { season: SEASONS[0].label, token: null, data: null, cost: {}, hasCost: false, demoCost: true, openColors: {}, filter: 'all', inboundFilter: 'all', bcTab: 'old', q: '', openFile: null };

function $(s, el) { return (el || document).querySelector(s); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
function num(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; }
function seasonCfg() { return SEASONS.filter(function (s) { return s.label === S.season; })[0] || SEASONS[0]; }

/* ---------- 데이터 읽기 ---------- */
function table(values, from, to) {
  if (!values || !values.length) return [];
  var hdr = (values[0] || []).slice(from || 0, to);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = (values[i] || []).slice(from || 0, to), o = {}, any = false;
    hdr.forEach(function (k, j) { var v = r[j] === undefined ? '' : r[j]; o[k] = v; });
    if (String(o[hdr[0]] || '').trim() !== '') out.push(o);
  }
  return out;
}
function fetchSheet(id, ranges) {
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values:batchGet?valueRenderOption=FORMATTED_VALUE&' +
    ranges.map(function (r) { return 'ranges=' + encodeURIComponent(r); }).join('&');
  return fetch(url, { headers: { Authorization: 'Bearer ' + S.token } }).then(function (r) {
    if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  });
}
function loadRaw() {
  if (DEMO) {
    if (window.SAMPLE) return Promise.resolve(window.SAMPLE);
    return fetch('data/sample.json').then(function (r) { return r.json(); });
  }
  var c = seasonCfg();
  return fetchSheet(c.sheetId, TABS.map(function (t) { return "'" + t + "'!A3:AZ1000"; })).then(function (res) {
    var o = {}; TABS.forEach(function (t, i) { o[t] = res.valueRanges[i].values || []; });
    if (!c.costSheetId) return o;
    return fetchSheet(c.costSheetId, ["'원가판가'!A3:E1000"]).then(function (cr) { o['원가판가'] = cr.valueRanges[0].values || []; return o; })
      .catch(function () { return o; });
  });
}
function build(raw) {
  var M = table(raw['10_제품마스터']);
  var d = { raw: raw, products: [], byId: {} };
  d.settings = (function () {
    var v = raw['99_설정'] || [], st = [], cats = [];
    for (var i = 1; i < v.length; i++) { if (v[i][3]) st.push(v[i][3]); if (v[i][1]) cats.push(v[i][1]); }
    return { stages: st.length ? st : ['개발진행중','패턴','프로토샘플','QC · 재QC','APP','메인수납','종결'], cats: cats };
  })();
  function group(rows, key) { var g = {}; rows.forEach(function (r) { var k = typeof key === 'function' ? key(r) : r[key]; (g[k] = g[k] || []).push(r); }); return g; }
  d.hist = group(table(raw['12_히스토리']), '생산건ID');
  d.colors = group(table(raw['11_컬러']), '생산건ID');
  d.orders = group(table(raw['13_작업지시서']), '생산건ID');
  d.sizes = group(table(raw['14_사이즈치수']), '생산건ID');
  d.moves = group(table(raw['15_이동수량']), '생산건ID');
  d.insp = table(raw['20_3PL검수']);
  d.inspById = group(d.insp, '스타일 NO (생산건ID)');
  d.barcodes = table(raw['30_바코드마스터']);
  d.bcById = group(d.barcodes, '스타일 NO (생산건ID)');
  d.packItems = group(table(raw['21_패킹리스트'], 0, 11), '생산건ID');
  d.packHdr = table(raw['21_패킹리스트'], 12, 21);
  d.archive = table(raw['22_패킹보관함'], 0, 8);
  M.forEach(function (m) { if (m['생산건ID']) { d.products.push(m); d.byId[m['생산건ID']] = m; } });
  var cm = {};
  table(raw['원가판가']).forEach(function (r) { cm[r['생산건ID']] = r; });
  d.costMap = cm; d.hasCostData = !!raw['원가판가'];
  return d;
}
function load() {
  $('#app').innerHTML = '<p class="empty">불러오는 중…</p>';
  return loadRaw().then(function (raw) {
    S.data = build(raw);
    S.hasCost = DEMO ? S.demoCost : S.data.hasCostData;
    render();
  }).catch(function (e) {
    $('#app').innerHTML = '<div class="card"><h2>데이터를 불러오지 못했어요</h2><p>' + esc(e.message) + '</p><p class="sub">시트 공유 권한이 있는지, config.js의 시트 ID가 맞는지 확인해 주세요.</p></div>';
  });
}

/* ---------- 로그인 ---------- */
function ensureLogin() {
  if (DEMO) return Promise.resolve();
  return new Promise(function (resolve) {
    function show() {
      $('#app').innerHTML = '<div class="login card"><h1>시즌 생산관리</h1><p class="sub">회사 구글 계정으로 로그인하세요. 시트 공유 권한이 있는 계정만 내용을 볼 수 있습니다.</p><p><button id="loginbtn" class="btn pri">구글 계정으로 로그인</button></p></div>';
      $('#loginbtn').onclick = function () { client.requestAccessToken(); };
    }
    var client;
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
    s.onload = function () {
      client = google.accounts.oauth2.initTokenClient({ client_id: CFG.CLIENT_ID, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        callback: function (r) { if (r && r.access_token) { S.token = r.access_token; $('#who').textContent = '로그인됨'; resolve(); } } });
      show();
    };
    document.head.appendChild(s);
  });
}

/* ---------- 공통 조각 ---------- */
function cchips(str) {
  if (!str) return '';
  return String(str).split(/,\s*/).map(function (l) { var m = CMAP[l] || ['#E3E1D8', '#333']; return '<span class="cc" style="background:' + m[0] + ';color:' + m[1] + '">' + esc(l) + '</span>'; }).join('');
}
function pid(p) { return p['생산건ID']; }
function ptag(p) { return p['구분'] === '리오더' ? (p['차수'] || '리오더') : (String(p['품번']).indexOf('미부여') === 0 ? '라인업' : 'NEW'); }
function plink(p, text) { return '<a href="#/p/' + encodeURIComponent(pid(p)) + '">' + esc(text || p['기획명'] || pid(p)) + '</a>'; }
function lastHist(id) { var h = S.data.hist[id]; return h && h.length ? h[h.length - 1] : null; }
function md(date) { var m = /^\d{4}-(\d\d)-(\d\d)/.exec(date || ''); return m ? m[1] + '/' + m[2] : (date || ''); }
function imgUrl(u) {
  if (!u) return '';
  var m = /\/d\/([\w-]+)/.exec(u) || /[?&]id=([\w-]+)/.exec(u);
  return m ? 'https://drive.google.com/thumbnail?sz=w1000&id=' + m[1] : u;
}
function title(eyebrow, h, sub, right) {
  return '<div class="row" style="margin-bottom:20px"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(h) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (right || '') + '</div>';
}
function stageIdx(p) { return S.data.settings.stages.indexOf(p['현재 단계']); }

/* ---------- 홈 ---------- */
function viewHome() {
  var d = S.data, P = d.products;
  var ing = P.filter(function (p) { return p['상태'] === '진행'; }).length;
  var hold = P.filter(function (p) { return p['상태'] === '보류'; }).length;
  var diff = d.insp.filter(function (r) { return r['상태'] === '부족' || r['상태'] === '초과'; }).length;
  var shortRows = 0; Object.keys(d.moves).forEach(function (k) { d.moves[k].forEach(function (r) { if (r['부족 · 초과 요약']) shortRows++; }); });
  var cats = d.settings.cats.concat(['미분류']);
  var html = title('RENACTS · ' + S.season, '시즌 자료 관제탑', '시트에 입력된 내용을 보기 쉽게 보여줍니다. 수정은 시트에서 합니다.');
  html += '<div class="stats"><div class="stat"><div class="l">진행 중 제품</div><div class="v mono">' + ing + '</div></div><div class="stat"><div class="l">보류</div><div class="v mono">' + hold + '</div></div>' +
    '<div class="stat"><div class="l">수량 부족·초과 확인 필요</div><div class="v mono">' + shortRows + '</div></div><div class="stat"><div class="l">3PL 수량 차이 (바코드)</div><div class="v mono">' + diff + '</div></div></div>';
  html += '<div class="card menu"><details class="l1" open><summary>시즌 ' + esc(S.season) + '</summary><div class="inner">' +
    '<a class="item" href="#/board"><span>시즌 진행 현황</span><span class="arr">보드로 이동 →</span></a>' +
    '<details><summary>아이템별 구분</summary><div class="inner">' + cats.map(function (c) {
      var list = P.filter(function (p) { return (p['카테고리'] || '미분류') === c; });
      return '<details><summary>' + esc(c) + ' <span class="chip gray">' + list.length + '개</span></summary><div class="inner">' +
        (list.length ? list.map(function (p) { return '<a class="item" href="#/p/' + encodeURIComponent(pid(p)) + '"><span>' + esc(p['기획명'] || pid(p)) + ' <span class="mono sub">' + esc(pid(p)) + '</span></span><span class="arr">상세 →</span></a>'; }).join('') : '<div class="empty">이 카테고리로 지정된 제품이 없어요</div>') +
        '</div></details>'; }).join('') + '</div></details></div></details>' +
    '<a class="item" style="font-size:20px;font-weight:700;min-height:60px" href="#/inbound"><span>3PL 입고 검수 비교</span><span class="arr">→</span></a>' +
    '<a class="item" style="font-size:20px;font-weight:700;min-height:60px" href="#/barcode"><span>바코드 시스템 마스터</span><span class="arr">기존 · 신규 →</span></a>' +
    '<a class="item" style="font-size:20px;font-weight:700;min-height:60px" href="#/archive"><span>패킹리스트 보관함</span><span class="arr">엑셀 보관함 →</span></a></div>';
  return html;
}
function viewItems() { return viewHome(); }

/* ---------- 진행 보드 ---------- */
function viewBoard() {
  var d = S.data, ST = d.settings.stages;
  var P = d.products.filter(function (p) { return p['상태'] === '진행'; });
  var rows = [{ k: '신규', label: '신규' }, { k: '리오더', label: '리오더' }].filter(function (r) { return S.filter === 'all' || S.filter === r.k; });
  var shown = P.filter(function (p) { return S.filter === 'all' || p['구분'] === S.filter; });
  var h = title('진행관리 보드', '시즌 진행현황', '카드를 클릭하면 제품 상세로 이동합니다. 카드의 주황 박스에는 가장 마지막 진행사항이 표시돼요.',
    '<div class="seg" role="group" aria-label="구분 필터">' + [['all','전체'],['신규','신규'],['리오더','리오더']].map(function (t) { return '<button class="segb ' + (S.filter === t[0] ? 'on' : '') + '" data-filter="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>');
  h += '<div class="scroll"><div class="grid"><div></div>' + ST.map(function (n, i) { return '<div class="sh"><span>0' + (i + 1) + ' ' + esc(n) + '</span><span class="mono">' + shown.filter(function (p) { return stageIdx(p) === i; }).length + '</span></div>'; }).join('') + '</div>';
  rows.forEach(function (r) {
    h += '<div class="grid"><div class="rl"><b>' + r.label + '</b><span>' + esc(S.season) + '</span></div>' + ST.map(function (n, i) {
      var cards = P.filter(function (p) { return p['구분'] === r.k && stageIdx(p) === i; });
      return '<div class="col">' + (cards.length ? cards.map(function (p) {
        var l = lastHist(pid(p));
        return '<a class="kcard" href="#/p/' + encodeURIComponent(pid(p)) + '"><div style="display:flex;justify-content:space-between;gap:6px"><span class="mono" style="font-size:12px;font-weight:500">' + esc(String(p['품번']).indexOf('미부여') === 0 ? '품번 미부여' : p['품번']) + '</span><span class="chip">' + esc(ptag(p)) + '</span></div>' +
          '<div class="kn">' + esc(p['기획명']) + '</div><div>' + cchips(p['컬러']) + '</div>' +
          (l ? '<div class="kstat"><b>#' + (d.hist[pid(p)].length) + '</b> · ' + esc(md(l['일자'])) + ' · ' + esc(l['내용']) + '</div>' : '') +
          (p['메모'] && p['메모'] !== '품번 부여 전 단계' ? '<div class="kflag">' + esc(p['메모']) + '</div>' : '') + '</a>';
      }).join('') : '<div class="dash">–</div>') + '</div>'; }).join('') + '</div>';
  });
  h += '</div>';
  var hold = d.products.filter(function (p) { return p['상태'] === '보류' || p['상태'] === '드랍'; });
  h += '<h2 style="margin-top:28px">보류 · 드랍 <span class="sub">진행 제외</span></h2><div class="hold">' + (hold.length ? hold.map(function (p) {
    return '<div class="hitem"><span class="chip bad">' + esc(p['상태']) + '</span><b>' + esc(p['기획명']) + '</b><span class="sub">' + esc(p['메모']) + '</span></div>'; }).join('') : '<span class="sub">없음</span>') + '</div>';
  return h;
}

/* ---------- 수량 계산 ---------- */
function qtyModel(id, wash) {
  var moves = S.data.moves[id] || [], colors = (S.data.colors[id] || []).map(function (c) { return c['컬러']; });
  var use = MOVE_STAGES.map(function (n, i) { return !(wash !== '있음' && (i === 2 || i === 3)); });
  function val(rows, col) { var seen = false, sum = 0; rows.forEach(function (r) { var v = num(r[col]); if (v !== null) { seen = true; sum += v; } }); return seen ? sum : null; }
  function line(rows) { return MOVE_COLS.map(function (c, i) { return use[i] ? val(rows, c) : undefined; }); }
  var out = { colors: [], total: null, use: use };
  colors.forEach(function (c) {
    var cr = moves.filter(function (r) { return r['컬러'] === c; });
    out.colors.push({ name: c, line: line(cr), sizes: [1,2,3,4].map(function (s) { return { size: s, line: line(cr.filter(function (r) { return String(r['사이즈']) === String(s); })) }; }) });
  });
  out.total = MOVE_COLS.map(function (c, i) {
    if (!use[i] || !out.colors.length) return use[i] ? null : undefined;
    var vs = out.colors.map(function (x) { return x.line[i]; });
    return vs.every(function (v) { return v !== null; }) ? vs.reduce(function (a, b) { return a + b; }, 0) : null;
  });
  return out;
}
function cells(line) {
  var prev = null;
  return line.map(function (v) {
    if (v === undefined) return { t: '–', d: '제외', c: 'wait' };
    if (v === null) return { t: '–', d: '대기', c: 'wait' };
    var r;
    if (prev === null) r = { t: String(v), d: '시작', c: 'wait' };
    else if (v < prev) r = { t: String(v), d: '−' + (prev - v) + ' 부족', c: 'neg' };
    else if (v > prev) r = { t: String(v), d: '+' + (v - prev) + ' 초과', c: 'pos' };
    else r = { t: String(v), d: '동일', c: 'eq' };
    prev = v; return r;
  });
}
function qtyHtml(id, wash) {
  var m = qtyModel(id, wash);
  if (!m.colors.length) return '<div class="empty">등록된 컬러가 없어요. 시트의 11_컬러에 추가하세요.</div>';
  var heads = MOVE_STAGES.filter(function (n, i) { return m.use[i]; });
  function tds(line) { return cells(line).filter(function (c, i) { return m.use[i]; }).map(function (c) { return '<td class="n">' + esc(c.t) + '<span class="dl ' + c.c + '">' + esc(c.d) + '</span></td>'; }).join(''); }
  var h = '<div class="scroll"><table><thead><tr><th>컬러 / 사이즈</th>' + heads.map(function (n) { return '<th class="n">' + esc(n) + '</th>'; }).join('') + '</tr></thead><tbody>';
  m.colors.forEach(function (c) {
    var key = id + '|' + c.name, open = !!S.openColors[key];
    h += '<tr><td><button class="tgl" data-color="' + esc(key) + '" aria-expanded="' + open + '">' + (open ? '▴' : '▾') + ' ' + esc(c.name) + '</button></td>' + tds(c.line) + '</tr>';
    if (open) c.sizes.forEach(function (s) { h += '<tr class="sub"><td style="padding-left:32px">' + esc(c.name) + ' · 사이즈 ' + s.size + '</td>' + tds(s.line) + '</tr>'; });
  });
  h += '<tr class="tot"><td>합계</td>' + tds(m.total) + '</tr></tbody></table></div>';
  return h;
}

/* ---------- 제품 상세 ---------- */
function infoKv(rows) { return rows.map(function (r) { return '<div class="kv"><span>' + esc(r[0]) + '</span><span>' + (r[2] ? r[1] : esc(r[1] || '–')) + '</span></div>'; }).join(''); }
function viewProduct(id) {
  var d = S.data, p = d.byId[id];
  if (!p) return '<div class="card"><h2>제품을 찾을 수 없어요</h2><p><a href="#/">관제탑으로 돌아가기</a></p></div>';
  var ST = d.settings.stages, cur = stageIdx(p), hist = d.hist[id] || [];
  var hdrs = d.packHdr.filter(function (r) { return r['생산건ID'] === id; });
  var photo = ''; hdrs.forEach(function (r) { if (!photo && r['메인사진 링크']) photo = r['메인사진 링크']; });
  var link = function (u, t) { return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>' : '<span class="chip gray">' + t + ' 미등록</span>'; };
  var h = '<div class="crumb"><a href="#/">← 관제탑</a> · <a href="#/board">진행현황</a> · ' + esc((p['카테고리'] || '미분류') + ' › ' + (p['기획명'] || id)) + '</div>';
  h += title(ptag(p) + ' · ' + p['시즌'], p['기획명'] || id, '<span class="mono">' + esc(id) + '</span>' + (p['상태'] !== '진행' ? ' · <span class="chip bad">' + esc(p['상태']) + '</span>' : ''),
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' + (p['원가계산서 링크'] && S.hasCost ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(p['원가계산서 링크']) + '">원가계산서 열기</a>' : '') + (p['작업지시서 PDF 링크'] ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(p['작업지시서 PDF 링크']) + '">작업지시서 PDF</a>' : '') + (p['원부자재 발주 링크'] ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(p['원부자재 발주 링크']) + '">원부자재 발주</a>' : '') + '</div>');
  h += '<div class="steps">' + ST.map(function (n, i) {
    var f = hist.filter(function (x) { return x['단계'] === n; })[0];
    return '<div class="step ' + (cur < 0 ? 'todo' : i < cur ? '' : i === cur ? 'cur' : 'todo') + '"><div class="sn">0' + (i + 1) + '</div><div class="st">' + esc(n) + '</div><div class="sd">' + (f ? esc(md(f['일자'])) : i === cur ? '진행중' : '&nbsp;') + '</div></div>'; }).join('') + '</div>';
  var cost = S.hasCost ? d.costMap[id] : null;
  h += '<div class="card"><div class="two"><div class="photo">' + (photo ? '<img src="' + esc(imgUrl(photo)) + '" alt="' + esc(p['기획명']) + ' 메인 사진">' : '도식화 · 실물 사진<br>(21_패킹리스트의 메인사진 링크에 넣으면 여기에 표시)') + '</div>' +
    '<div class="info"><div><h2>제품 정보</h2>' + infoKv([['기획명', p['기획명']], ['Flow FIX 제품명', p['Flow FIX 제품명']], ['영문 판매명', p['영문 판매명']], ['카테고리', p['카테고리']], ['구분 · 차수', p['구분'] + ' · ' + p['차수']], ['컬러', cchips(p['컬러']) || '', true], ['세트 연결', p['세트 연결']]]) + '</div>' +
    '<div><h2>&nbsp;</h2>' + infoKv([['혼용율', p['혼용율']], ['원산지(제조국)', p['원산지(제조국)']], ['워싱 여부', p['워싱 여부']], ['봉제공장', p['봉제공장']], ['FIT', p['FIT']], ['원단', p['원단']], ['규격 · 중량', p['규격 · 중량']], ['워싱기법', p['워싱기법']]]) +
    (S.hasCost ? infoKv([['원가 (VAT+)', cost && cost['원가 NET TOTAL (VAT+)'] ? Number(num(cost['원가 NET TOTAL (VAT+)'])).toLocaleString() + '원' : '미입력'], ['판가 · 배수', cost && cost['판가'] ? Number(num(cost['판가'])).toLocaleString() + '원 · ' + (num(cost['원가 NET TOTAL (VAT+)']) ? (num(cost['판가']) / num(cost['원가 NET TOTAL (VAT+)'])).toFixed(1) + '배' : '-') : '미입력']]) : '<div class="kv"><span>원가 · 판가</span><span class="locked">열람 권한이 없습니다</span></div>') + '</div></div>' +
    (p['메모'] ? '<p class="note">메모: ' + esc(p['메모']) + '</p>' : '') + '</div></div>';
  h += '<div class="card"><div class="row"><h2>단계별 수량 추적</h2><span class="sub">워싱 ' + esc(p['워싱 여부'] || '미지정') + ' · 각 칸 아래 표시는 바로 앞 단계 대비입니다. 컬러를 누르면 사이즈별로 펼쳐집니다.</span></div>' + qtyHtml(id, p['워싱 여부']) + '</div>';
  var sz = d.sizes[id] || [];
  h += '<div class="card"><h2>사이즈표</h2>' + (sz.length ? '<div class="scroll"><table><thead><tr><th>부위</th><th class="n">1</th><th class="n">2</th><th class="n">3</th><th class="n">4</th><th>비고</th></tr></thead><tbody>' + sz.map(function (r) { return '<tr><td>' + esc(r['부위']) + '</td>' + [1,2,3,4].map(function (n) { var v = r['사이즈 ' + n]; return '<td class="n mono">' + (v === '' ? '<span class="sub">–</span>' : esc(v)) + '</td>'; }).join('') + '<td class="sub">' + esc(r['비고']) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">등록된 사이즈표가 없어요.</div>') + '</div>';
  var ins = d.inspById[id] || [];
  h += '<div class="card"><h2>3PL 입고 검수</h2>' + (ins.length ? inspTable(ins) : '<div class="empty">아직 3PL 입고 기록이 없어요.</div>') + '</div>';
  var items = d.packItems[id] || [];
  h += '<div class="card"><h2>패킹리스트</h2>' + (items.length ? packHtml(id, items, hdrs) : '<div class="empty">등록된 부자재 구성이 없어요.</div>') + '</div>';
  h += '<div class="card"><h2>히스토리</h2>' + (hist.length ? '<table><thead><tr><th>순번</th><th>일자</th><th>단계</th><th>내용</th><th>출처</th><th>첨부</th></tr></thead><tbody>' +
    hist.map(function (r, i) { return '<tr class="' + (i === hist.length - 1 ? 'latest' : '') + '"><td class="mono">' + (i + 1) + '</td><td class="mono">' + esc(md(r['일자'])) + '</td><td>' + esc(r['단계']) + '</td><td>' + esc(r['내용']) + '</td><td><span class="chip ' + (r['출처'] === 'PDF' ? '' : 'gray') + '">' + esc(r['출처']) + '</span></td><td>' + (r['첨부 링크'] ? '<a href="' + esc(r['첨부 링크']) + '" target="_blank" rel="noopener">열기</a>' : '') + '</td></tr>'; }).reverse().join('') + '</tbody></table><p class="note">가장 최근 기록이 맨 위이고, 진행현황 보드의 현재 상태로 표시됩니다.</p>' : '<div class="empty">아직 기록이 없어요.</div>') + '</div>';
  return h;
}
function inspTable(rows) {
  var inq = 0, out = 0;
  var h = '<div class="scroll"><table><thead><tr><th>바코드</th><th>컬러</th><th class="n">사이즈</th><th class="n">입고</th><th class="n">검수</th><th class="n">차이</th><th>전장 대조</th><th>상태</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    inq += num(r['입고수량 (패킹리스트)']) || 0; out += num(r['검수수량 (3PL)']) || 0;
    var st = r['상태'], sc = st === '일치' ? 'ok' : (st === '부족' || st === '초과') ? 'bad' : 'gray', vc = r['전장 대조'] === '전장 일치' ? 'ok' : 'bad';
    h += '<tr><td class="mono">' + esc(r['바코드']) + '</td><td>' + esc(r['컬러']) + '</td><td class="n mono">' + esc(r['사이즈']) + '</td><td class="n mono">' + esc(r['입고수량 (패킹리스트)']) + '</td><td class="n mono">' + esc(r['검수수량 (3PL)']) + '</td><td class="n mono">' + esc(r['차이 (검수−입고)']) + '</td><td><span class="chip ' + vc + '">' + esc(r['전장 대조']) + '</span></td><td><span class="chip ' + sc + '">' + esc(st) + '</span></td></tr>';
  });
  return h + '<tr class="tot"><td>TOTAL</td><td></td><td></td><td class="n mono">' + inq + '</td><td class="n mono">' + out + '</td><td class="n mono">' + (out - inq) + '</td><td></td><td></td></tr></tbody></table></div>';
}
function packHtml(id, items, hdrs) {
  var colors = []; items.forEach(function (r) { if (colors.indexOf(r['컬러']) < 0) colors.push(r['컬러']); });
  var h = '';
  colors.forEach(function (c) {
    var hd = hdrs.filter(function (r) { return r['컬러'] === c; })[0] || {};
    h += '<div class="pk"><div class="hd">' + esc(hd['패킹리스트 제목'] || id + '_' + c) + '</div><div style="padding:10px 14px;font-size:13px" class="sub">발송처 ' + esc(hd['발송처'] || '–') + ' · 발송일 ' + esc(hd['발송일'] || '–') + ' · 입고처 ' + esc(hd['입고처'] || '–') + ' · 입고일 ' + esc(hd['입고일'] || '–') + '</div><div class="scroll"><table><thead><tr><th>구분</th><th>부자재</th><th>적용 사이즈</th><th class="n">1장당</th><th class="n">기준수량</th><th class="n">여유수량</th><th class="n">발송수량</th></tr></thead><tbody>' +
      items.filter(function (r) { return r['컬러'] === c; }).map(function (r) { return '<tr><td>' + esc(r['구분']) + '</td><td>' + esc(r['부자재']) + '</td><td>' + esc(r['적용 사이즈']) + '</td><td class="n mono">' + esc(r['1장당']) + '</td><td class="n mono">' + esc(r['기준수량']) + '</td><td class="n mono">' + esc(r['여유수량']) + '</td><td class="n mono"><b>' + esc(r['발송수량']) + '</b></td></tr>'; }).join('') + '</tbody></table></div></div>';
  });
  var tot = items.filter(function (r) { return r['부자재 합계 (생산건 전체)'] !== ''; });
  h += '<h2 style="margin-top:16px">토탈수량 <span class="sub">같은 부자재명 자동 합산</span></h2><div class="scroll"><table><tbody>' + tot.map(function (r) { return '<tr><td>' + esc(r['부자재']) + '</td><td class="n mono"><b>' + esc(r['부자재 합계 (생산건 전체)']) + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
  return h;
}

/* ---------- 3PL / 바코드 / 보관함 ---------- */
function viewInbound() {
  var rows = S.data.insp.filter(function (r) { return S.inboundFilter === 'all' || r['상태'] === '부족' || r['상태'] === '초과'; });
  var all = S.data.insp, inq = 0, out = 0, ok = 0;
  all.forEach(function (r) { inq += num(r['입고수량 (패킹리스트)']) || 0; out += num(r['검수수량 (3PL)']) || 0; if (r['전장 대조'] === '전장 일치') ok++; });
  var diffN = all.filter(function (r) { return r['상태'] === '부족' || r['상태'] === '초과'; }).length;
  var h = title('3PL 입고 검수 비교', '3PL 입고 검수 비교', '우리가 보낸 패킹리스트 수량과 3PL 검수완료 수량을 바코드별로 비교합니다.');
  h += '<div class="stats"><div class="stat"><div class="l">입고수량 (패킹리스트)</div><div class="v mono">' + inq + '</div></div><div class="stat"><div class="l">검수수량 (3PL)</div><div class="v mono">' + out + '</div></div><div class="stat"><div class="l">차이</div><div class="v mono">' + (out - inq) + '</div></div><div class="stat"><div class="l">바코드 전장 대조</div><div class="v mono">' + ok + ' / ' + all.length + '</div></div></div>';
  h += '<div class="card"><div class="row"><h2>바코드별 비교</h2><div class="seg"><button class="segb ' + (S.inboundFilter === 'all' ? 'on' : '') + '" data-inb="all">전체 ' + all.length + '</button><button class="segb ' + (S.inboundFilter === 'diff' ? 'on' : '') + '" data-inb="diff">차이 있음 ' + diffN + '</button></div></div>';
  h += rows.length ? '<div class="scroll"><table><thead><tr><th>스타일 NO</th><th>바코드</th><th>상품명</th><th>컬러</th><th class="n">사이즈</th><th class="n">입고</th><th class="n">검수</th><th class="n">차이</th><th>전장 대조</th><th>상태</th></tr></thead><tbody>' + rows.map(function (r) {
    var st = r['상태'], sc = st === '일치' ? 'ok' : (st === '부족' || st === '초과') ? 'bad' : 'gray', vc = r['전장 대조'] === '전장 일치' ? 'ok' : 'bad';
    return '<tr><td class="mono">' + esc(r['스타일 NO (생산건ID)']) + '</td><td class="mono">' + esc(r['바코드']) + '</td><td>' + esc(r['상품명']) + '</td><td>' + esc(r['컬러']) + '</td><td class="n mono">' + esc(r['사이즈']) + '</td><td class="n mono">' + esc(r['입고수량 (패킹리스트)']) + '</td><td class="n mono">' + esc(r['검수수량 (3PL)']) + '</td><td class="n mono">' + esc(r['차이 (검수−입고)']) + '</td><td><span class="chip ' + vc + '">' + esc(r['전장 대조']) + '</span></td><td><span class="chip ' + sc + '">' + esc(st) + '</span></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">수량 차이가 있는 바코드가 없어요.</div>';
  return h + '</div>';
}
function viewBarcode() {
  var q = S.q.trim().toLowerCase();
  var all = S.data.barcodes.filter(function (r) { return (S.bcTab === 'old') === (r['구분'] === '기존'); });
  var rows = all.filter(function (r) { return !q || String(r['바코드 번호']).toLowerCase().indexOf(q) >= 0 || String(r['스타일 NO (생산건ID)']).toLowerCase().indexOf(q) >= 0; });
  var oc = S.data.barcodes.filter(function (r) { return r['구분'] === '기존'; }).length, nc = S.data.barcodes.length - oc;
  var h = title('바코드 시스템 마스터', '바코드 시스템 마스터', '기존 데이터는 보관용이고, 시즌 중 새로 부여한 바코드는 신규로 쌓입니다.');
  h += '<div class="seg" style="margin-bottom:16px"><button class="segb ' + (S.bcTab === 'old' ? 'on' : '') + '" data-bc="old">기존 데이터 · ' + oc + '건</button><button class="segb ' + (S.bcTab === 'new' ? 'on' : '') + '" data-bc="new">신규 데이터 · ' + nc + '건</button></div>';
  h += '<div class="card"><div class="row" style="margin-bottom:12px"><h2 style="margin:0">' + (S.bcTab === 'old' ? '기존 바코드' : '신규 바코드') + '</h2><input type="search" id="q" placeholder="바코드 또는 스타일 NO" value="' + esc(S.q) + '" aria-label="검색"></div>' +
    (rows.length ? '<div class="scroll"><table><thead><tr><th>스타일 NO</th><th>바코드</th><th>컬러</th><th class="n">사이즈</th><th>등록일</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td class="mono">' + esc(r['스타일 NO (생산건ID)']) + '</td><td class="mono">' + esc(r['바코드 번호']) + '</td><td>' + esc(r['컬러']) + '</td><td class="n mono">' + esc(r['사이즈']) + '</td><td class="mono">' + esc(r['등록일']) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">' + (q ? '검색 결과가 없어요.' : '아직 등록된 바코드가 없어요.') + '</div>') + '</div>';
  return h;
}
function viewArchive() {
  var q = S.q.trim().toLowerCase(), d = S.data;
  var files = d.archive.filter(function (f) {
    if (!q) return true;
    if (String(f['파일명']).toLowerCase().indexOf(q) >= 0) return true;
    return d.barcodes.some(function (b) { return b['스타일 NO (생산건ID)'] === f['생산건ID'] && b['컬러'] === f['컬러'] && String(b['바코드 번호']).indexOf(q) >= 0; });
  });
  var h = title('패킹리스트 데이터', '패킹리스트 엑셀 보관함', '내보낸 패킹리스트 파일을 모아 둡니다. 파일을 펼치면 바코드 번호만 보여요.', '<input type="search" id="q" placeholder="파일명 또는 바코드 번호" value="' + esc(S.q) + '" aria-label="검색">');
  h += '<div class="files">' + (files.length ? files.map(function (f) {
    var codes = d.barcodes.filter(function (b) { return b['스타일 NO (생산건ID)'] === f['생산건ID'] && b['컬러'] === f['컬러']; });
    var open = S.openFile === f['파일명'] || (q && codes.some(function (b) { return String(b['바코드 번호']).indexOf(q) >= 0; }));
    return '<div class="f"><div class="fh"><button class="tgl" data-file="' + esc(f['파일명']) + '" aria-expanded="' + !!open + '"><span class="chip ok">XLS</span> <span class="mono">' + esc(f['파일명']) + '</span> <span class="sub">입고일 ' + esc(f['입고일']) + ' · 바코드 ' + codes.length + '개</span> ' + (open ? '▴' : '▾') + '</button>' +
      (f['파일 링크 (드라이브)'] ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(f['파일 링크 (드라이브)']) + '">엑셀 열기</a>' : '<span class="chip gray">파일 링크 미등록</span>') + '</div>' +
      (open ? '<div class="codes">' + codes.map(function (b) { return '<span class="code mono">' + esc(b['바코드 번호']) + '</span>'; }).join('') + '</div>' : '') + '</div>'; }).join('') : '<div class="card empty">검색 결과가 없어요.</div>') + '</div>';
  return h;
}

/* ---------- 라우터 ---------- */
function render() {
  if (!S.data) return;
  var hash = location.hash || '#/', app = $('#app'), html;
  var m = /^#\/p\/(.+)$/.exec(hash);
  if (m) html = viewProduct(decodeURIComponent(m[1]));
  else if (hash === '#/board') html = viewBoard();
  else if (hash === '#/inbound') html = viewInbound();
  else if (hash === '#/barcode') html = viewBarcode();
  else if (hash === '#/archive') html = viewArchive();
  else html = viewHome();
  app.innerHTML = html;
  Array.prototype.forEach.call(document.querySelectorAll('.topnav a'), function (a) { a.classList.toggle('on', a.getAttribute('href') === hash || (a.getAttribute('href') === '#/items' && hash === '#/')); });
  var q = $('#q'); if (q) q.addEventListener('input', function () { S.q = q.value; var pos = q.selectionStart; render(); var q2 = $('#q'); q2.focus(); q2.setSelectionRange(pos, pos); });
}
function banner() {
  var b = $('#banner');
  if (!DEMO) { b.innerHTML = ''; return; }
  b.innerHTML = '<div class="b"><b>데모 모드</b><span>샘플 데이터로 보는 화면입니다. config.js에 구글 설정을 넣으면 실제 시트를 읽어요.</span><label><input type="checkbox" id="demoCost" ' + (S.demoCost ? 'checked' : '') + '> 원가·판가 열람 권한 있음 (권한 없는 팀원 화면 미리보기)</label></div>';
  $('#demoCost').onchange = function () { S.demoCost = this.checked; S.hasCost = S.demoCost; render(); };
}
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-filter],[data-inb],[data-bc],[data-color],[data-file]'); if (!t) return;
  if (t.dataset.filter) S.filter = t.dataset.filter;
  else if (t.dataset.inb) S.inboundFilter = t.dataset.inb;
  else if (t.dataset.bc) { S.bcTab = t.dataset.bc; S.q = ''; }
  else if (t.dataset.color) S.openColors[t.dataset.color] = !S.openColors[t.dataset.color];
  else if (t.dataset.file) S.openFile = S.openFile === t.dataset.file ? null : t.dataset.file;
  render();
});
window.addEventListener('hashchange', function () { S.q = ''; render(); window.scrollTo(0, 0); });
var sel = $('#season');
sel.innerHTML = SEASONS.map(function (s) { return '<option>' + esc(s.label) + '</option>'; }).join('');
sel.onchange = function () { S.season = sel.value; load(); };
banner();
ensureLogin().then(load);
})();
