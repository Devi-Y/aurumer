export function validUSActionReference(stock) {
  if (stock?.actionsFresh === false) {
    return Number.isFinite(stock.price) && stock.price > 0
      && Number.isFinite(Date.parse(stock.asOf || ""))
      && Boolean(stock.actionNote)
      && !stock.technicalPlan && !stock.pricePlan;
  }
  return Number.isFinite(stock?.technicalPlan?.buy)
    && Number.isFinite(stock?.technicalPlan?.stop)
    && Array.isArray(stock?.technicalPlan?.tp)
    && stock.technicalPlan.tp.length >= 2;
}
