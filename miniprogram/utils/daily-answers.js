/**
 * 栏目页「今日答案」：一屏回答用户真正会问的问题。
 * 口径是研究观察，不是买卖指令；没有已验证数据时如实说暂无。
 */
const { aShareDividendStability, allItems, shortCompanyName } = require("./answers");
const { MASTER_PLAYBOOKS } = require("./master-playbooks");
const { buildGuruTrend } = require("./guru-trend");
const { toDay } = require("./dates");
const {
  buildHkExitBands, formatExitBand, formatExitMedian, formatExitPositive,
  mapOfferBand, mapOfferMedian,
} = require("./hk-exit-plan");
const {
  hkLeverageEligible,
  hkHistoricalCrowdEligible,
  yieldImpliedPlan,
  goldZoneForPrice,
  goldTurningPoint,
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

// chars 是「单个名字最多留几个字」。默认 6 是给公司名用的（"深圳市江波龙"），
// 但机构持仓那一栏列的是人名和基金名，6 个字会把「斯坦利·德鲁肯米勒」切成
// 「斯坦利·德鲁」——同一行的结论里写的却是全名，一行里自己对不上自己。
function namesOf(items, max = 3, chars = 6) {
  const names = (items || [])
    .map((item) => shortCompanyName(item.name, item.code || "标的", chars))
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
  state = "",
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
    // 首页那格摘要要判断黄金现在处在哪个区。原来靠对答案文案做正则，文案一改
    // 就静默失效；这里让卡片直接把区名带出来，文案怎么写都不影响判断。
    state,
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

  // 用户点名要的是暗盘与首日两个卖点。首周仍然照算，只是收进首日那张卡的
  // 展开层——它和首日用的是同一批已披露样本，单占一行等于把同一段分位说明
  // 在一屏里印三遍。
  const weekModal = () => {
    const band = bands.fiveDay;
    if (!band || !band.n) return "打中后首周：已披露样本不足，暂不给出观察价。";
    const mid = liveLead && offer ? mapOfferMedian(offer, band) : null;
    return [
      `打中后首周（与首日同一批样本）：${formatExitMedian(band)}${mid ? `，约 ${mid}` : ""}`,
      `${formatExitPositive(band)}，区间 ${formatExitBand(band)}`,
      "历史分位不是下一只的保证卖出价。",
    ].join("\n");
  };

  const exitCard = (id, question, band, endedKey, modal = "") => {
    const ended = items
      .filter((item) => item.group === "ended" && Number.isFinite(Number(item.raw?.historicalReview?.[endedKey])))
      .slice()
      .sort((left, right) => String(right.raw?.listingDate || "").localeCompare(String(left.raw?.listingDate || "")));
    if (liveLead && offer && band?.n) {
      const mapped = mapOfferBand(offer, band);
      const mid = mapOfferMedian(offer, band);
      // 粗体那行只放最该记住的一个数：中位。区间和收正只数退到下面那行灰字，
      // 原来把「-1.2%～+57.0%（n=12），约 19–31 港元」全塞进粗体行，
      // 在 375 宽的屏幕上要折三行，还把最关键的中位数彻底省掉了。
      return card({
        id,
        question,
        answer: [formatExitMedian(band), mid ? `约 ${mid}` : null]
          .filter(Boolean).join("，") || formatExitBand(band),
        names: [
          shortCompanyName(lead.name, "新股", 6),
          formatExitPositive(band),
          mapped ? `区间 ${mapped}` : `区间 ${formatExitBand(band)}`,
        ].filter(Boolean).join(" · "),
        tone: "warn",
        action: "detail",
        targetId: lead.id,
        enabled: true,
        hint: "按历史分位映射到招股价，不是本股保证卖出价。",
        modal,
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
        answer: `${lastLine}；下一只先看${formatExitMedian(band)}`,
        names: [
          namesOf(ended.slice(0, 3)),
          formatExitPositive(band),
          `区间 ${formatExitBand(band)}`,
        ].filter(Boolean).join(" · "),
        tone: "warn",
        action: "group",
        group: "ended",
        targetId: sample.id,
        enabled: true,
        hint: "已披露结果只复盘最近一只；分位不是下一只保证卖出价。",
        modal,
      });
    }
    if (band?.n) {
      return card({
        id,
        question,
        answer: `${formatExitMedian(band)}，不是下一只的保证卖出价`,
        names: [
          namesOf(ended),
          formatExitPositive(band),
          `区间 ${formatExitBand(band)}`,
        ].filter(Boolean).join(" · "),
        tone: "warn",
        action: "group",
        group: "ended",
        enabled: true,
        hint: "没有在售新股招股价时，只展示历史分位。",
        modal,
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
        modal,
      });
    }
    return card({
      id,
      question,
      answer: "样本不足，暂不给出观察价",
      tone: "muted",
      modal,
    });
  };

  return [
    card({
      id: "hk-new",
      question: "近期上新",
      answer: active.length
        ? `${active.length} 只在售`
        : (live.length ? `${live.length} 只已取消或无法申购` : "当前没有可申购新股"),
      // 计数用的是 active（在售），名字以前用的是 live（含已取消），于是出现
      // 「3 只在售 · 甲、乙、丙 等4只」这种自己对不上自己的写法。
      names: namesOf(active.length
        ? active
        : (live.length ? live : items.filter((item) => item.group === "ended").slice(0, 3))),
      tone: active.length ? "good" : "muted",
      action: active.length ? "group" : (live.length ? "group" : "group"),
      group: active.length ? (worth.length ? "worth" : active[0].group) : (live.length ? live[0].group : "ended"),
      enabled: live.length + items.filter((item) => item.group === "ended").length > 0,
    }),
    card({
      id: "hk-worth",
      question: "哪些值得打",
      answer: worth.length ? `值得打 ${worth.length} 只` : "暂无值得打的新股",
      names: namesOf(worth),
      tone: worth.length ? "good" : "warn",
      action: "group",
      group: "worth",
      targetId: worth[0]?.id || "",
      enabled: worth.length > 0,
      // 打多少手不在用户点名的五个问题里，但「默认仍是一手」是这张卡自己的
      // 边界，删掉等于把风险话术一起删了。收进展开层：名单在上，仓位在下，
      // 「查看」仍然直接进列表。没有值得打的新股时不弹这一层。
      modal: worth.length
        ? [
          // 卡片正面最多列三只，超过三只时展开层才需要把名单补全，否则是同一
          // 行字印两遍。
          worth.length > 3
            ? `值得打 ${worth.length} 只：${worth.map((item) => shortCompanyName(item.name, "新股", 6)).join("、")}`
            : "",
          leverage.length
            ? `其中 ${leverage.map((item) => shortCompanyName(item.name, "新股", 4)).join("、")} 达到十倍融资门槛（研究分≥80、招股价与一手金额齐全、超购<200），仍须能承受一手亏损。`
            : "都没到十倍融资门槛（研究分≥80、招股价与一手金额齐全、超购<200）。",
          "默认仍是一手；融资会放大破发，这不是加杠杆指令。",
        ].filter(Boolean).join("\n")
        : "",
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
    exitCard("hk-grey", "打中后暗盘", bands.grey, "greyMarketChange"),
    exitCard("hk-first", "打中后首日", bands.firstDay, "firstDayChange", weekModal()),
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
  // 「近期最热的三只是什么、为什么火热」——这一问原来页面上一张卡都没有，
  // 热度前三只存在于分组列表里，首屏答不出来。
  const hot = items.filter((item) => item.group === "hot").slice(0, 3);
  const hotQualified = hot.filter((item) => item.raw && item.raw.fund && item.raw.fund.qualityEligible === true);
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
    // 前四段都是「代码 权重%」，第五段却是「周期 10% 优步 $75.96、博通 $357.20」，
    // 权重和举例之间只隔一个空格，读起来像「优步占周期的 10%」。举例括起来，
    // 五段才是同一种读法。
    pickNames ? `周期 ${sleeve.weights.cycle}%（${pickNames}）` : `周期 ${sleeve.weights.cycle}% 样本不足`,
  ].join(" + ");
  // 「七姐妹近期发生了什么事」这一问原来首屏答不出来：页面上只有估值分档，
  // 没有一句「这一周他们身上发生了什么」。这里只汇总库里已有的两样公开事实——
  // 周涨跌与最新披露财季。本数据源没有新闻与公告字段，所以不写「因为某某消息」，
  // 那要另接新闻源才能说。
  const weekOf = (item) => (hasNumber(item?.raw?.weeklyChange) ? Number(item.raw.weeklyChange) : null);
  // 近一个月按 21 个交易日算，样本不足就返回空——离线兜底数据只有 24 个收盘价，
  // 刚好够一档，不够就别拿更短的窗口冒充「近一个月」。
  const monthOf = (item) => {
    const history = (item?.raw?.history || []).map(Number).filter((value) => Number.isFinite(value));
    if (history.length < 21) return null;
    const base = history[history.length - 21];
    if (!base) return null;
    return ((history[history.length - 1] - base) / base) * 100;
  };
  const weekRanked = seven.filter((item) => weekOf(item) !== null)
    .sort((left, right) => weekOf(right) - weekOf(left));
  const upCount = weekRanked.filter((item) => weekOf(item) > 0).length;
  const strongest = weekRanked[0];
  const weakest = weekRanked[weekRanked.length - 1];
  const sevenAnswer = weekRanked.length >= 2
    ? `本周 ${upCount} 涨 ${weekRanked.length - upCount} 跌，最强 ${shortCompanyName(strongest.name, strongest.code, 4)} ${signedPct(weekOf(strongest))}，最弱 ${shortCompanyName(weakest.name, weakest.code, 4)} ${signedPct(weekOf(weakest))}`
    : "本周涨跌数据不足，暂不汇总";
  const sevenModal = weekRanked.length
    ? [
      ...weekRanked.map((item) => {
        const fund = item.raw?.fund || {};
        const month = monthOf(item);
        return [
          `${shortCompanyName(item.name, item.code, 8)} 本周 ${signedPct(weekOf(item))}`,
          month !== null ? `近一个月 ${signedPct(month)}` : "",
          fund.period ? `财季 ${toDay(fund.period) || fund.period}` : "",
          hasNumber(fund.revenueGrowth) ? `营收同比 ${signedPct(fund.revenueGrowth)}` : "",
        ].filter(Boolean).join(" · ");
      }),
      "",
      hold.length
        ? `质量门通过 ${hold.length}/7：${hold.map((item) => shortCompanyName(item.name, item.code, 4)).join("、")}——可长期观察的名单从这里来。`
        : "本轮没有一只通过质量门，先不谈长期观察。",
      "只汇总公开行情与已披露财季。本数据源没有新闻与公告字段，不写「因为某某消息」，那要另接新闻源才能说。",
    ].join("\n")
    : "";

  // 卡片正面只放配置本身。四个代码各带一个报价、后面再挂两个周期举例，
  // 在 390 宽的屏幕上要折三行，权重反而看不清；报价留在展开层。
  const sleeveFace = [
    `VOO ${sleeve.weights.VOO}%`,
    `${incomeSymbol} ${sleeve.weights.income}%`,
    `O ${sleeve.weights.O}%`,
    `SGOV ${sleeve.weights.SGOV}%`,
    `周期 ${sleeve.weights.cycle}%`,
  ].join(" + ");
  const missing = ["VOO", incomeSymbol, "O", "SGOV"].filter((symbol) => !sleevePrice(snapshot, symbol));
  const modal = [
    // summary 里已经带了一遍配置行，展开层不再重复，只补正面省掉的报价。
    sleeve.summary,
    // 一个报价都没有时不印这一行——四个「暂缺」下面紧跟着还有一句
    // 「暂无已核验报价」，等于把同一件事说两遍。
    missing.length >= 4
      ? ""
      : `报价：${["VOO", incomeSymbol, "O", "SGOV"]
        .filter((symbol) => sleevePrice(snapshot, symbol))
        .map((symbol) => `${symbol} ${sleevePrice(snapshot, symbol)}`).join(" · ")}`,
    `收息套：${incomeSymbol}（JEPQ=纳指备兑，SCHD=红利价值，二者取一）`,
    // 行业观察（万事达、优步）本来单占一张卡，但用户点名的四问里没有它，
    // 而周期那一格的样本本来就是从这批行业公司里挑的——收进这里，名单不丢，
    // 首屏也不用为它留一行。
    industry.length
      ? `行业对照：${industry.map((item) => {
        const price = usd(item.raw?.price);
        return `${shortCompanyName(item.name, item.code, 4)}${price ? ` ${price}` : ""}${item.score != null ? ` ${item.score}分` : ""}`;
      }).join("、")}——只用于研究比较，不是买入指令。`
      : "行业对照：当前没有同时满足质量与分数的样本。",
    missing.length ? `${missing.join("/")} 暂无已核验报价，不补虚拟价格。` : "ETF 报价来自 Yahoo Finance 公开行情，只作配置对照。",
    "研究观察，不是买卖指令。",
  ].filter(Boolean).join("\n");

  return [
    card({
      id: "us-seven",
      question: "七姐妹近期怎么了",
      answer: sevenAnswer,
      names: `质量门 ${hold.length}/7 通过`,
      // 涨跌本身没有好坏，这一格只是把这一周发生的事说清楚。
      tone: weekRanked.length ? "warn" : "muted",
      action: "group",
      group: "seven",
      enabled: seven.length > 0,
      modal: sevenModal,
    }),
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
      id: "us-hot",
      question: "最热的三只",
      answer: hot.length
        ? hot.map((item) => {
          const heat = Number(item.raw && item.raw.heatScore);
          return `${shortCompanyName(item.name, item.code || "标的", 6)}${Number.isFinite(heat) ? ` ${Math.round(heat)}` : ""}`;
        }).join(" · ")
        : "热度数据不足",
      names: hot.length
        ? (hotQualified.length
          ? `${hotQualified.length} 只过质量门：${namesOf(hotQualified, 3, 6)}`
          : "三只都没过质量门")
        : "",
      // 热本身没有好坏，所以不给 good/bad；过了质量门才转中性偏好。
      tone: hot.length ? (hotQualified.length ? "warn" : "bad") : "muted",
      action: "group",
      group: "hot",
      targetId: hot[0]?.id || "",
      enabled: hot.length > 0,
      hint: "热度由公开成交与涨跌算出，不含新闻事件。",
      modal: hot.length
        ? [
          ...hot.map((item) => {
            const heat = Number(item.raw && item.raw.heatScore);
            const driver = item.heatDriver || "驱动数据不足";
            return `${shortCompanyName(item.name, item.code || "标的", 8)}${Number.isFinite(heat) ? ` 热度 ${Math.round(heat)}` : ""}：${driver}。${item.attentionNote || ""}`;
          }),
          "",
          "热度只由公开成交量比与涨跌幅算出。本数据源没有新闻与公告字段，所以不写「因为某某消息」这类原因——那需要另接新闻源才能说。",
          "放量下跌和放量上涨都会让热度变高，热度本身不指方向，更不是买入信号。",
        ].join("\n")
        : "",
    }),
    card({
      id: "us-sleeve",
      question: "底仓如何配置",
      answer: sleeveFace,
      // 周期那一格在正面只有一个权重，举例放副行；收息套代码已经印在正面了。
      names: pickNames ? `周期观察 ${pickNames}` : "周期样本不足，先留在 SGOV",
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
  // 两个维度的前五。名次在 answers.js 里按同一套排序打好了 lens，这里只负责
  // 把名次重新排出来并挑出领头那只的两个参考价——排序口径不能有两份。
  const rankedBy = (lens, score) => items
    .filter((item) => matchesGroup(item, lens))
    .sort((left, right) => score(right.raw || {}) - score(left.raw || {}));
  const stableTop = rankedBy("stable5", (raw) => Number(aShareDividendStability(raw) || 0) * 1000
    + Number(raw.sustainableDividendYield || 0));
  const yieldTop = rankedBy("yield5", (raw) => Number(raw.currentDividendYield || 0));
  const rankNames = (list) => list
    .map((item) => shortCompanyName(item.name, "收息", 4))
    .join(" · ");
  // 榜首那只的参考买卖价直接写在卡上，剩下四只的价在列表里每行都有。
  const leadPrice = (list) => {
    const lead = list[0];
    const plan = lead ? yieldImpliedPlan(lead.raw) : null;
    if (!lead) return "";
    if (!plan) return `${shortCompanyName(lead.name, "收息", 4)} 参考价暂缺`;
    return `第一名 ${shortCompanyName(lead.name, "收息", 4)} 参考买 ${yuan(plan.addPrice)} · 参考卖 ${yuan(plan.trimPrice)}`;
  };
  // 排序依据得摆出来，否则「凭什么它第一」只能靠信。
  const stableWhy = stableTop[0]
    ? `分红稳定性 ${aShareDividendStability(stableTop[0].raw)}`
    : "";
  const yieldWhy = stableTop.length && yieldTop[0]
    ? `当前股息 ${Number(yieldTop[0].raw?.currentDividendYield || 0).toFixed(1)}%`
    : "";
  // 用户要的是「优先股票、次之基金」。基金这半边现在给不出来，就说给不出来：
  // 快照里的 A 股基金只有 1 只红利 ETF，且它的分红以基金公告为准、没有股息率字段，
  // 排不进任何一个按股息率排的榜。凑不满五只就不凑。
  const fundNote = "样本内只有 1 只红利 ETF，分红以基金公告为准、没有股息率，排不进股息排序，所以前五都是股票。";

  const heldTrim = withPlan.filter((entry) => {
    const cost = Number(entry.holding?.cost);
    if (!hasNumber(cost) || cost <= 0) return false;
    const pnl = (entry.plan.price / cost - 1) * 100;
    return pnl >= 12 || entry.plan.zone === "trim";
  });

  return [
    card({
      id: "a-stable5",
      question: "分红稳定性 前五",
      answer: stableTop.length ? rankNames(stableTop) : "缺少分红分与可持续股息，暂不排名",
      names: [stableWhy, leadPrice(stableTop)].filter(Boolean).join(" · "),
      tone: stableTop.length ? "good" : "warn",
      action: "group",
      group: "stable5",
      targetId: stableTop[0]?.id || "",
      enabled: stableTop.length > 0,
      hint: `分红稳定性 = 可持续股息对当前股息的覆盖率、自由现金流、现金利润比、股东回报，权重沿用收息观察分，不含股息高低。不是收益承诺。${fundNote}`,
    }),
    card({
      id: "a-yield5",
      question: "分红收益性 前五",
      answer: yieldTop.length ? rankNames(yieldTop) : "缺少当前股息率，暂不排名",
      names: [yieldWhy, leadPrice(yieldTop)].filter(Boolean).join(" · "),
      tone: yieldTop.length ? "good" : "warn",
      action: "group",
      group: "yield5",
      targetId: yieldTop[0]?.id || "",
      enabled: yieldTop.length > 0,
      hint: `只按当前股息率排序，高息本身不代表分红能持续——两个榜单同时上榜的才是两头都过得去的。${fundNote}`,
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
    // 这里读的是 pricePlan.internationalWatch / domesticWatch，和栏目分组说明、
    // 明细页、详情页读的是同一个字段，那三处一律叫「观察低位」，只有这两句写成
    // 「持有观察区」。同一个数在首页和详情页有两个名字，看起来像两回事。
    if (zone?.hold) return `现价 ${priceText}，仍在观察低位（${formatGoldRange(holdRange, digits)}）`;
    if (Number.isFinite(holdHigh)) return `现价 ${priceText}，未到观察低位（≤${holdHigh.toFixed(digits)}）`;
  }
  if (kind === "sell") {
    if (zone?.sell) return `现价 ${priceText}，进入观察上沿（${formatGoldRange(sellRange, digits)}）`;
    if (Number.isFinite(sellLow)) return `现价 ${priceText}，未到观察上沿（≥${sellLow.toFixed(digits)}）`;
  }
  return `现价 ${priceText} · ${zone?.label || "继续观察"}`;
}

function goldMonthDay(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return "";
  return `${Number(match[2])}月${Number(match[3])}日`;
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
  const hasIntl = hasNumber(intl.price);
  const hasCny = hasNumber(domestic.price);
  const intlPrice = hasIntl ? Number(intl.price).toFixed(0) : "暂缺";
  const cnyPrice = hasCny ? Number(domestic.price).toFixed(1) : "暂缺";

  // 一、现在什么价。两个口径一行说完，日内涨跌和半年位置放第二行。
  const priceLine = [
    hasIntl ? `美元金 ${intlPrice} 美元/盎司` : null,
    hasCny ? `人民币金 ${cnyPrice} 元/克` : null,
  ].filter(Boolean).join(" · ") || "行情待核验";
  // 单位跟着上面那行的数字走，这行只说涨跌和位置——把「美元/盎司」拆到这里，
  // 会变成一串没有主语的单位。
  const priceDetail = [
    hasIntl || hasCny ? `日内 ${[
      hasIntl ? `美元金 ${signedPct(intl.changePercent)}` : null,
      hasCny ? `人民币金 ${signedPct(domestic.changePercent)}` : null,
    ].filter(Boolean).join(" · ")}` : null,
    hasNumber(intl.percentile180) ? `美元金半年分位 ${Number(intl.percentile180)}%` : null,
  ].filter(Boolean).join(" · ");

  // 二、是否值得买入。两个口径谁进了观察低位就说谁，都没进就直说都没到——
  // 「到了什么价才值得买」本来就是这张卡要回答的，所以把低位区间写在第二行。
  const buyIn = [
    intlZone.hold ? "美元金" : null,
    cnyZone.hold ? "人民币金" : null,
  ].filter(Boolean);
  const buyRanges = [
    holdIntl ? `美元金观察低位 ${holdIntl}` : null,
    holdCny ? `人民币金观察低位 ${holdCny}` : null,
  ].filter(Boolean).join(" · ");
  const buyAnswer = buyIn.length
    ? `${buyIn.join("与")}已在观察低位，可分批加大`
    : (buyRanges ? "两个口径都未到观察低位，暂不加大" : "观察低位待核验");

  // 三、是否应该卖出。触及风险下沿要先说风险——那是比「该不该卖」更靠前的事。
  const sellIn = [
    intlZone.sell ? "美元金" : null,
    cnyZone.sell ? "人民币金" : null,
  ].filter(Boolean);
  const riskIn = [
    intlZone.label === "触及风险下沿" ? "美元金" : null,
    cnyZone.label === "触及风险下沿" ? "人民币金" : null,
  ].filter(Boolean);
  const sellRanges = [
    sellIntl ? `美元金观察上沿 ${sellIntl}` : null,
    sellCny ? `人民币金观察上沿 ${sellCny}` : null,
  ].filter(Boolean).join(" · ");
  let sellAnswer = "观察上沿待核验";
  if (riskIn.length) sellAnswer = `${riskIn.join("与")}触及风险下沿，先停手复核`;
  else if (sellIn.length) sellAnswer = `${sellIn.join("与")}进入观察上沿，可兑现一部分`;
  else if (sellRanges) sellAnswer = "两个口径都未到观察上沿，暂不兑现";

  // 四、拐点。只用真实收盘价算得出的三件事：均线在哪一侧、最近一次穿越是哪天、
  // 现价离半年高低点还有多远。算不出就如实说算不出，不拿短样本充半年趋势。
  const turn = goldTurningPoint(gold.history?.international, intl.price);
  const crossText = turn && turn.crossDate
    ? `${goldMonthDay(turn.crossDate)} 20日线${turn.above ? "上穿" : "下穿"}60日线，已 ${turn.crossDays} 个交易日未反向`
    : (turn ? `近半年 20日线一直在 60日线${turn.above ? "上方" : "下方"}` : "");
  const turnAnswer = turn
    ? `${turn.above ? "均线转上行" : "均线转下行"}：${crossText}`
    : "半年收盘价样本不足 60 天，拐点暂不下判断";
  // 高低点谁离今天更近，就先说谁——那一头才是这轮走势的起点。
  const extremes = turn
    ? [
      { text: `${goldMonthDay(turn.peak.date)}半年高点 ${turn.peak.close.toFixed(0)}（现价 ${signedPct(turn.fromPeak)}）`, date: turn.peak.date },
      { text: `${goldMonthDay(turn.trough.date)}半年低点 ${turn.trough.close.toFixed(0)}（现价 ${signedPct(turn.fromTrough)}）`, date: turn.trough.date },
    ].sort((left, right) => (left.date < right.date ? 1 : -1)).map((row) => row.text)
    : [];
  const turnDetail = [
    ...extremes,
    hasNumber(intl.returns?.day20) ? `20日 ${signedPct(intl.returns.day20)}` : null,
    hasNumber(intl.returns?.day60) ? `60日 ${signedPct(intl.returns.day60)}` : null,
  ].filter(Boolean).join(" · ");

  return [
    card({
      id: "gold-price",
      question: "现在什么价",
      answer: priceLine,
      names: priceDetail,
      tone: "muted",
      action: "detail",
      targetId: "track",
      enabled: hasIntl || hasCny,
      state: intlZone.label,
    }),
    card({
      id: "gold-buy",
      question: "是否值得买入",
      answer: buyAnswer,
      names: buyRanges,
      tone: buyIn.length ? "good" : "muted",
      action: "detail",
      targetId: "plan",
      enabled: Boolean(buyRanges),
      state: buyIn.length ? "buy" : "",
    }),
    card({
      id: "gold-sell",
      question: "是否应该卖出",
      answer: sellAnswer,
      names: sellRanges,
      tone: riskIn.length ? "bad" : (sellIn.length ? "warn" : "muted"),
      action: "detail",
      targetId: "plan",
      enabled: Boolean(sellRanges),
      state: riskIn.length ? "risk" : (sellIn.length ? "sell" : ""),
    }),
    card({
      id: "gold-turn",
      question: "拐点变化",
      answer: turnAnswer,
      names: turnDetail,
      tone: turn ? (turn.above ? "good" : "bad") : "muted",
      action: "detail",
      targetId: "track",
      enabled: Boolean(turn),
      state: turn ? (turn.above ? "up" : "down") : "",
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

  // 跨机构的方向汇总。「几家在加、几家在减」是从 13F 已披露的 changeType 里数出来的，
  // 不是我们的预测；所以下面每句话都能追到具体是哪几家在动。
  const trend = buildGuruTrend(snapshot);
  // 家数逐只写在名字后面。三只并列却共用第一名的家数，会把 2 家的说成 3 家。
  const listCounts = (rows, key, limit = 3) => rows.slice(0, limit)
    .map((row) => `${row.name} ${row[key].length}家`)
    .join(" · ");
  const listNames = (rows, limit = 3) => rows.slice(0, limit).map((row) => row.name).join(" · ");
  const listWho = (rows, key, limit = 2) => rows.slice(0, limit)
    .map((row) => `${row.name}：${row[key].map((one) => one.who).join(" / ")}`)
    .join("；");
  // 卡片正文只放前三只，其余的进展开层，一只都不丢。
  const listAll = (rows, key) => rows
    .map((row) => `${row.name} ${row[key].length}家：${row[key].map((one) => one.who).join(" / ")}`)
    .join("\n");
  const addAnswer = trend.consensusAdds.length
    ? `${listCounts(trend.consensusAdds, "adders")} 同向加仓`
    : (trend.adds.length
      ? `本季没有 2 家以上同向加仓，单家加的有 ${listNames(trend.adds)}`
      : "本季公开申报里未见增持标注");
  const cutAnswer = trend.consensusCuts.length
    ? `${listCounts(trend.consensusCuts, "cutters")} 同向减仓`
    : (trend.cuts.length
      ? `本季没有 2 家以上同向减仓，单家减的有 ${listNames(trend.cuts)}`
      : "本季公开申报里未见减持标注");
  // 加与减取自持仓行的标注，退出取自 sold 名单，两份口径不同，不合并成一个净值。
  const trendAnswer = trend.totals.up + trend.totals.new + trend.totals.down > 0
    ? `${trend.investorCount} 家里，增持/新建 ${trend.totals.up + trend.totals.new} 项、减持 ${trend.totals.down} 项，另有 ${trend.totals.exit} 项整仓退出`
    : "本季公开申报的变化标注不足，方向暂不下判断";
  const splitLine = trend.split.length
    ? `分歧：${trend.split.slice(0, 3).map((row) => `${row.name}（${row.adders.length}加${row.cutters.length}减）`).join(" · ")}`
    : "";

  return [
    card({
      id: "guru-holdings",
      question: "业绩靠前持仓",
      answer: top
        ? `${top.name || "机构"} ${top.badge || ""}`.trim()
        : "机构样本待更新",
      names: holdingLine || namesOf(leaders, 3, 10),
      tone: top ? "good" : "muted",
      action: top ? "detail" : "none",
      targetId: top?.id || "",
      enabled: Boolean(top?.id),
    }),
    card({
      id: "guru-add",
      question: "本季他们在加什么",
      answer: addAnswer,
      names: listWho(trend.consensusAdds.length ? trend.consensusAdds : trend.adds, "adders"),
      tone: trend.consensusAdds.length ? "good" : "muted",
      action: "none",
      enabled: Boolean(trend.adds.length),
      modal: `本季有增持或新建标注的（共 ${trend.adds.length} 只）\n${listAll(trend.adds, "adders")}`,
    }),
    card({
      id: "guru-cut",
      question: "本季他们在减什么",
      answer: cutAnswer,
      names: listWho(trend.consensusCuts.length ? trend.consensusCuts : trend.cuts, "cutters"),
      tone: trend.consensusCuts.length ? "bad" : "muted",
      action: "none",
      enabled: Boolean(trend.cuts.length),
      modal: `本季有减持或退出标注的（共 ${trend.cuts.length} 只）\n${listAll(trend.cuts, "cutters")}`,
    }),
    card({
      id: "guru-trend",
      question: "未来持仓趋势",
      answer: trendAnswer,
      names: [splitLine, "13F 为季度披露，反映的是申报期方向，不是实时单"].filter(Boolean).join(" · "),
      tone: "warn",
      action: "none",
      enabled: true,
      // 「他们怎么想 / 我们如何借鉴」原来各占一张卡，和方向汇总说的是同一件事的
      // 两个层次。收进这张卡的展开层：一屏先给方向，想看理由再点开。
      modal: [
        why.length ? `他们怎么想\n${why.join("\n")}` : "",
        how.length ? `我们如何借鉴\n${how.join("\n")}` : "学框架、能力圈和风险边界，不按报告期仓位下单。",
        "WHY/HOW 是望潮研究归纳，不是投资人实时表述。",
      ].filter(Boolean).join("\n\n"),
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
  const aCore = pickCard(a, ["a-stable5", "a-core"]);
  // 黄金那格现在拿「是否应该卖出」当引子：有风险/上沿要先说，没有再退回价格卡。
  const goldSell = pickCard(gold, ["gold-sell"]);
  const goldLead = goldSell?.state ? goldSell : pickCard(gold, ["gold-price", "gold-buy", "gold-sell"]);
  const guruLead = pickCard(guru, ["guru-holdings"]);
  // 有多家同向的那一侧才值得上首页；加减都没共识时退回方向汇总。
  const guruAdd = pickCard(guru, ["guru-add"]);
  const guruCut = pickCard(guru, ["guru-cut"]);
  const guruMove = (guruAdd?.tone === "good" ? guruAdd : null)
    || (guruCut?.tone === "bad" ? guruCut : null)
    || pickCard(guru, ["guru-trend"]);

  const hkValue = hkWorth?.enabled
    ? clip(hkWorth.names || "值得打", 4)
    : (hkAvoid?.id === "hk-avoid" && hkAvoid.enabled ? "已取消" : "暂无");
  const usValue = usCheap?.enabled
    ? clip(usCheap.names || usCheap.answer, 4)
    : (usRisk?.enabled ? clip(usRisk.names || "风险", 4) : "七姐妹");
  const aValue = aAdd?.enabled && aAdd.id === "a-add" && /已到加大/.test(aAdd.answer)
    ? clip(aAdd.names || "加大", 4)
    : clip(aCore?.names || "收息", 4);
  const cnyPrice = Number(snapshot?.gold?.quotes?.domestic?.price);
  // 判断改看卡片自己带出来的区名，不再对答案文案做正则——文案是会改的，区名不会。
  const goldBuy = pickCard(gold, ["gold-buy"]);
  const goldState = goldSell?.state || goldBuy?.state || "";
  const goldValue = goldState === "risk"
    ? "风险下沿"
    : (goldState === "sell"
      ? "偏高"
      : (goldState === "buy"
        ? "可加大"
        // 另外三格都是标的名或结论词，黄金这格却是个没口径的裸数字「958」，
        // 首页上读不出这是什么价。加单位即可，不编造它没有的结论。
        : (Number.isFinite(cnyPrice) ? `${Math.round(cnyPrice)}元/克` : "观望")));

  // 卡片文案分享出去只留两句：现在什么价，再加一句该不该动。买卖两侧都没到
  // 观察区时，两句「都未到……」并排贴出来是同一个意思说两遍，合成一句。
  const goldActive = goldSell?.state ? goldSell : (goldBuy?.state ? goldBuy : null);
  const goldCardLine = [
    String(pickCard(gold, ["gold-price"])?.answer || "").trim(),
    goldActive ? String(goldActive.answer || "").trim() : "买卖两侧都未到观察区，继续观察",
  ].filter(Boolean).join(" · ");

  const cardLines = [
    `港股：${hkWorth?.enabled ? `值得打 ${hkWorth.names}` : (hkAvoid?.id === "hk-avoid" ? (hkAvoid.answer || "避雷样本") : "暂无在售新股")}`,
    `美股：${[
      usCheap?.enabled ? `低估 ${usCheap.names}` : null,
      usRisk?.enabled ? `风险 ${usRisk.names}` : null,
      pickCard(us, ["us-sleeve"])?.answer,
    ].filter(Boolean).join(" · ")}`,
    `A股：${[
      aAdd?.enabled ? aAdd.answer : null,
      aCore?.enabled ? `稳定性前五 ${clip(aCore.answer.split(" · ")[0], 6)} 等5只` : null,
    ].filter(Boolean).join(" · ")}`,
    `黄金：${goldCardLine}`,
    // 机构那行原来只有「谁的持仓」，把本季在往哪边动也带上——用户问的是持仓与动向。
    `机构：${[guruLead?.answer || "对照公开持仓", guruMove?.answer].filter(Boolean).join(" · ")}`,
  ];

  const ticker = [
    tickerFromCard("hk", hkWorth?.enabled ? hkWorth : hkAvoid),
    // 长期观察与行业观察已并入七姐妹与底仓两张卡，兜底改指还在的卡片，
    // 否则 pickCard 拿到 undefined，跑马灯会静默少两条。
    tickerFromCard("us", usCheap?.enabled ? usCheap : pickCard(us, ["us-seven", "us-sleeve"])),
    tickerFromCard("us", usRisk?.enabled ? usRisk : pickCard(us, ["us-seven", "us-sleeve"])),
    tickerFromCard("a", aAdd),
    tickerFromCard("a", pickCard(a, ["a-cycle"])),
    tickerFromCard("gold", goldLead),
    tickerFromCard("guru", guruLead),
    tickerFromCard("guru", pickCard(guru, ["guru-trend", "guru-avoid"])),
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
