// 黄金四口径：把同一块金子的四个报价摆在一屏，并给出它们之间唯一那条换算。
//
// 快照里其实一直躺着四个口径——COMEX（美元/盎司）、上海金 Au99.99（人民币/克）、
// GLD（美元/份）、美元兑人民币。但页面上它们是四个互不相干的数字，没人告诉读的人
// 这四个数之间是什么关系。买金的人每天真正在算的只有一件事：国内金比国际金贵还是
// 便宜、贵多少。
//
// 这条换算望潮的引擎本来就在算（指标里那条「上海金折算溢价」），这里只是把它从
// 一行埋在列表深处的数字，提到能一眼看见的位置，并且把换算式本身写出来——
// 1 金衡盎司 = 31.1035 克，这个常数是整条式子里唯一需要外部知识的地方，
// 摆出来读的人才能自己复算。
//
// 零新增数据源。四个报价缺任何一个必需项就整块不出，不用占位符凑齐一屏。

// 金衡盎司换克，国际金价与国内克价之间唯一的桥。
const TROY_OUNCE_GRAMS = 31.1035;

function isNum(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function signedPercent(value) {
  if (!isNum(value)) return "";
  const num = Number(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

/**
 * @param {object} gold 快照里的 gold 节点
 * @returns {null|object} 四口径视图；换算所需的三个价缺一就返回 null
 */
function goldParity(gold) {
  const quotes = (gold && gold.quotes) || {};
  const international = quotes.international || {};
  const domestic = quotes.domestic || {};
  const etf = quotes.etf || {};
  const usdCny = quotes.usdCny || {};
  // 折算价要国际金价和汇率两个数；再要国内价才谈得上"贵还是便宜"。
  if (!isNum(international.price) || !isNum(usdCny.price) || !isNum(domestic.price)) return null;

  const intlPrice = Number(international.price);
  const rate = Number(usdCny.price);
  const domesticPrice = Number(domestic.price);
  const parity = (intlPrice * rate) / TROY_OUNCE_GRAMS;
  const premium = ((domesticPrice - parity) / parity) * 100;
  // 0.3% 以内不下"贵/便宜"的判断：这是汇率取数时点和交易所收盘时差就能造成的量级。
  const direction = Math.abs(premium) < 0.3
    ? "基本持平"
    : (premium > 0 ? `贵 ${Math.abs(premium).toFixed(1)}%` : `便宜 ${Math.abs(premium).toFixed(1)}%`);

  return {
    parity: Number(parity.toFixed(1)),
    premium: Number(premium.toFixed(2)),
    direction,
    headline: `上海金 ${domesticPrice.toFixed(1)} 元/克，比国际金折算价 ${parity.toFixed(1)} ${direction}`,
    formula: `${intlPrice.toFixed(1)} 美元/盎司 × ${rate.toFixed(2)} ÷ ${TROY_OUNCE_GRAMS} = ${parity.toFixed(1)} 元/克`,
    cells: [
      {
        id: "intl",
        label: "COMEX 国际金",
        value: intlPrice.toFixed(1),
        unit: "美元/盎司",
        meta: signedPercent(international.changePercent),
      },
      {
        id: "parity",
        label: "折算成克价",
        value: parity.toFixed(1),
        unit: "元/克",
        meta: "按当日汇率",
      },
      {
        id: "domestic",
        label: "上海金 Au99.99",
        value: domesticPrice.toFixed(1),
        unit: "元/克",
        meta: signedPercent(domestic.changePercent),
      },
      {
        id: "etf",
        label: "GLD 黄金 ETF",
        value: isNum(etf.price) ? Number(etf.price).toFixed(1) : "—",
        unit: "美元/份",
        meta: isNum(etf.changePercent) ? signedPercent(etf.changePercent) : "",
      },
    ],
    rateText: `美元兑人民币 ${rate.toFixed(2)}`,
  };
}

module.exports = { goldParity, TROY_OUNCE_GRAMS };
