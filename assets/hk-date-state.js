// Generated from miniprogram/utils/hk-date-state.js.
(function () {
function dateOnly(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : null;
}

function hkDateState(item) {
  if (item?.historical || item?.allotmentUrl || item?.withdrawn) return { ok: true };
  const start = dateOnly(item?.offerStart);
  const deadline = dateOnly(item?.offerDeadline || item?.offerEnd);
  const listing = dateOnly(item?.listingDate);
  if (item?.dateValidation?.status === "unverified") return { ok: false, reason: item.dateValidation.reason || "招股日期待核" };
  if (!start || !deadline || !listing) return { ok: false, reason: "招股开始、截止或上市日期待核" };
  if (start > deadline || deadline >= listing) return { ok: false, reason: "申购截止与上市日期顺序冲突，日期待核" };
  return { ok: true };
}

function guardHKDates(item) {
  const state = hkDateState(item);
  if (state.ok) return item;
  return {
    ...item,
    unverifiedDates: item.unverifiedDates || { offerStart: item.offerStart, offerDeadline: item.offerDeadline || item.offerEnd, listingDate: item.listingDate },
    offerStart: null, offerDeadline: null, offerEnd: null, listingDate: null,
    offerStartAt: null, offerDeadlineAt: null, listingDateAt: null,
    actionsFresh: false,
    dateValidation: { ...item.dateValidation, status: "unverified", reason: state.reason },
    publicAnswer: { verdict: "待核验", action: "招股日期待核，暂不提供申购判断或倒计时。", score: null },
  };
}

globalThis.AurumHKDates = { hkDateState, guardHKDates };

})();
