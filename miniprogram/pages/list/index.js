const { loadSnapshot } = require("../../data/store");
const { freshnessBanner } = require("../../utils/freshness-ui");
const { allItems, groupDefinitions, shortCompanyName, matchesGroup } = require("../../utils/answers");
const { goHome } = require("../../utils/nav");
const { track } = require("../../utils/analytics");
const { RESEARCH_DISCLAIMER } = require("../../utils/disclaimer");
const { scoreForItem } = require("../../utils/strategy-score");
const { buildStrategySignal } = require("../../utils/strategy-signals");
const strategyEvidence = require("../../data/strategy-evidence");
const { buildHkHistoryStats, buildHkIndustryStats, buildHkSponsorStats } = require("../../utils/hk-history-stats");
const { marketSources } = require("../../utils/sources");
// 页头那句「数据截至 …」和新闻资讯页共用同一个写法：同一份快照在两个页面上
// 说出来的时间必须是同一个。
const { asOfText } = require("../../utils/dates");

const MARKET_META = {
  hk: { label: "港股打新", icon: "/assets/home/hk.svg", tone: "hk" },
  us: { label: "美股投资", icon: "/assets/home/us.svg", tone: "us" },
  a: { label: "A股收息", icon: "/assets/home/a.svg", tone: "a" },
  gold: { label: "黄金追踪", icon: "/assets/home/gold.svg", tone: "gold" },
  guru: { label: "机构持仓", icon: "/assets/home/guru.svg", tone: "guru" },
};

const HK_BADGE_SENTIMENT = { worth: "good", caution: "warn", avoid: "bad", ended: "muted", cancelled: "muted" };
const A_BADGE_SENTIMENT = { prime: "good", watch: "warn" };

function badgeSentimentFor(market, group) {
  if (market === "hk") return HK_BADGE_SENTIMENT[group] || "";
  if (market === "a") return A_BADGE_SENTIMENT[group] || "";
  return "";
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function performanceNumber(value) {
  return Number(String(value || "").match(/\d+(?:\.\d+)?/)?.[0] || 0);
}

// 取一段文案里出现的第一个数，用来判断两个标签是不是在说同一个数字。
function leadingNumber(text) {
  const hit = String(text || "").match(/\d+(?:\.\d+)?/);
  return hit ? Number(hit[0]) : null;
}

function comparisonMetric(item, market) {
  if (market === "us") {
    if ((item.group === "hot" || item.group === "hot10") && hasNumber(item.raw?.heatScore)) {
      return { value: Number(item.raw.heatScore), label: `热度 ${Number(item.raw.heatScore)}` };
    }
    if (item.group === "value" && hasNumber(item.score)) {
      return { value: Number(item.score), label: `性价比 ${Number(item.score)}` };
    }
    if (hasNumber(item.raw?.changePercent)) {
      const value = Number(item.raw.changePercent);
      return {
        value: Math.abs(value),
        label: `今日 ${value >= 0 ? "+" : ""}${value.toFixed(1)}%`,
        tone: value < 0 ? "down" : "up",
      };
    }
  }
  if (market === "a" && hasNumber(item.raw?.currentDividendYield)) {
    const value = Number(item.raw.currentDividendYield);
    return { value, label: `股息 ${value.toFixed(2)}%` };
  }
  if (market === "gold") {
    const gold = item.raw || {};
    const answer = gold.answer || {};
    const international = gold.quotes?.international || {};
    if (item.id === "track") {
      if (hasNumber(answer.score)) {
        return { value: Number(answer.score), label: `观察分 ${Number(answer.score)}` };
      }
      if (hasNumber(international.percentile180)) {
        return { value: Number(international.percentile180), label: `半年位置 ${Number(international.percentile180)}%` };
      }
    }
    if (item.id === "plan") {
      const plan = answer.pricePlan || {};
      const buy = Number(plan.internationalWatch?.low || plan.internationalWatch?.high || 0);
      const sell = Number(plan.internationalUpper?.low || plan.internationalUpper?.high || 0);
      if (sell > 0) return { value: sell, label: `观察上沿 ${sell}` };
      if (buy > 0) return { value: buy, label: `观察低位 ${buy}` };
      if (hasNumber(international.price)) {
        return { value: Number(international.price), label: `国际金 ${Number(international.price).toFixed(0)}` };
      }
    }
  }
  if (market === "guru") {
    const value = performanceNumber(item.raw?.profile?.performanceValue);
    if (value > 0) {
      // performanceValue 本身就带「年化」二字（"13.2% 年化"、"约 7.6% 年化"），
      // 直接拼进 `表观年化 ${...}` 会读成"表观年化 13.2% 年化"。按解析出来的数
      // 重新写一遍，「约」这个不确定标记要留着，它是原文本来的意思。
      const approx = /约/.test(String(item.raw.profile.performanceValue)) ? "约 " : "";
      return { value, label: `表观年化 ${approx}${value.toFixed(1)}%` };
    }
    const weight = Number(item.raw?.holdings?.[0]?.weight);
    if (Number.isFinite(weight) && weight > 0) {
      return { value: weight, label: `头号仓 ${weight.toFixed(1)}%` };
    }
    return null;
  }
  if (market === "hk" && hasNumber(item.outcomeValue)) {
    const value = Number(item.outcomeValue);
    return { value: Math.abs(value), label: item.scoreText, tone: value < 0 ? "down" : "up" };
  }
  if (hasNumber(item.score) && Number(item.score) > 0) {
    return { value: Number(item.score), label: `${Number(item.score)} 分` };
  }
  return null;
}

// 行里那一句事实，位置和新闻资讯页的 .news-row-body 一样，做的也是同一件事：
// 一句只属于这一条的话。
//
// item.one 是给首页那种「一行说完」的场景写的，把结论、关键数字全塞在一起。
// 搬进明细页的行里就重复了——徽章已经说过结论、右上角已经说过关键数字，再原样
// 铺一遍，同一个数字会在一行里出现两次，读的人以为是两个数。所以这里按"已经
// 显示过什么"把重复的段落摘掉，留下的才是这一行独有的事实。
//
// 注意这个函数只做减法：它不会拼出任何 one 里原本没有的内容。
function rowFact(item, market, shown) {
  if (market === "guru") {
    // 机构这一条的 one 是 `原因：<按36字硬切>｜学法：<按28字硬切>`，两半都切在
    // 词中间（"不要只因"、"复制前先剔"）。行里只放"原因"，用完整原文让它自然
    // 折行；"学法"在详情页有完整版，不该在这里露半句。
    return String(item.raw?.profile?.why || "").trim();
  }
  const parts = String(item.one || "").split(" · ").map((part) => part.trim()).filter(Boolean);
  return parts
    .filter((part) => {
      if (shown.badge && part === shown.badge) return false;
      // 右上角写的是「今日 +3.2%」时，one 里那个 +3.21% 是同一件事的另一个小数位。
      if (shown.dropChange && /^[+-]\d/.test(part)) return false;
      // 右上角那句本身就原样出现在 one 里（港股已结束那条的「首日 -1.87%」
      // 两边一字不差），行里不该再抄一遍。
      if (shown.metricLabel && part === shown.metricLabel) return false;
      // 观察分已经作为独立的分数标签显示过。只掐掉一模一样的那个数，
      // 黄金的「国际金观察分 77」是另一个分，不能顺手带走。
      if (shown.score != null && part === `观察分 ${shown.score}`) return false;
      // 光秃秃一个百分数（A股那条 one 开头的 "6.4%"）如果和右上角的对比数值
      // 是同一个值，只是小数位不同，也算说过了。
      if (shown.metricPercent != null && /^\d+(?:\.\d+)?%$/.test(part)) {
        if (Number(part.replace("%", "")).toFixed(1) === shown.metricPercent) return false;
      }
      return true;
    })
    .join(" · ");
}

function barScaleMax(comparable) {
  const values = comparable
    .map((item) => Number(item?.value || 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!values.length) return 0;
  const percentile = values[Math.min(values.length - 1, Math.floor(values.length * 0.75))];
  return Math.max(percentile, values[values.length - 1] / 3, 1);
}

Page({
  data: {
    market: "hk",
    group: "worth",
    meta: MARKET_META.hk,
    title: "资料列表",
    groups: [],
    filters: [],
    items: [],
    source: "正在读取同步数据",
    freshness: freshnessBanner("正在读取同步数据", "fresh"),
    disclaimer: RESEARCH_DISCLAIMER,
    groupHelp: "",
    statsBanner: null,
    sourceLinks: [],
    dataAsOf: "",
    // 重合持仓的持有人明细。原来走 wx.showModal，但那个控件会把 content 里的
    // 换行当空格吞掉，五六家机构会连成一行——和栏目页的展开层同一套写法。
    holderSheet: null,
  },
  onLoad(options) {
    const market = MARKET_META[options.market] ? options.market : "hk";
    const defaultGroup = market === "a" ? "prime" : market === "gold" ? "track" : market === "us" ? "seven" : "worth";
    this.setData({ market, group: options.group || defaultGroup, meta: MARKET_META[market] });
    this.refresh();
  },
  onPullDownRefresh() { this.refresh(() => wx.stopPullDownRefresh(), true); },
  retryFreshness() { this.refresh(null, true); },
  refresh(done, force = false) {
    loadSnapshot((snapshot, source, meta = {}) => {
      const definitions = groupDefinitions(snapshot, this.data.market).filter((item) => item.count > 0);
      const group = definitions.find((item) => item.id === this.data.group) || definitions[0];
      const activeGroup = group ? group.id : this.data.group;
      const rawItems = allItems(snapshot, this.data.market)
        .filter((item) => matchesGroup(item, activeGroup))
        // 分组自带名次时（A股两个「前五」榜）按名次排。行里那个 01–05 的序号
        // 是照顺序生成的，顺序不对序号就是假的。没名次的分组保持原顺序不动。
        .sort((left, right) => {
          const l = left.lensRank && left.lensRank[activeGroup];
          const r = right.lensRank && right.lensRank[activeGroup];
          if (l == null && r == null) return 0;
          if (l == null) return 1;
          if (r == null) return -1;
          return l - r;
        });
      const comparable = rawItems.map((item) => comparisonMetric(item, this.data.market));
      const maxValue = barScaleMax(comparable);
      const market = this.data.market;
      // 页头写着「七姐妹」、筛选条写着「七姐妹 7」，行里的徽章再写一遍「七姐妹」，
      // 同一个词在一屏上出现三次。只有一字不差的时候才收起来——徽章换个说法
      // （港股在「已结束」组里写的是「申购已结束」）就还是有信息，得留着。
      const groupTitle = group ? String(group.title || "").trim() : "";
      const items = rawItems.map((item, index) => {
        const visual = comparable[index];
        const scored = scoreForItem(item);
        const strategy = buildStrategySignal(item, { evidence: strategyEvidence });
        // 0 分是"这条没打分"的占位，不是"研究下来给 0 分"。港股已结束的那些
        // 条目 publicAnswer.score 就是 0，照直写成「研究分 0」等于替它下了个
        // 根本没做过的结论。详情页早就是这么处理的（`item.score > 0` 才写分数），
        // 明细页跟上。
        const scoreLabel = scored.score != null && Number(scored.score) > 0
          ? `${scored.label} ${scored.score}`
          : "";
        const holdings = Array.isArray(item.raw?.holdings) ? item.raw.holdings.length : 0;

        // 机构持仓这一栏，徽章本身就是「13.2% 年化」。右上角再写一遍「表观年化
        // 13.2%」、底下再画一条同样按年化算长度的对比条，等于同一个数在一行里
        // 说三遍。这里只留徽章，右上角换成持仓只数，对比条不画——这一栏本来就是
        // 按年化排的序，位置本身已经把高低说清楚了。
        const metricLabel = market === "guru"
          ? (holdings > 0 ? `${holdings} 只持仓` : "")
          : (visual?.label || "");

        // 观察分和对比数值指着同一个数的情况（港股「研究分 77」对「77 分」、
        // 黄金「综合观察分 67」对「观察分 67」），只留带完整标签的那一个。
        const sameNumber = Boolean(
          scoreLabel
          && metricLabel
          && metricLabel.indexOf("分") >= 0
          && leadingNumber(scoreLabel) !== null
          && leadingNumber(scoreLabel) === leadingNumber(metricLabel),
        );
        const showMetric = Boolean(metricLabel) && !sameNumber;
        // 对比条画的是右上角那个数在本组里的相对高低。右上角要是没在写这个数，
        // 条就不画——一条没人解释的横杠只会让人猜。
        const showBar = Boolean(visual && maxValue > 0)
          && market !== "guru"
          && (showMetric || sameNumber);
        const metricPercent = /^[^\d+-]*[+-]?\d+(?:\.\d+)?%/.test(metricLabel)
          ? Number(metricLabel.match(/[+-]?\d+(?:\.\d+)?/)[0]).toFixed(1)
          : null;

        return {
          id: item.id,
          name: item.name,
          shortName: item.raw?.shortName || shortCompanyName(item.name, item.code || "标的", 8),
          code: item.code,
          badge: String(item.badge || "").trim() === groupTitle ? "" : item.badge,
          badgeTone: market,
          badgeSentiment: badgeSentimentFor(market, item.group),
          position: index + 1,
          positionLabel: String(index + 1).padStart(2, "0"),
          researchScore: scored.score,
          researchScoreLabel: scoreLabel,
          metricLabel: showMetric ? metricLabel : "",
          metricTone: visual?.tone || "",
          showBar,
          barTone: visual?.tone || "",
          barWidth: showBar
            ? Math.min(100, Math.max(12, Math.round((visual.value / maxValue) * 100)))
            : 0,
          fact: rowFact(item, market, {
            badge: item.badge,
            score: scored.score,
            dropChange: metricLabel.indexOf("今日") === 0,
            metricLabel,
            metricPercent,
          }),
          strategyLabel: strategy.label,
          strategyTone: strategy.tone,
          strategyLine: strategy.action,
          // 「交叉重叠」那几条点开是弹窗不是详情页，弹窗内容要用到这个字段。
          overlap: item.raw?.overlap || null,
        };
      });
      let groupHelp = group ? group.one : "";
      let statsBanner = null;
      if (this.data.market === "hk" && activeGroup === "ended") {
        const stats = buildHkHistoryStats(snapshot);
        const industries = buildHkIndustryStats(snapshot).slice(0, 2);
        const sponsors = buildHkSponsorStats(snapshot).slice(0, 1);
        const extra = [
          industries.length ? `行业样本 ${industries.map((item) => `${item.name} ${item.sampleCount}只`).join(" · ")}` : "",
          sponsors.length ? `保荐人 ${sponsors[0].name} 样本 ${sponsors[0].sampleCount}只` : "",
        ].filter(Boolean).join(" · ");
        groupHelp = extra ? `${stats.summary} · ${extra}` : stats.summary;
        statsBanner = {
          title: "历史样本对照",
          body: `暗盘上涨 ${stats.greyWinRate} · 首日上涨 ${stats.firstDayWinRate} · 暗盘→首日同向 ${stats.greyToFirstDirection}`,
          note: stats.disclaimer,
        };
      } else if (activeGroup === "hot10") {
        statsBanner = {
          title: "热度观察榜算法",
          body: "按公开热度分从高到低排序；热度只反映关注度，不代表未来涨幅。",
          note: "研究观察，不构成买卖建议。",
        };
      } else if (activeGroup === "value") {
        statsBanner = {
          title: "性价比观察指数",
          body: "盈利质量 50% · 估值 30% · 热度 15% · 近周变动 5%；分数用于横向比较。",
          note: "研究排序，不是收益承诺或买入信号。",
        };
      } else if (activeGroup === "overlap") {
        statsBanner = {
          title: "交叉重叠研究工具",
          body: "统计 11 个可核验机构组合中共同出现的标的；重叠只表示公开披露一致，不是买入推荐。",
          note: "报告期存在滞后，不构成实时交易信号。",
        };
      } else if (activeGroup === "cheap7") {
        statsBanner = {
          title: "低估七姐妹",
          body: "质量门通过，且市盈率不高于七姐妹中位、近60日位置未过热。",
          note: "相对不便宜不等于低估到该买；研究观察，不是买入信号。",
        };
      } else if (activeGroup === "risk7") {
        statsBanner = {
          title: "风险七姐妹",
          body: "估值过高、近60日位置过热，或盈利质量与价格冲突。",
          note: "风险升高是观察分档，不是自动卖出指令。",
        };
      } else if (activeGroup === "hold7") {
        statsBanner = {
          title: "长期观察七姐妹",
          body: "营收、利润率、股东回报或经营现金流等质量门通过，且未触发重大风险分档。",
          note: "可作长期样本，不等于现在加仓。",
        };
      } else if (activeGroup === "industry") {
        statsBanner = {
          title: "行业公司观察",
          body: "从非七姐妹样本里筛质量与研究观察分同时过关的公司。",
          note: "行业观察榜不是买入清单。",
        };
      } else if (activeGroup === "core") {
        statsBanner = {
          title: "底仓长期",
          body: "水电、银行、通信、家电、红利ETF 等现金流角色，适合作为收息底仓样本。",
          note: "角色分类来自行业与质量，不是保证分红。",
        };
      } else if (activeGroup === "cycle") {
        statsBanner = {
          title: "周期短持",
          body: "煤炭、油气、钢铁、建材、火电等景气敏感样本，只作短持观察。",
          note: "高息往往来自商品价格，股息可能随景气消失。",
        };
      } else if (activeGroup === "add") {
        statsBanner = {
          title: "加大观察",
          body: "按当前每股分红回推到更高股息率后的价格区；现价已进入该区才出现在本列表。",
          note: "观察价不是保证买点。",
        };
      } else if (activeGroup === "trim") {
        statsBanner = {
          title: "兑现观察",
          body: "价格上涨把股息率压到可持续股息之下时，进入兑现观察。",
          note: "观察价不是自动卖出指令。",
        };
      } else if (activeGroup === "leverage") {
        statsBanner = {
          title: "高杠杆观察",
          body: "仅值得打、研究分≥80、认购拥挤度不高且一手资料齐全时出现。",
          note: "默认仍是一手；十倍融资会放大破发亏损，不是指令。",
        };
      }
      this.setData({
        group: activeGroup,
        groups: definitions,
        // 页头下面那条可横滑的分组筛选条，抄新闻资讯页。
        // 机构那几个分组的标题里本来就带着数量（"港股 · 3 个"），再补一个数字会
        // 变成"港股 · 3 个 3"，所以标题里已经有这个数就不重复写。
        filters: definitions.map((entry) => ({
          id: entry.id,
          label: String(entry.title).indexOf(String(entry.count)) >= 0
            ? entry.title
            : `${entry.title} ${entry.count}`,
        })),
        title: group ? group.title : "研究明细",
        groupHelp,
        statsBanner,
        items,
        source,
        freshness: freshnessBanner(source, meta.kind),
        // 这一屏罗列的是别人家的公开数据，得让人能一路查到底。新闻资讯页每条都挂
        // 了官方出处，栏目页也补上了，明细页不该是中间那段查不了的断点。
        sourceLinks: marketSources(snapshot, this.data.market),
        dataAsOf: asOfText(snapshot && snapshot.updatedAt, meta.kind),
      });
      wx.setNavigationBarTitle({ title: group ? group.title : "研究明细" });
    }, done, { force });
  },
  // 分组切换。原来换一个分组得先退回上一页再点进来，现在和新闻资讯页的筛选条
  // 一样就地切换。切完把页面滚回顶部，否则会停在上一组的滚动位置上，
  // 看起来像是没换成。
  selectGroup(event) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || id === this.data.group) return;
    track("list_group_switch", { market: String(this.data.market || ""), group: id });
    this.setData({ group: id }, () => {
      this.refresh();
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    });
  },
  openItem(event) {
    const id = event.currentTarget.dataset.id;
    if (String(id || "").startsWith("overlap-")) {
      const item = (this.data.items || []).find((row) => row.id === id);
      // 这里原来读的是 row.raw.overlap，但列表行里从来没有 raw 字段，
      // 于是弹窗永远出不来，点一下会跳去一个不存在的详情页。
      const overlap = item?.overlap;
      if (overlap) {
        this.setData({
          holderSheet: {
            title: `${overlap.name} · ${overlap.symbol}`,
            rows: overlap.holders.map((holder, index) => ({
              key: `holder-${index}`,
              name: holder.name,
              market: holder.market,
              weight: holder.weight,
            })),
          },
        });
        return;
      }
    }
    wx.navigateTo({ url: `/pages/detail/index?market=${this.data.market}&id=${encodeURIComponent(id)}` });
  },
  // 遮罩点空白处关，正文里点字不关：catchtap 得有个真方法接住冒泡。
  noop() {},
  closeHolderSheet() {
    this.setData({ holderSheet: null });
  },
  // 和新闻资讯页同一套交互：小程序打不开任意外链，来源只能复制出去自己核对。
  copySourceLink(event) {
    const url = String(event.currentTarget.dataset.url || "");
    if (!url) return;
    track("news_source_copy", { market: String(this.data.market || "") });
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "已复制来源链接", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  goBack() { wx.navigateBack({ fail: () => goHome() }); },
  goHome() { goHome(); },
  onShareAppMessage() {
    track("share_tap", { page: "list" });
    return { title: `${this.data.title}｜望潮 Aurum`, path: `/pages/list/index?market=${this.data.market}&group=${this.data.group}` };
  },
});
