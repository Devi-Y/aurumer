'use strict';

const STORAGE_KEY = 'aurumHoldingsV1';
const state = { data: null, digest: null, digestSyncing: false, holdings: loadHoldings() };
const $ = (selector) => document.querySelector(selector);

function escapeHTML(value='') {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function localSession() {
  return {key:'history',label:'历史资料参考',copy:'逐项确认记录日期，再对照历史价格、公开资料与风险。'};
}

function formatDateTime(value) {
  if (!value) return '数据日期待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '数据日期待确认';
  return new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}

function renderFreshness(data) {
  const box = $('#freshness-state');
  if (!box) return;
  const valid = Number.isFinite(Date.parse(data?.updatedAt || ''));
  const partial = data?.status === 'partial';
  box.className = `freshness-state ${!valid || partial ? 'stale' : 'fresh'}`;
  box.textContent = !valid ? '资料整理时间待核验' : partial ? '部分来源失败 · 数据日期见各项' : '历史参考 · 数据日期见各项';
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
  return {text:`历史记录 · 数据日期 ${formatDateTime(item?.asOf)}`,tone:'wait'};
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
        ? `进入加大观察区：记录价 ${formatNumber(current)}，加大观察 ${formatNumber(plan.addPrice)}`
        : plan?.zone === 'trim'
          ? `进入兑现观察区：记录价 ${formatNumber(current)}，兑现观察 ${formatNumber(plan.trimPrice)}`
          : plan
            ? `继续观察：记录价 ${formatNumber(current)}，加大观察 ${formatNumber(plan.addPrice)}`
            : (item.summary || item.actionPriceNote || '收息观察价待公告核验');
    const tone = !item ? 'wait' : plan?.zone === 'add' ? 'good' : plan?.zone === 'trim' ? 'risk' : 'wait';
    return { name:item?.name || code, current, change:Number(item?.changePercent), action:{text:'历史价格与分红对照',tone:'wait'}, detail:'index.html#/a-shares', shares, cost, source:item?.priceAsOf ? `${item.priceSource || '公开行情'} · ${formatDateTime(item.priceAsOf)}` : '数据待核验' };
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
        ? `进入持有观察区：记录价 ${formatNumber(current, 1)}`
        : Number.isFinite(high) && current >= high
          ? `进入卖出观察区：记录价 ${formatNumber(current, 1)}`
          : `继续观察：记录价 ${formatNumber(current, 1)}`;
    const tone = Number.isFinite(high) && current >= high ? 'risk' : Number.isFinite(low) && current <= low ? 'good' : 'wait';
    return { name:useUSD ? '美元金' : '人民币金', current, change:Number(quote?.changePercent), action:{text:'历史价格与分红对照',tone:'wait'}, detail:'index.html#/gold', shares, cost, source:quote?.asOf ? `${quote.currency || '公开行情'} · ${formatDateTime(quote.asOf)}` : '数据待核验' };
  }
  const item = maps.hk.get(code);
  const assessment = item?.publicAnswer || {};
  return { name:item?.name || code, current:null, change:null, action:{text:'招股与历史资料参考',tone:'wait'}, detail:'index.html#/hk', shares, cost, source:item?.source || '港交所公开资料' };
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
  return data.updatedAt ? `${fallback} · 资料整理 ${formatDateTime(data.updatedAt)}，各项日期另列` : fallback;
}

function conclusionCard({type, title, status, tone='wait', answer, facts=[], nextStep='', href, source}) {
  const factMarkup = facts.length
    ? `<ul class="fact-list">${facts.map(([key,value]) => `<li><span>${escapeHTML(key)}</span><b>${escapeHTML(value)}</b></li>`).join('')}</ul>`
    : '';
  const nextMarkup = nextStep
    ? `<p class="strategy-next"><span>下一步</span>${escapeHTML(nextStep)}</p>`
    : '';
  return `<article class="conclusion-card">
    <div class="conclusion-top"><span class="conclusion-type">${escapeHTML(type)}</span><span class="status-chip ${tone}">${escapeHTML(status)}</span></div>
    <h3>${escapeHTML(title)}</h3>
    <p class="answer">${escapeHTML(answer)}</p>
    ${factMarkup}${nextMarkup}
    <div class="conclusion-foot"><span>${escapeHTML(source)}</span><a href="${href}">深入查看 →</a></div>
  </article>`;
}

function digestTone(tone) {
  if (tone === 'good') return 'good';
  if (tone === 'bad') return 'risk';
  return 'wait';
}

const DAILY_FACT_IDS = {
  hk: ['hk-new', 'hk-avoid'],
  us: ['us-cheap', 'us-risk'],
  a: ['a-core', 'a-cycle', 'a-add', 'a-trim'],
  // gold-usd-hold/gold-usd-sell/gold-cny-hold/gold-cny-sell 四张卡在同一次改版里被
  // 按问题重拆为下面四张——旧 id 消失后 evidence 常年为空，黄金结论卡静默不渲染，
  // 这里改认现在的四张卡（下面 gold 分支里读卡片的逻辑也一并改掉了）。
  gold: ['gold-price', 'gold-buy', 'gold-sell', 'gold-turn'],
  // guru-why/guru-learn/guru-avoid 三张卡在 f6d9ce3→2bbaa38 的改版里被拆分合并进
  // guru-add/guru-cut/guru-trend——旧 id 全部消失后这里一直匹配不到任何卡，
  // evidence 常年为空，机构结论卡在每日驾驶舱静默不渲染，这里改认现在的四张卡。
  guru: ['guru-holdings', 'guru-add', 'guru-cut', 'guru-trend'],
};

function digestItem(cards, id) {
  return cards.find((item) => item.id === id) || null;
}

function digestValue(cards, id, includeNames=false) {
  const item = digestItem(cards, id);
  if (!item) return '待核验';
  const answer = item.answer || '待核验';
  if (!includeNames || !item.names) return answer;
  const names = item.names.split(/[·、]/u).map((value) => value.trim()).filter(Boolean);
  return names.every((name) => answer.includes(name)) ? answer : `${answer} · ${item.names}`;
}

function compactPriceSignal(value) {
  return String(value || '待核验')
    .replace(/现价[¥$]?[\d.,]+[，,]\s*/gu, '')
    .split(' · ')[0]
    .trim();
}

function recordedNumber(value) {
  return value === null || value === undefined || value === '' ? '未收录' : formatNumber(value);
}

function dailyStrategyCard(market, type, href, source) {
  const data=state.data||{};
  let title=type, answer='对照已收录的公开资料和记录日期。', facts=[];
  if(market==='us'){
    const item=getUSFocus(data);
    if(!item)return '';
    title=`${item.symbol} · 历史价格`;
    facts=[['记录价',`${recordedNumber(item.price)} 美元`],['记录日涨跌',`${recordedNumber(item.changePercent)}%`],['数据日期',formatDateTime(item.asOf)]];
  }else if(market==='hk'){
    const rows=data.hk?.listings||[];
    if(!rows.length)return '';
    title='招股与上市资料';
    answer='查看已收录招股条件与已发生的历史表现，实际招股期以官方文件为准。';
    facts=[['已收录',`${rows.length} 只`],['上市记录',`${rows.filter(item=>item.historical||item.listingStatus==='ended').length} 只`],['日期', '招股及上市日期分别列示']];
  }else if(market==='a'){
    const item=(data.aShare?.quotes||[])[0];
    if(!item)return '';
    title=`${item.name} · 分红与历史价格`;
    facts=[['记录价',`${recordedNumber(item.currentPrice)} 元`],['记录股息率',`${recordedNumber(item.currentDividendYield)}%`],['数据日期',formatDateTime(item.priceAsOf)]];
  }else if(market==='gold'){
    const intl=data.gold?.quotes?.international,domestic=data.gold?.quotes?.domestic;
    if(!intl&&!domestic)return '';
    title='国际金与上海金历史记录';
    facts=[['国际金',intl?`${recordedNumber(intl.price)} 美元/盎司 · ${formatDateTime(intl.asOf)}`:'未收录'],['上海金',domestic?`${recordedNumber(domestic.price)} 元/克 · ${formatDateTime(domestic.asOf)}`:'未收录']];
  }else{
    const item=getGuruFocus(data);
    if(!item)return '';
    title=`${item.name||item.id} · 公开披露`;
    answer='持仓来自报告时点，不能代表即时仓位或交易信号。';
    facts=[['报告期',item.reportDate||'待确认'],['披露日',item.filingDate||'待确认']];
  }
  return conclusionCard({type,title,status:'历史参考',tone:'wait',answer,facts,href,source});
}

function renderConclusions() {
  const box = $('#daily-conclusions');
  const data = state.data;
  if (!data) return;
  if (state.digestSyncing) {
    box.innerHTML = `<div class="digest-sync-state"><b>历史摘要版本待对齐</b><span>资料与摘要版本尚未对齐，暂不混用两个批次。稍后刷新即可。</span></div>`;
    return;
  }
  const digestCards = ['hk','us','a','gold','guru']
    .map((market, index) => dailyStrategyCard(
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
      type:'美股投资', title:`${us.symbol} · 历史美股资料`, status:action.text, tone:action.tone,
      answer:`记录价 ${formatNumber(us.price)} 美元，先按价格纪律判断，不因热度追高。`,
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
    cards.push(conclusionCard({type:'A股收息',title:a ? `${a.name} · 收息观察` : 'A股收息数据待核验',status:a?.currentAdvice || '待核验',tone:a?.currentAdvice==='买入'?'good':'wait',answer:a?.summary || '没有完成核验的数据，不输出静态替代结论。',facts:[['历史记录价',a?formatNumber(a.currentPrice):'—'],['股息率',a&&Number.isFinite(Number(a.currentDividendYield))?`${formatNumber(a.currentDividendYield)}%`:'—'],['数据来源',a?.priceSource || '公开行情']],href:'index.html#/a-shares',source:sourceText(data,'A股公开行情')}));
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
    const performanceNote = !hasCost ? '未填成本，不计算历史价差' : pnl === null ? '已算比例；填数量后再算金额' : '按本地成本与数量计算，未计费用税费';
    return `<article class="holding-card">
      <div class="holding-main">
        <div class="holding-title"><b>${escapeHTML(view.name)}</b><span>${escapeHTML(normalizeCode(holding.market,holding.code))}</span><span class="market-tag">${escapeHTML(holding.market)}</span></div>
        <div class="holding-meta"><span>成本 ${hasCost?formatNumber(view.cost):'未填写'}</span><span>记录价 ${hasCurrent?formatNumber(view.current):'待接入'}</span>${view.shares?`<span>数量 ${formatNumber(view.shares)}</span>`:''}</div>
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
  if (!box) return;
  if (!state.holdings.length) {
    box.hidden = false;
    box.innerHTML = '<b>复盘提示：</b>添加至少一只真实持仓，首页才能开始给你个人化的观察提示。';
    return;
  }
  if (!state.data) { box.hidden = true; return; }
  const maps = dataMaps();
  const views = state.holdings.map(item => deriveHoldingView(item, maps));
  const triggered = views.filter(view => view.action.tone === 'good' || view.action.tone === 'risk');
  box.hidden = false;
  box.innerHTML = triggered.length
    ? `<b>历史对照：</b>${triggered.length} 只持仓已有历史记录，可核对各项数据日期。`
    : '<b>历史对照：</b>当前持仓按已收录价格作历史对照。';
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
  if ($('#hk-channel-copy')) $('#hk-channel-copy').textContent = point('hk') ? `历史摘要：${point('hk')}` : (hkOpen ? `${hkOpen} 只在途新股 · 招股资料与历史表现` : '当前无在途新股，保留历史回溯');
  if ($('#us-channel-copy')) $('#us-channel-copy').textContent = point('us') ? `历史摘要：${point('us')}` : (usCount ? `${usCount} 只美股 · 机会、估值与价格纪律` : '美股数据待核验');
  if ($('#a-channel-copy')) $('#a-channel-copy').textContent = point('a') ? `历史摘要：${point('a')}` : (aCount ? `${aCount} 只收息资产 · 股息与现金流` : 'A股收息数据待核验');
  if ($('#gold-channel-copy')) $('#gold-channel-copy').textContent = point('gold') ? `历史摘要：${point('gold')}` : (Number.isFinite(Number(goldPrice)) ? `国际金 ${formatNumber(goldPrice,0)} 美元/盎司` : '黄金数据待核验');
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
    const response = await fetch(`data/daily-digest.json?t=${Date.now()}`, {cache:'no-store'});
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
  const response = await fetch(`data/live-snapshot.json?t=${Date.now()}`, {cache:'no-store'});
  if (!response.ok) throw new Error(`数据服务 ${response.status}`);
  const data = await response.json();
  if (!data || !data.updatedAt) throw new Error('数据快照缺少更新时间');
  state.data = data;
  state.digest = await loadDailyDigest(data.updatedAt);
  $('#updated-at').textContent = `资料整理 ${formatDateTime(data.updatedAt)}`;
  renderFreshness(data);
  renderConclusions(); renderHoldings(); renderChannels();
}

let refreshTimer;
function scheduleDataRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible') {
      try {
        await loadData();
      } catch {
        const box = $('#freshness-state');
        if (box) {
          box.className = 'freshness-state stale';
          box.textContent = '自动刷新失败 · 保留上次数据';
        }
      }
    }
    scheduleDataRefresh();
  }, 24 * 60 * 60 * 1000);
}

function renderSession() {
  const session = localSession();
  if ($('#session-badge')) $('#session-badge').textContent = session.label;
  if ($('#session-copy')) $('#session-copy').textContent = session.copy;
}

async function init() {
  renderSession(); bindEvents(); renderHoldings();
  try { await loadData(); scheduleDataRefresh(); }
  catch (error) {
    $('#updated-at').textContent = '历史资料暂不可用';
    const freshness = $('#freshness-state');
    if (freshness) {
      freshness.className = 'freshness-state stale';
      freshness.textContent = '历史资料暂不可用';
    }
    $('#daily-conclusions').innerHTML = conclusionCard({type:'数据状态',title:'当前无法读取历史资料',status:'不输出替代答案',tone:'risk',answer:'望潮不会用静态价格或虚拟样本补位，请稍后刷新。',facts:[['错误',error.message],['原则','数据必须有日期和来源'],['持仓','本地记录仍可查看']],href:'index.html',source:'数据服务'});
    renderChannels(); renderReminder();
    scheduleDataRefresh();
  }
}

document.addEventListener('DOMContentLoaded', init);
