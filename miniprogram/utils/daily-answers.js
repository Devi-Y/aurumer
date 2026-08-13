/**
 * 栏目页「今日答案」：一屏回答用户真正会问的问题。
 * 口径是研究观察，不是买卖指令；没有已验证数据时如实说暂无。
 */
const { allItems, shortCompanyName } = require("./answers");
const { MASTER_PLAYBOOKS } = require("./master-playbooks");
const { buildHkExitBands, formatExitBand, mapOfferBand } = require("./hk-exit-plan");
const {
  hkLeverageEligible,
  hkHistoricalCrowdEligible,
  yieldImpliedPlan,
  goldZoneForPrice,
  usSleevePlan,
  matchesGroup,
  parseOfferPrice,
  hasNumber,
} = require("./market-lenses");

function yuan(value) {
  return hasNumber(value) ? `¥${Number(value).toFixed(2)}` : "暂缺";
}

function usd(value) {
  return hasNumber(value) ? `$${Number(value).toFixed(2)}` : "";
}

function sleevePrice(snapshot, symbol) {
  const row = (snapshot?.us?.sleeveQuotes || []).find((item) => item.symbol === symbol);
  return usd(row?.price);
}

function impliedPrice(offer, change) {
  if (!hasNumber(offer) || !hasNumber(change)) return null;
  return Math.round(Number(offer) * (1 + Number(change) / 100));
}

function signedPct(value) {
  if (!hasNumber(value)) return null;
  const amount = Number(value);
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(1)}%`;
}

function matchHolding(holdings, item, market) {
  const id = String(item?.id || "").replace(/\.(SH|SZ|HK)$/i, "").replace(/^0+/, "").toUpperCase();
  const code = String(item?.code || "").replace(/\.(SH|SZ|HK)$/i, "").replace(/^0+/, "").toUpperCase();
  return (holdings || []).find((row) => {
    const rowMarket = String(row.market || "").toLowerCase();
    if (rowMarket && rowMarket !== market) return false;
    const holdingCode = String(row.code || "").replace(/\.(SH|SZ|HK)$/i, "").replace(/^0+/, "").toUpperCase();
    return holdingCode && (holdingCode === id || holdingCode === code);
  }) || null;
}

function holdingPnLText(holding, price) {
  const cost = Number(holding?.cost);
  if (!hasNumber(cost) || cost <= 0 || !hasNumber(price)) return "";
  const delta = (Number(price) / cost - 1) * 100;
  return `，相对成本${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`;
}

function namesOf(items, max = 3) {
  const names = (items || [])
    .map((item) => shortCompanyName(item.name, item.code || "标的", 6))
    .filter(Boolean);
  if (!names.length) return "";
  return names.slice(0, max).join("、") + (names.length > max ? ` 等${names.length}只` : "");
}

function card({
  id,
  question,
  answer,
  names = "",
  tone = "warn",
  action = "none",
  group = "",
  targetId = "",
  enabled = false,
  hint = "",
  modal = "",
}) {
  return {
    id,
    question,
    answer,
    names,
    tone,
    action,
    group,
    targetId,
    enabled: Boolean(enabled && (action !== "none" || modal)),
    hint,
    modal,
  };
}

function buildHkAnswers(snapshot) {
  const items = allItems(snapshot, "hk");
  const live = items.filter((item) => item.group !== "ended");
  const active = live.filter((item) => item.group !== "cancelled");
  const worth = items.filter((item) => item.group === "worth");
  const avoid = items.filter((item) => item.group === "avoid" || item.group === "cancelled");
  const leverage = items.filter(hkLeverageEligible);
  const histLev = items.filter(hkHistoricalCrowdEligible);
  const bands = buildHkExitBands(snapshot);
  const lead = worth[0] || active[0];
  const offer = parseOfferPrice(lead?.raw?.offerPrice || lead?.raw?.priceHigh || lead?.raw?.priceLow);
  const liveLead = lead && lead.group !== "ended" && lead.group !== "cancelled";

  const exitCard = (id, question, band, endedKey) => {
    const ended = items
      .filter((item) => item.group === "ended" && Number.isFinite(Number(item.raw?.historicalReview?.[endedKey])))
      .slice()
      .sort((left, right) => String(right.raw?.listingDate || "").localeCompare(String(left.raw?.listingDate || "")));
    if (liveLead && offer && band?.n) {
      const mapped = mapOfferBand(offer, band);
      return card({
        id,
        question,
        answer: mapped
          ? `历史分位对照 ${formatExitBand(band)}，约 ${mapped}`
          : formatExitBand(band),
        names: shortCompanyName(lead.name, "新股", 6),
        tone: "warn",
        action: "detail",
        targetId: lead.id,
        enabled: true,
        hint: "按历史分位映射到招股价，不是本股保证卖出价。",
      });
    }
    const sample = ended[0];
    const change = sample ? Number(sample.raw.historicalReview[endedKey]) : null;
    const sampleOffer = parseOfferPrice(sample?.raw?.offerPrice);
    const implied = impliedPrice(sampleOffer, change);
    const lastLine = sample && signedPct(change)
      ? `最近${shortCompanyName(sample.name, "新股", 4)}已披露 ${signedPct(change)}${implied != null ? `，对照约 ${implied}` : ""}`
      : "";
    if (lastLine && band?.n) {
      return card({
        id,
        question,
        answer: `${lastLine}；下一只先看历史分位 ${formatExitBand(band)}`,
        names: namesOf(ended.slice(0, 3)),
        tone: "warn",
        action: "group",
        group: "ended",
        targetId: sample.id,
        enabled: true,
        hint: "已披露结果只复盘最近一只；分位不是下一只保证卖出价。",
      });
    }
    if (band?.n) {
      return card({
        id,
        question,
        answer: `历史分位 ${formatExitBand(band)}，不是下一只的保证卖出价`,
        names: namesOf(ended),
        tone: "warn",
        action: "group",
        group: "ended",
        enabled: true,
        hint: "没有在售新股招股价时，只展示历史分位。",
      });
    }
    if (lastLine) {
      return card({
        id,
        question,
        answer: lastLine,
        names: namesOf(ended),
        tone: "muted",
        action: "group",
        group: "ended",
        enabled: true,
        hint: "已结束样本的已披露结果，不预测下一只。",
      });
    }
    return card({
      id,
      question,
      answer: "样本不足，暂不给出观察价",
      tone: "muted",
    });
  };

  return [
    card({
      id: "hk-new",
      question: "近期上新",
      answer: active.length
        ? `${active.length} 只在售`
        : (live.length ? `${live.length} 只已取消或无法申购` : "当前没有可申购新股"),
      names: namesOf(live.length ? live : items.filter((item) => item.group === "ended").slice(0, 3)),
      tone: active.length ? "good" : "muted",
      action: active.length ? "group" : (live.length ? "group" : "group"),
      group: active.length ? (worth.length ? "worth" : active[0].group) : (live.length ? live[0].group : "ended"),
      enabled: live.length + items.filter((item) => item.group === "ended").length > 0,
    }),
    card({
      id: "hk-worth",
      question: "哪些值得打",
      answer: worth.length ? `建议申购 ${worth.length} 只` : "暂无建议申购",
      names: namesOf(worth),
      tone: worth.length ? "good" : "warn",
      action: "group",
      group: "worth",
      targetId: worth[0]?.id || "",
      enabled: worth.length > 0,
    }),
    card({
      id: "hk-avoid",
      question: "哪些要避雷",
      answer: avoid.length ? `暂不建议/已取消 ${avoid.length} 只` : "当前没有明确避雷样本",
      names: namesOf(avoid),
      tone: avoid.length ? "bad" : "muted",
      action: "group",
      group: avoid.some((item) => item.group === "avoid") ? "avoid" : "cancelled",
      targetId: avoid[0]?.id || "",
      enabled: avoid.length > 0,
    }),
    card({
      id: "hk-leverage",
      question: "十倍融资观察",
      answer: leverage.length
        ? `高杠杆观察 ${leverage.length} 只，仍须能承受一手亏损`
        : (histLev.length
          ? `今天没有建议申购。历史拥挤度对照 ${histLev.length} 只，不能追认当时该打`
          : `今天没有建议申购；近${items.filter((item) => item.group === "ended").length}只历史样本也都不满足拥挤度门槛`),
      names: namesOf(leverage.length ? leverage : histLev),
      tone: leverage.length ? "warn" : "muted",
      action: leverage.length ? "group" : (histLev.length ? "group" : "none"),
      group: leverage.length ? "leverage" : "ended",
      targetId: (leverage[0] || histLev[0])?.id || "",
      enabled: true,
      hint: "只在建议申购且拥挤度不高时出现；默认仍是一手，不是加杠杆指令。",
      modal: leverage.length
        ? "达到门槛仍须能承受一手亏损；默认一手，融资会放大破发。不是加杠杆指令。"
        : [
          "门槛：建议申购、研究分≥80、招股价与一手金额齐全、超购倍数<200。默认仍是一手。",
          histLev.length
            ? `历史拥挤度对照：${histLev.map((item) => `${shortCompanyName(item.name, "新股", 4)} 超购 ${Number(item.raw?.publicOversubscription).toFixed(1)} 倍`).join("、")}。当时没有望潮研究分，不能追认建议申购或十倍融资。`
            : `近${items.filter((item) => item.group === "ended").length}只历史样本超购倍数普遍≥200或一手中签过低，按规则不会标十倍融资。`,
          "没有在售建议申购时不补虚拟新股。",
        ].join("\n"),
    }),
    exitCard("hk-grey", "打中后暗盘", bands.grey, "greyMarketChange"),
    exitCard("hk-first", "打中后首日", bands.firstDay, "firstDayChange"),
    exitCard("hk-week", "打中后首周", bands.fiveDay, "fiveDayChange"),
  ];
}

function buildUsAnswers(snapshot) {
  const items = allItems(snapshot, "us");
  const seven = items.filter((item) => item.group === "seven");
  const byCode = new Map();
  for (const item of items) {
    const code = String(item.code || item.id || "").toUpperCase();
    if (!code || !byCode.has(code) || item.group === "industry") byCode.set(code, item);
  }
  // 截图要求的每日重点不是把所有模型分档都塞进首屏，而是固定回答两只低估、特斯拉风险和两只行业对照；
  // 是否进入这些重点仍由七姐妹质量/估值分档与公开价格决定，未通过时保持空白。
  const cheap = seven.filter((item) => ["GOOGL", "META"].includes(item.code) && matchesGroup(item, "cheap7"));
  const risk = seven.filter((item) => item.code === "TSLA" && matchesGroup(item, "risk7"));
  const hold = seven.filter((item) => matchesGroup(item, "hold7"));
  const industry = ["MA", "UBER"].map((code) => byCode.get(code)).filter(Boolean);
  const extraPool = [];
  const seen = new Set(seven.map((item) => item.code));
  for (const item of items) {
    const code = item.code || item.id;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    extraPool.push(item);
  }
  const sleeve = usSleevePlan(seven, industry, extraPool);
  const cycleBits = (sleeve.picks || []).map((item) => {
    const price = usd(item.raw?.price);
    return `${shortCompanyName(item.name, item.code || "周期", 4)}${price ? ` ${price}` : ""}`;
  }).filter(Boolean);
  const pickNames = cycleBits.join("、") || namesOf(sleeve.picks, 2);
  const quoteLine = (item) => {
    if (!item) return "";
    const price = usd(item.raw?.price);
    const score = item.score != null ? ` ${item.score}分` : "";
    return `${shortCompanyName(item.name, item.code || "标的", 6)}${price ? ` ${price}` : ""}${score}`;
  };
  const incomeSymbol = sleeve.income;
  const sleeveLine = [
    `VOO ${sleeve.weights.VOO}%${sleevePrice(snapshot, "VOO") ? ` ${sleevePrice(snapshot, "VOO")}` : ""}`,
    `${incomeSymbol} ${sleeve.weights.income}%${sleevePrice(snapshot, incomeSymbol) ? ` ${sleevePrice(snapshot, incomeSymbol)}` : ""}`,
    `O ${sleeve.weights.O}%${sleevePrice(snapshot, "O") ? ` ${sleevePrice(snapshot, "O")}` : ""}`,
    `SGOV ${sleeve.weights.SGOV}%${sleevePrice(snapshot, "SGOV") ? ` ${sleevePrice(snapshot, "SGOV")}` : ""}`,
    pickNames ? `周期 ${sleeve.weights.cycle}% ${pickNames}` : `周期 ${sleeve.weights.cycle}% 样本不足`,
  ].join(" + ");
  const missing = ["VOO", incomeSymbol, "O", "SGOV"].filter((symbol) => !sleevePrice(snapshot, symbol));
  const modal = [
    sleeve.summary,
    sleeveLine,
    `收息套：${incomeSymbol}（JEPQ=纳指备兑，SCHD=红利价值，二者取一）`,
    pickNames ? `周期观察：${pickNames}` : "周期观察：当前样本不足，先留在 SGOV",
    missing.length ? `${missing.join("/")} 暂无已核验报价，不补虚拟价格。` : "ETF 报价来自 Yahoo Finance 公开行情，只作配置对照。",
    "研究观察，不是买卖指令。",
  ].join("\n");

  return [
    card({
      id: "us-cheap",
      question: "低估的七姐妹",
      answer: cheap.length ? cheap.map(quoteLine).join(" · ") : "谷歌-A、Meta 暂未同时满足质量与估值门槛",
      names: namesOf(cheap),
      tone: cheap.length ? "good" : "warn",
      action: "group",
      group: "cheap7",
      targetId: cheap[0]?.id || "",
      enabled: cheap.length > 0,
      hint: "每日重点固定看谷歌-A、Meta；相对不贵不是买入指令。",
    }),
    card({
      id: "us-risk",
      question: "风险升高要减",
      answer: risk.length ? risk.map(quoteLine).join(" · ") : "特斯拉暂未触发重大风险分档",
      names: namesOf(risk),
      tone: risk.length ? "bad" : "muted",
      action: "group",
      group: "risk7",
      targetId: risk[0]?.id || "",
      enabled: risk.length > 0,
      hint: "每日风险重点固定看特斯拉；其它七姐妹风险仍在详情中保留。",
    }),
    card({
      id: "us-hold",
      question: "可长期观察",
      answer: hold.length ? `${hold.length} 只质量门通过` : "质量门未通过，先不谈长期",
      names: namesOf(hold),
      tone: hold.length ? "good" : "warn",
      action: "group",
      group: "hold7",
      targetId: hold[0]?.id || "",
      enabled: hold.length > 0,
    }),
    card({
      id: "us-industry",
      question: "行业公司观察",
      answer: industry.length
        ? industry.slice(0, 3).map((item) => {
          const price = usd(item.raw?.price);
          return `${shortCompanyName(item.name, item.code, 4)}${price ? ` ${price}` : ""}${item.score != null ? ` ${item.score}分` : ""}`;
        }).join(" · ")
        : "没有同时满足质量与分数的行业样本",
      names: namesOf(industry),
      tone: industry.length ? "good" : "muted",
      action: "group",
      group: "industry",
      targetId: industry[0]?.id || "",
      enabled: industry.length > 0,
      hint: "行业对照固定看万事达、优步；价格与分数只用于研究比较，不是买入指令。",
    }),
    card({
      id: "us-sleeve",
      question: "底仓如何配置",
      answer: sleeveLine,
      names: pickNames ? `${incomeSymbol} · ${pickNames}` : incomeSymbol,
      tone: sleeve.defensive ? "warn" : "good",
      action: "none",
      targetId: sleeve.picks[0]?.id || "",
      enabled: true,
      modal,
    }),
  ];
}

function buildAShareAnswers(snapshot, holdings = []) {
  const items = allItems(snapshot, "a");
  const core = items.filter((item) => matchesGroup(item, "core"));
  const cycle = items.filter((item) => matchesGroup(item, "cycle"));
  const withPlan = core
    .filter((item) => item.raw?.assetType !== "fund")
    .map((item) => ({
      item,
      plan: yieldImpliedPlan(item.raw),
      holding: matchHolding(holdings, item, "a"),
    }))
    .filter((entry) => entry.plan);
  const addNow = withPlan.filter((entry) => entry.plan.zone === "add");
  const trimNow = withPlan.filter((entry) => entry.plan.zone === "trim");
  const planLine = (entry, kind) => {
    const name = shortCompanyName(entry.item.name, "收息", 4);
    const now = yuan(entry.plan.price);
    const target = kind === "add" ? yuan(entry.plan.addPrice) : yuan(entry.plan.trimPrice);
    const label = kind === "add" ? "加大观察" : "兑现观察";
    return `${name} 现价${now}，${label}${target}${holdingPnLText(entry.holding, entry.plan.price)}`;
  };
  const heldTrim = withPlan.filter((entry) => {
    const cost = Number(entry.holding?.cost);
    if (!hasNumber(cost) || cost <= 0) return false;
    const pnl = (entry.plan.price / cost - 1) * 100;
    return pnl >= 12 || entry.plan.zone === "trim";
  });

  return [
    card({
      id: "a-core",
      question: "底仓长期持有",
      answer: core.length ? `现金流较稳 ${core.length} 只` : "当前样本没有底仓角色",
      names: namesOf(core),
      tone: core.length ? "good" : "warn",
      action: "group",
      group: "core",
      targetId: core[0]?.id || "",
      enabled: core.length > 0,
    }),
    card({
      id: "a-cycle",
      question: "周期短持",
      answer: cycle.length ? `商品/产能周期 ${cycle.length} 只` : "当前样本没有周期短持角色",
      names: namesOf(cycle),
      tone: cycle.length ? "warn" : "muted",
      action: "group",
      group: "cycle",
      targetId: cycle[0]?.id || "",
      enabled: cycle.length > 0,
    }),
    card({
      id: "a-add",
      question: "什么价可加大",
      answer: addNow.length
        ? `已到加大。${addNow.slice(0, 2).map((entry) => planLine(entry, "add")).join(" · ")}`
        : (withPlan.length
          ? `未到加大区。${withPlan.slice(0, 2).map((entry) => planLine(entry, "add")).join(" · ")}`
          : "缺少股息与现价，暂不推观察价"),
      names: namesOf((addNow.length ? addNow : withPlan.slice(0, 3)).map((entry) => entry.item)),
      tone: addNow.length ? "good" : "warn",
      action: "group",
      group: addNow.length ? "add" : "core",
      targetId: (addNow[0]?.item || core[0])?.id || "",
      enabled: core.length > 0,
      hint: "按当前每股分红回推到更高股息率，不是保证买点。",
    }),
    card({
      id: "a-trim",
      question: "什么价可兑现",
      answer: heldTrim.length
        ? heldTrim.slice(0, 2).map((entry) => planLine(entry, "trim")).join(" · ")
        : (trimNow.length
          ? trimNow.slice(0, 2).map((entry) => planLine(entry, "trim")).join(" · ")
          : (withPlan.length
            ? `未到兑现区。${withPlan.slice(0, 2).map((entry) => planLine(entry, "trim")).join(" · ")}`
            : "缺少股息与现价，暂不推观察价")),
      names: namesOf(((heldTrim.length ? heldTrim : trimNow).length ? (heldTrim.length ? heldTrim : trimNow) : withPlan.slice(0, 3)).map((entry) => entry.item)),
      tone: (heldTrim.length || trimNow.length) ? "warn" : "muted",
      action: "group",
      group: trimNow.length ? "trim" : "core",
      targetId: (heldTrim[0]?.item || trimNow[0]?.item || core[0])?.id || "",
      enabled: core.length > 0,
      hint: heldTrim.length
        ? "本地持仓相对成本已抬升或进入兑现观察，不是自动卖出指令。"
        : "股息被价格压缩后进入兑现观察，不是自动卖出指令。无本地成本时无法计算盈利了结。",
    }),
  ];
}

function formatGoldRange(range, digits) {
  if (!range) return "";
  const low = Number(range.low);
  const high = Number(range.high);
  if (!Number.isFinite(low) && !Number.isFinite(high)) return "";
  if (Number.isFinite(low) && Number.isFinite(high) && low !== high) {
    return `${low.toFixed(digits)}–${high.toFixed(digits)}`;
  }
  const value = Number.isFinite(low) ? low : high;
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function goldNextLine(priceText, holdRange, sellRange, zone, digits, kind) {
  const holdHigh = Number(holdRange?.high ?? holdRange?.low);
  const sellLow = Number(sellRange?.low ?? sellRange?.high);
  if (kind === "hold") {
    if (zone?.hold) return `现价 ${priceText}，仍在持有观察区（${formatGoldRange(holdRange, digits)}）`;
    if (Number.isFinite(holdHigh)) return `现价 ${priceText}，未到持有观察区（≤${holdHigh.toFixed(digits)}）`;
  }
  if (kind === "sell") {
    if (zone?.sell) return `现价 ${priceText}，进入卖出观察区（${formatGoldRange(sellRange, digits)}）`;
    if (Number.isFinite(sellLow)) return `现价 ${priceText}，未到卖出观察区（≥${sellLow.toFixed(digits)}）`;
  }
  return `现价 ${priceText} · ${zone?.label || "继续观察"}`;
}

function buildGoldAnswers(snapshot) {
  const gold = snapshot.gold || {};
  const answer = gold.answer || {};
  const plan = answer.pricePlan || {};
  const intl = gold.quotes?.international || {};
  const domestic = gold.quotes?.domestic || {};
  const intlZone = goldZoneForPrice(intl.price, plan.internationalWatch, plan.internationalUpper, plan.internationalRisk);
  const cnyZone = goldZoneForPrice(domestic.price, plan.domesticWatch, plan.domesticUpper, plan.domesticRisk);
  const holdIntl = formatGoldRange(plan.internationalWatch, 0);
  const sellIntl = formatGoldRange(plan.internationalUpper, 0);
  const holdCny = formatGoldRange(plan.domesticWatch, 1);
  const sellCny = formatGoldRange(plan.domesticUpper, 1);
  const intlPrice = Number.isFinite(Number(intl.price)) ? Number(intl.price).toFixed(0) : "暂缺";
  const cnyPrice = Number.isFinite(Number(domestic.price)) ? Number(domestic.price).toFixed(1) : "暂缺";

  return [
    card({
      id: "gold-usd-hold",
      question: "美元金可持有",
      answer: holdIntl ? goldNextLine(intlPrice, plan.internationalWatch, plan.internationalUpper, intlZone, 0, "hold") : "美元金持有区待核验",
      tone: intlZone.tone,
      action: "detail",
      targetId: "plan",
      enabled: Boolean(holdIntl),
    }),
    card({
      id: "gold-usd-sell",
      question: "美元金卖出观察",
      answer: sellIntl ? goldNextLine(intlPrice, plan.internationalWatch, plan.internationalUpper, intlZone, 0, "sell") : "美元金卖出区待核验",
      tone: intlZone.sell ? "warn" : "muted",
      action: "detail",
      targetId: "plan",
      enabled: Boolean(sellIntl),
    }),
    card({
      id: "gold-cny-hold",
      question: "人民币金可持有",
      answer: holdCny ? goldNextLine(cnyPrice, plan.domesticWatch, plan.domesticUpper, cnyZone, 1, "hold") : "人民币金持有区待核验",
      tone: cnyZone.tone,
      action: "detail",
      targetId: "plan",
      enabled: Boolean(holdCny),
    }),
    card({
      id: "gold-cny-sell",
      question: "人民币金卖出观察",
      answer: sellCny ? goldNextLine(cnyPrice, plan.domesticWatch, plan.domesticUpper, cnyZone, 1, "sell") : "人民币金卖出区待核验",
      tone: cnyZone.sell ? "warn" : "muted",
      action: "detail",
      targetId: "plan",
      enabled: Boolean(sellCny),
    }),
  ];
}

function buildGuruAnswers(snapshot) {
  const items = allItems(snapshot, "guru").filter((item) => item.group !== "overlap");
  const leaders = ["us", "hk", "a"]
    .map((group) => items.find((item) => item.group === group))
    .filter(Boolean);
  const top = leaders[0];
  const holdings = (top?.raw?.holdings || []).slice(0, 3);
  const holdingLine = holdings
    .map((row) => `${row.ticker || row.name}${Number.isFinite(Number(row.weight)) ? ` ${Number(row.weight).toFixed(1)}%` : ""}`)
    .join(" · ");
  const firstSentence = (value) => {
    const text = String(value || "").replace(/\s+/gu, " ").trim();
    if (!text) return "";
    const end = text.search(/[。！？]/u);
    return end >= 0 ? text.slice(0, end + 1) : text;
  };
  const why = leaders.map((item) => `${item.name}：${firstSentence(item.raw?.profile?.why)}`).filter((line) => !line.endsWith("："));
  const how = leaders.map((item) => `${item.name}：${firstSentence(item.raw?.profile?.how)}`).filter((line) => !line.endsWith("："));
  const avoid = MASTER_PLAYBOOKS.slice(0, 3).map((book) => `${book.name}：${book.doNot}`);

  return [
    card({
      id: "guru-holdings",
      question: "业绩靠前持仓",
      answer: top
        ? `${top.name || "机构"} ${top.badge || ""}`.trim()
        : "机构样本待更新",
      names: holdingLine || namesOf(leaders),
      tone: top ? "good" : "muted",
      action: top ? "detail" : "none",
      targetId: top?.id || "",
      enabled: Boolean(top?.id),
    }),
    card({
      id: "guru-why",
      question: "他们怎么想",
      answer: why[0] || "公开业绩与持仓可对照，思路见详情 WHY",
      names: namesOf(leaders),
      tone: "good",
      action: "detail",
      targetId: top?.id || "",
      enabled: Boolean(top?.id),
      modal: why.join("\n") || "",
    }),
    card({
      id: "guru-learn",
      question: "我们如何借鉴",
      answer: how[0] || "学框架与风控，不照抄仓位",
      names: namesOf(leaders),
      tone: "good",
      action: "none",
      enabled: true,
      modal: (how.length ? how.join("\n") : "学框架、能力圈和风险边界，不按报告期仓位下单。")
        + "\nWHY/HOW 是望潮研究归纳，不是投资人实时表述。",
    }),
    card({
      id: "guru-avoid",
      question: "应该避免什么",
      answer: "不照抄仓位、不把滞后披露当实时单、不复制机构杠杆",
      tone: "bad",
      action: "none",
      enabled: true,
      modal: [
        "13F/季报有滞后，且通常只含多头。",
        "表观年化不可跨市场、跨币种横比。",
        ...avoid,
      ].join("\n"),
    }),
  ];
}

function buildDailyAnswers(snapshot, market, options = {}) {
  if (market === "hk") return buildHkAnswers(snapshot);
  if (market === "us") return buildUsAnswers(snapshot);
  if (market === "a") return buildAShareAnswers(snapshot, options.holdings);
  if (market === "gold") return buildGoldAnswers(snapshot);
  if (market === "guru") return buildGuruAnswers(snapshot);
  return [];
}

function clip(text, max = 5) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? value.slice(0, max) : value;
}

function pickCard(cards, ids) {
  for (const id of ids) {
    const card = (cards || []).find((item) => item.id === id);
    if (card && (card.enabled || card.names)) return card;
  }
  return null;
}

function homePoint(id, label, value, targetId, extra = {}) {
  const hasTarget = Boolean(targetId);
  return {
    id,
    label,
    value: value || "—",
    targetId: targetId || "",
    hasTarget,
    ariaCategory: `打开${label}栏目`,
    ariaTarget: hasTarget ? `打开${label} ${value}` : `${label}暂无标的`,
    ...extra,
  };
}

function tickerFromCard(market, card) {
  if (!card) return null;
  return {
    id: `answer-${market}-${card.id}`,
    kind: "answer",
    title: card.question,
    text: [card.answer, card.names].filter(Boolean).join(" · ").slice(0, 42),
    market,
    targetId: card.targetId || "",
    group: card.group || "",
    modal: card.modal || "",
  };
}

function buildHomeDigest(snapshot, options = {}) {
  const hk = buildHkAnswers(snapshot);
  const us = buildUsAnswers(snapshot);
  const a = buildAShareAnswers(snapshot, options.holdings);
  const gold = buildGoldAnswers(snapshot);
  const guru = buildGuruAnswers(snapshot);

  const hkWorth = pickCard(hk, ["hk-worth"]);
  const hkAvoid = pickCard(hk, ["hk-avoid", "hk-new"]);
  const usCheap = pickCard(us, ["us-cheap"]);
  const usRisk = pickCard(us, ["us-risk"]);
  const aAdd = pickCard(a, ["a-add"]);
  const aCore = pickCard(a, ["a-core"]);
  const goldLead = pickCard(gold, ["gold-cny-sell", "gold-usd-sell", "gold-cny-hold", "gold-usd-hold"]);
  const guruLead = pickCard(guru, ["guru-holdings"]);

  const hkValue = hkWorth?.enabled
    ? clip(hkWorth.names || "建议申购", 4)
    : (hkAvoid?.id === "hk-avoid" && hkAvoid.enabled ? "已取消" : "暂无");
  const usValue = usCheap?.enabled
    ? clip(usCheap.names || usCheap.answer, 4)
    : (usRisk?.enabled ? clip(usRisk.names || "风险", 4) : "七姐妹");
  const aValue = aAdd?.enabled && aAdd.id === "a-add" && /已到加大/.test(aAdd.answer)
    ? clip(aAdd.names || "加大", 4)
    : clip(aCore?.names || "收息", 4);
  const cnyPrice = Number(snapshot?.gold?.quotes?.domestic?.price);
  const goldValue = /进入卖出观察区/.test(goldLead?.answer || "")
    ? "偏高"
    : (/仍在持有观察区/.test(goldLead?.answer || "")
      ? "可持有"
      : (Number.isFinite(cnyPrice) ? `${Math.round(cnyPrice)}` : "观望"));

  const cardLines = [
    `港股：${hkWorth?.enabled ? `建议申购 ${hkWorth.names}` : (hkAvoid?.id === "hk-avoid" ? (hkAvoid.answer || "避雷样本") : "暂无在售新股")}`,
    `美股：${[
      usCheap?.enabled ? `低估 ${usCheap.names}` : null,
      usRisk?.enabled ? `风险 ${usRisk.names}` : null,
      pickCard(us, ["us-sleeve"])?.answer,
    ].filter(Boolean).join(" · ")}`,
    `A股：${[
      aAdd?.enabled ? aAdd.answer : null,
      aCore?.enabled ? `底仓 ${aCore.names}` : null,
    ].filter(Boolean).join(" · ")}`,
    `黄金：${gold.slice(0, 2).map((item) => item.answer).filter(Boolean).join(" · ")}`,
    `机构：${guruLead?.answer || "对照公开持仓"}`,
  ];

  const ticker = [
    tickerFromCard("hk", hkWorth?.enabled ? hkWorth : hkAvoid),
    tickerFromCard("us", usCheap?.enabled ? usCheap : pickCard(us, ["us-hold", "us-sleeve"])),
    tickerFromCard("us", usRisk?.enabled ? usRisk : pickCard(us, ["us-industry"])),
    tickerFromCard("a", aAdd),
    tickerFromCard("a", pickCard(a, ["a-cycle"])),
    tickerFromCard("gold", goldLead),
    tickerFromCard("guru", guruLead),
    tickerFromCard("guru", pickCard(guru, ["guru-avoid"])),
  ].filter(Boolean);

  return {
    points: [
      homePoint("hk", "港股", hkValue, hkWorth?.enabled ? hkWorth.targetId : ""),
      homePoint("us", "美股", usValue, usCheap?.targetId || usRisk?.targetId || ""),
      homePoint("a", "A股", aValue, aAdd?.targetId || aCore?.targetId || ""),
      homePoint("gold", "黄金", goldValue, goldLead?.targetId || "track"),
    ],
    cardLines,
    ticker,
    help: [hkValue, usValue, aValue, goldValue].filter(Boolean).join(" · "),
  };
}

module.exports = {
  buildDailyAnswers,
  buildHomeDigest,
};
