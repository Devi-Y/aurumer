'use strict';

const STORAGE_KEY = 'aurumHoldingsV1';
const state = { data: null, digest: null, digestSyncing: false, holdings: loadHoldings() };
const $ = (selector) => document.querySelector(selector);

function escapeHTML(value='') {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function localSession(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour >= 6 && hour < 9.5) return { key:'morning', label:'早间准备', copy:'先看隔夜美股、今日港股新股与自己的持仓触发条件。' };
  if (hour >= 9.5 && hour < 16) return { key:'intraday', label:'盘中观察', copy:'先看持仓是否进入观察、风险或止盈区间，再决定是否深入研究。' };
  if (hour >= 21 || hour < 6) return { key:'us', label:'美股时段', copy:'优先看美股价格变化、估值与价格纪律，不追逐盘中噪音。' };
  return { key:'evening', label:'晚间复盘', copy:'复盘今天发生了什么，整理明天需要继续观察的标的。' };
}

function formatDateTime(value) {
  if (!value) return '更新时间待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更新时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN', {maximumFractionDigits:digits}) : '—';
}

function loadHoldings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(item => item && item.market && item.code && (item.cost == null || Number(item.cost) >= 0))
      : [];
  } catch {
    return [];
  }
}

function saveHoldings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.holdings));
}

function normalizeCode(market, code) {
  const raw = String(code || '').trim().toUpperCase();
  if (market === 'A') return raw.replace(/\.(SH|SZ)$/i, '').replace(/\s+/g, '');
  if (market === 'HK') return raw.replace(/\.HK$/i, '').replace(/^0+/, '').replace(/\s+/g, '');
  return raw.replace(/\s+/g, '');
}

function dataMaps() {
  const data = state.data || {};
  const fundamentals = new Map((data.us?.fundamentals || []).map(item => [String(item.symbol).toUpperCase(), item]));
  const us = new Map((data.us?.stocks || []).map(item => {
    const code = String(item.symbol).toUpperCase();
    return [code, {...item, fundamentals: fundamentals.get(code) || null}];
  }));
  const a = new Map((data.aShare?.quotes || []).map(item => [normalizeCode('A', item.code), item]));
  const hk = new Map((data.hk?.listings || []).map(item => [normalizeCode('HK', item.code || item.stockCode), item]));
  return { us, a, hk, fundamentals };
}

function deriveUSAction(item) {
  const price = Number(item?.price);
  const plan = item?.technicalPlan || {};
  const buy = Number(plan.buy), stop = Number(plan.stop), firstTarget = Number(plan.tp?.[0]);
  if (!Number.isFinite(price)) return { text:'行情待核验', tone:'wait' };
  if (Number.isFinite(stop) && price <= stop) return { text:'已触及风险观察位', tone:'risk' };
  if (Number.isFinite(buy) && price <= buy) return { text:'进入分批观察区间', tone:'good' };
  if (Number.isFinite(firstTarget) && price >= firstTarget) return { text:'进入止盈观察区间', tone:'risk' };
  return { text:'继续持有或等待更好价格', tone:'wait' };
}

function impliedDividendPlan(item) {
  const price = Number(item?.currentPrice);
  const currentYield = Number(item?.currentDividendYield);
  const sustainableYield = Number(item?.sustainableDividendYield);
  if (![price, currentYield, sustainableYield].every(Number.isFinite) || price <= 0 || currentYield <= 0 || sustainableYield <= 0) return null;
  const dividendPerShare = price * currentYield / 100;
  const addYield = Math.max(sustainableYield * 1.12, sustainableYield + 0.4);
  const trimYield = Math.max(0.2, Math.min(sustainableYield * 0.88, sustainableYield - 0.3));
  if (trimYield <= 0 || addYield <= trimYield) return null;
  return {
    price,
    addPrice: dividendPerShare / addYield * 100,
    trimPrice: dividendPerShare / trimYield * 100,
    zone: currentYield >= addYield ? 'add' : currentYield <= trimYield ? 'trim' : 'hold',
  };
}

function deriveHoldingView(holding, maps) {
  const market = holding.market;
  const code = normalizeCode(market, holding.code);
  const costValue = Number(holding.cost);
  const cost = Number.isFinite(costValue) && costValue > 0 ? costValue : null;
  const shares = Number(holding.shares) || 0;
  if (market === 'US') {
    const item = maps.us.get(code);
    const current = Number(item?.price);
    const action = item ? deriveUSAction(item) : {text:'未匹配到当前数据，请核对代码',tone:'wait'};
    return { name:item?.name || code, current, change:Number(item?.changePercent), action, detail:'index.html#/us', shares, cost, source:item?.asOf ? `Yahoo Finance · ${formatDateTime(item.asOf)}` : '数据待核验' };
  }
  if (market === 'A') {
    const item = maps.a.get(code);
    const current = Number(item?.currentPrice);
    const plan = impliedDividendPlan(item);
    const text = !item
      ? '未匹配到当前数据，请核对代码'
      : plan?.zone === 'add'
        ? `进入加大观察区：现价 ${formatNumber(current)}，加大观察 ${formatNumber(plan.addPrice)}`
        : plan?.zone === 'trim'
          ? `进入兑现观察区：现价 ${formatNumber(current)}，兑现观察 ${formatNumber(plan.trimPrice)}`
          : plan
            ? `继续观察：现价 ${formatNumber(current)}，加大观察 ${formatNumber(plan.addPrice)}`
            : (item.summary || item.actionPriceNote || '收息观察价待公告核验');
    const tone = !item ? 'wait' : plan?.zone === 'add' ? 'good' : plan?.zone === 'trim' ? 'risk' : 'wait';
    return { name:item?.name || code, current, change:Number(item?.changePercent), action:{text,tone}, detail:'index.html#/a-shares', shares, cost, source:item?.priceAsOf ? `${item.priceSource || '公开行情'} · ${formatDateTime(item.priceAsOf)}` : '数据待核验' };
  }
  if (market === 'GOLD') {
    const gold = state.data?.gold || {};
    const useUSD = String(code).toUpperCase() === 'USD';
    const quote = useUSD ? gold.quotes?.international : gold.quotes?.domestic;
    const plan = useUSD ? gold.answer?.pricePlan?.internationalWatch : gold.answer?.pricePlan?.domesticWatch;
    const upper = useUSD ? gold.answer?.pricePlan?.internationalUpper : gold.answer?.pricePlan?.domesticUpper;
    const current = Number(quote?.price);
    const low = Number(plan?.high ?? plan?.low);
    const high = Number(upper?.low ?? upper?.high);
    const text = !Number.isFinite(current)
      ? '黄金价格待核验'
      : Number.isFinite(low) && current <= low
        ? `进入持有观察区：现价 ${formatNumber(current, 1)}`
        : Number.isFinite(high) && current >= high
          ? `进入卖出观察区：现价 ${formatNumber(current, 1)}`
          : `继续观察：现价 ${formatNumber(current, 1)}`;
    const tone = Number.isFinite(high) && current >= high ? 'risk' : Number.isFinite(low) && current <= low ? 'good' : 'wait';
    return { name:useUSD ? '美元金' : '人民币金', current, change:Number(quote?.changePercent), action:{text,tone}, detail:'index.html#/gold/answer', shares, cost, source:quote?.asOf ? `${quote.currency || '公开行情'} · ${formatDateTime(quote.asOf)}` : '数据待核验' };
  }
  const item = maps.hk.get(code);
  const assessment = item?.publicAnswer || {};
  return { name:item?.name || code, current:null, change:null, action:{text:assessment.action || assessment.verdict || '港股持仓行情暂未接入',tone:'wait'}, detail:'index.html#/hk', shares, cost, source:item?.source || '港交所公开资料' };
}

function getUSFocus(data) {
  const stocks = data.us?.stocks || [];
  const fundamentals = new Map((data.us?.fundamentals || []).map(item => [item.symbol, item]));
  const validated = stocks.map(item => ({...item, fundamental:fundamentals.get(item.symbol)})).filter(item => item.fundamental && Number.isFinite(Number(item.fundamental.finalScore)));
  if (!validated.length) return null;
  validated.sort((a,b) => Number(b.fundamental.finalScore) - Number(a.fundamental.finalScore));
  return validated[0];
}

function getHKFocus(data) {
  const listings = (data.hk?.listings || []).filter(item => !item.historical && item.listingStatus !== 'ended');
  if (!listings.length) return null;
  return listings.find(item => item.publicAnswer?.verdict) || listings[0];
}

function getGuruFocus(data) {
  const investors = data.investors || [];
  if (!investors.length) return null;
  return [...investors].sort((a,b) => String(b.filingDate || b.reportDate || '').localeCompare(String(a.filingDate || a.reportDate || '')))[0];
}

function sourceText(data, fallback) {
  return data.updatedAt ? `${fallback} · ${formatDateTime(data.updatedAt)}` : fallback;
}

function conclusionCard({type, title, status, tone='wait', answer, facts, href, source}) {
  return `<article class="conclusion-card">
    <div class="conclusion-top"><span class="conclusion-type">${escapeHTML(type)}</span><span class="status-chip ${tone}">${escapeHTML(status)}</span></div>
    <h3>${escapeHTML(title)}</h3>
    <p class="answer">${escapeHTML(answer)}</p>
    <ul class="fact-list">${facts.map(([key,value]) => `<li><span>${escapeHTML(key)}</span><b>${escapeHTML(value)}</b></li>`).join('')}</ul>
    <div class="conclusion-foot"><span>${escapeHTML(source)}</span><a href="${href}">深入查看 →</a></div>
  </article>`;
}

function digestTone(tone) {
  if (tone === 'good') return 'good';
  if (tone === 'bad') return 'risk';
  return 'wait';
}

function digestMarketCard(market, type, href, source) {
  const cards = state.digest?.markets?.[market] || [];
  const leadId = {
    hk: 'hk-worth',
    us: 'us-cheap',
    a: 'a-core',
    gold: 'gold-usd-hold',
    guru: 'guru-holdings',
  }[market];
  const lead = cards.find((item) => item.id === leadId) || cards.find((item) => item.enabled) || cards[0];
  if (!lead) return '';
  const facts = cards.filter((item) => item !== lead).map((item) => {
    const answer = item.answer || '—';
    const names = item.names || '';
    const nameParts = names.split(/[·、]/u).map((value) => value.trim()).filter(Boolean);
    const value = names && !nameParts.every((name) => answer.includes(name)) ? `${answer} · ${names}` : answer;
    return [item.question, value];
  });
  return conclusionCard({
    type,
    title: lead.question || type,
    status: lead.names || (lead.enabled ? '有观察结论' : '暂无'),
    tone: digestTone(lead.tone),
    answer: lead.answer || '没有满足资料完整性要求时，望潮不使用虚拟样本补位。',
    facts: facts.length ? facts : [['原则', '只展示已核验公开资料']],
    href: lead.dailyHref || href,
    source,
  });
}

function renderConclusions() {
  const box = $('#daily-conclusions');
  const data = state.data;
  if (!data) return;
  if (state.digestSyncing) {
    box.innerHTML = `<div class="digest-sync-state"><b>今日答案正在同步</b><span>公开行情已更新，但摘要版本还未对齐；暂不把旧答案和新价格混在一起。稍后刷新即可。</span></div>`;
    return;
  }
  const digestCards = ['hk','us','a','gold','guru']
    .map((market, index) => digestMarketCard(
      market,
      ['港股打新','美股投资','A股收息','黄金追踪','聪明人持仓'][index],
      ['index.html#/hk','index.html#/us','index.html#/a-shares','index.html#/gold','index.html#/gurus'][index],
      sourceText(data, ['港交所公开资料','公开行情','A股公开行情','黄金公开行情','SEC 13F / 基金季报'][index]),
    ))
    .filter(Boolean);
  if (digestCards.length) {
    box.innerHTML = digestCards.join('');
    return;
  }
  const cards = [];
  const us = getUSFocus(data);
  if (us) {
    const action = deriveUSAction(us);
    cards.push(conclusionCard({
      type:'美股投资', title:`${us.symbol} · 今日美股焦点`, status:action.text, tone:action.tone,
      answer:`当前价 ${formatNumber(us.price)} 美元，先按价格纪律判断，不因热度追高。`,
      facts:[['综合评分',formatNumber(us.fundamental.finalScore,0)],['热度分',formatNumber(us.heatScore,0)],['日涨跌',`${Number(us.changePercent)>=0?'+':''}${formatNumber(us.changePercent)}%`]],
      href:'index.html#/us', source:us.asOf ? `Yahoo Finance · ${formatDateTime(us.asOf)}` : sourceText(data,'公开行情')
    }));
  }
  const hk = getHKFocus(data);
  if (hk) {
    const assessment = hk.publicAnswer || {};
    cards.push(conclusionCard({
      type:'港股打新', title:`${hk.name || hk.code || hk.stockCode || '新股'} · 申购判断`, status:assessment.verdict || '待核验', tone:assessment.verdict?.includes('不') ? 'risk' : assessment.verdict?.includes('值得') ? 'good' : 'wait',
      answer:assessment.action || '核心招股资料已进入核验，未完成前不输出确定答案。',
      facts:[['股票代码',String(hk.code || hk.stockCode || '—')],['上市日期',String(hk.listingDate || '待公布')],['招股价',String(hk.offerPrice || hk.priceRange || '以招股章程为准')]],
      href:'index.html#/hk', source:sourceText(data,'港交所公开资料')
    }));
  } else {
    cards.push(conclusionCard({type:'港股打新',title:'当前无可验证的新股结论',status:'保持空白',tone:'wait',answer:'没有满足资料完整性要求的新股时，望潮不使用虚拟样本或静态答案补位。',facts:[['原则','只展示真实新股'],['预测','必须标注验证状态'],['结果','支持历史回溯']],href:'index.html#/hk',source:sourceText(data,'港交所公开资料')}));
  }
  const guru = getGuruFocus(data);
  if (guru) {
    const top = (guru.holdings || []).slice(0,3).map(item => item.ticker).filter(Boolean).join('、') || '查看最新13F';
    cards.push(conclusionCard({
      type:'聪明人持仓', title:`${guru.name || guru.id || '最新机构'} · 最新披露`, status:'披露事实', tone:'wait',
      answer:'只参考资金方向，不照抄买入时点；13F 存在天然滞后。',
      facts:[['报告期',String(guru.reportDate || '待确认')],['披露日',String(guru.filingDate || '待确认')],['主要敞口',top]],
      href:'index.html#/gurus', source:'SEC EDGAR 13F'
    }));
  } else {
    const a = [...(data.aShare?.quotes || [])].sort((x,y) => Number(y.score||0)-Number(x.score||0))[0];
    cards.push(conclusionCard({type:'A股收息',title:a ? `${a.name} · 收息观察` : 'A股收息数据待核验',status:a?.currentAdvice || '待核验',tone:a?.currentAdvice==='买入'?'good':'wait',answer:a?.summary || '没有完成核验的数据，不输出静态替代结论。',facts:[['当前价格',a?formatNumber(a.currentPrice):'—'],['股息率',a&&Number.isFinite(Number(a.currentDividendYield))?`${formatNumber(a.currentDividendYield)}%`:'—'],['数据来源',a?.priceSource || '公开行情']],href:'index.html#/a-shares',source:sourceText(data,'A股公开行情')}));
  }
  box.innerHTML = cards.join('');
}

function renderHoldings() {
  const box = $('#holdings-list');
  if (!state.holdings.length) {
    box.innerHTML = `<div class="holding-empty"><b>先添加一只你真正持有的股票。</b><p>首页才会从“市场有什么”变成“我的下一步是什么”。</p><button type="button" data-add-holding>添加第一只持仓</button></div>`;
    box.querySelector('[data-add-holding]')?.addEventListener('click', openDialog);
    renderReminder();
    return;
  }
  const maps = dataMaps();
  box.innerHTML = state.holdings.map((holding, index) => {
    const view = deriveHoldingView(holding, maps);
    const hasCurrent = Number.isFinite(view.current);
    const hasCost = Number.isFinite(view.cost) && view.cost > 0;
    const returnPct = hasCurrent && hasCost ? (view.current / view.cost - 1) * 100 : null;
    const pnl = returnPct !== null && view.shares > 0 ? (view.current - view.cost) * view.shares : null;
    const performanceNote = !hasCost ? '未填成本，不计算浮盈' : pnl === null ? '已算比例；填数量后再算金额' : '按本地成本与数量计算，未计费用税费';
    return `<article class="holding-card">
      <div class="holding-main">
        <div class="holding-title"><b>${escapeHTML(view.name)}</b><span>${escapeHTML(normalizeCode(holding.market,holding.code))}</span><span class="market-tag">${escapeHTML(holding.market)}</span></div>
        <div class="holding-meta"><span>成本 ${hasCost?formatNumber(view.cost):'未填写'}</span><span>现价 ${hasCurrent?formatNumber(view.current):'待接入'}</span>${view.shares?`<span>数量 ${formatNumber(view.shares)}</span>`:''}</div>
        <div class="holding-action ${view.action.tone}">${escapeHTML(view.action.text)}</div>
        <div class="holding-meta"><span>${escapeHTML(view.source)}</span></div>
      </div>
      <div class="holding-side">
        <strong>${returnPct===null?'—':`${returnPct>=0?'+':''}${formatNumber(returnPct)}%`}</strong>
        <span class="${returnPct===null?'':returnPct>=0?'up':'down'}">${pnl===null?(returnPct===null?'未计算': '比例已算，金额待数量'):`${pnl>=0?'+':''}${formatNumber(pnl)} `}</span>
        <div class="holding-performance">${performanceNote}</div>
        <div class="holding-tools"><a href="${view.detail}">完整判断</a><button type="button" data-delete-holding="${index}">删除</button></div>
      </div>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-delete-holding]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.deleteHolding);
    state.holdings.splice(index, 1); saveHoldings(); renderHoldings();
  }));
  renderReminder();
}

function renderReminder() {
  const box = $('#reminder');
  if (!state.holdings.length) {
    box.hidden = false;
    box.innerHTML = '<b>今日下一步：</b>添加至少一只真实持仓，首页才能开始给你个人化的观察提示。';
    return;
  }
  if (!state.data) { box.hidden = true; return; }
  const maps = dataMaps();
  const views = state.holdings.map(item => deriveHoldingView(item, maps));
  const triggered = views.filter(view => view.action.tone === 'good' || view.action.tone === 'risk');
  box.hidden = false;
  box.innerHTML = triggered.length
    ? `<b>今日提醒：</b>${triggered.length} 只持仓进入观察、风险或止盈区间，先查看持仓模块。`
    : '<b>今日提醒：</b>当前持仓没有触发明显区间变化，继续按计划观察。';
}

function renderChannels() {
  const data = state.data || {};
  const digest = state.digest?.home?.points || [];
  const point = (id) => digest.find((item) => item.id === id)?.value;
  const usCount = data.us?.stocks?.length || 0;
  const hkOpen = (data.hk?.listings || []).filter(item => !item.historical && item.listingStatus !== 'ended').length;
  const guruCount = data.investors?.length || 0;
  const aCount = data.aShare?.quotes?.length || 0;
  const goldPrice = data.gold?.quotes?.international?.price;
  if ($('#hk-channel-copy')) $('#hk-channel-copy').textContent = point('hk') ? `今日：${point('hk')}` : (hkOpen ? `${hkOpen} 只在途新股 · 申购到卖出闭环` : '当前无在途新股，保留历史回溯');
  if ($('#us-channel-copy')) $('#us-channel-copy').textContent = point('us') ? `今日：${point('us')}` : (usCount ? `${usCount} 只美股 · 机会、估值与价格纪律` : '美股数据待核验');
  if ($('#a-channel-copy')) $('#a-channel-copy').textContent = point('a') ? `今日：${point('a')}` : (aCount ? `${aCount} 只收息资产 · 股息与现金流` : 'A股收息数据待核验');
  if ($('#gold-channel-copy')) $('#gold-channel-copy').textContent = point('gold') ? `今日：${point('gold')}` : (Number.isFinite(Number(goldPrice)) ? `国际金 ${formatNumber(goldPrice,0)} 美元/盎司` : '黄金数据待核验');
  if ($('#guru-channel-copy')) $('#guru-channel-copy').textContent = guruCount ? `${guruCount} 位投资人 · 只对照公开持仓` : '机构披露数据待核验';
}

function openDialog() {
  const dialog = $('#holding-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
  setTimeout(() => $('#holding-code')?.focus(), 50);
}

function closeDialog() {
  const dialog = $('#holding-dialog');
  if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
}

function bindEvents() {
  $('#open-holding-form')?.addEventListener('click', openDialog);
  $('#close-holding-form')?.addEventListener('click', closeDialog);
  $('#holding-dialog')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeDialog(); });
  $('#holding-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const market = $('#holding-market').value;
    const code = normalizeCode(market, $('#holding-code').value);
    const costRaw = $('#holding-cost').value.trim();
    const cost = costRaw ? Number(costRaw) : null;
    const shares = Number($('#holding-shares').value) || 0;
    if (!code || (costRaw && (!Number.isFinite(cost) || cost <= 0))) return;
    const existing = state.holdings.findIndex(item => item.market === market && normalizeCode(market,item.code) === code);
    const payload = {market, code, cost, shares, createdAt:new Date().toISOString()};
    if (existing >= 0) state.holdings[existing] = payload; else state.holdings.unshift(payload);
    saveHoldings(); event.target.reset(); closeDialog(); renderHoldings();
  });
}

async function loadDailyDigest(updatedAt) {
  try {
    const response = await fetch('data/daily-digest.json', {cache:'no-store'});
    if (!response.ok) return null;
    const digest = await response.json();
    if (!digest?.markets?.hk) return null;
    if (updatedAt && digest.updatedAt && digest.updatedAt !== updatedAt) {
      state.digestSyncing = true;
      return null;
    }
    state.digestSyncing = false;
    return digest;
  } catch {
    return null;
  }
}

async function loadData() {
  const response = await fetch('data/live-snapshot.json', {cache:'no-store'});
  if (!response.ok) throw new Error(`数据服务 ${response.status}`);
  const data = await response.json();
  if (!data || !data.updatedAt) throw new Error('数据快照缺少更新时间');
  state.data = data;
  state.digest = await loadDailyDigest(data.updatedAt);
  $('#updated-at').textContent = `更新 ${formatDateTime(data.updatedAt)}`;
  renderConclusions(); renderHoldings(); renderChannels();
}

function renderSession() {
  const session = localSession();
  $('#session-badge').textContent = session.label;
  $('#session-copy').textContent = session.copy;
}

async function init() {
  renderSession(); bindEvents(); renderHoldings();
  try { await loadData(); }
  catch (error) {
    $('#updated-at').textContent = '数据暂不可用';
    $('#daily-conclusions').innerHTML = conclusionCard({type:'数据状态',title:'当前无法读取最新数据',status:'不输出替代答案',tone:'risk',answer:'望潮不会用静态价格或虚拟样本补位，请稍后刷新。',facts:[['错误',error.message],['原则','数据必须有日期和来源'],['持仓','本地记录仍可查看']],href:'index.html',source:'数据服务'});
    renderChannels(); renderReminder();
  }
}

document.addEventListener('DOMContentLoaded', init);
