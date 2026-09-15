/**
 * payroll.js — Philippine payroll computation.
 *
 * Pure functions. Zero dependencies. Works identically in Node and the browser.
 * Nothing here touches the DOM, the network, or global state.
 *
 * MONEY IS HANDLED IN CENTAVOS (integers) INTERNALLY.
 * Floating point pesos accumulate error; centavo integers do not. Every public
 * function takes and returns pesos as numbers, and converts at the boundary.
 *
 * All rates come from a versioned rate table keyed by effective date. Nothing
 * in this file hardcodes a rate — when the BIR or SSS moves a number, the JSON
 * changes and this file does not.
 */

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** Pesos (float) -> centavos (integer). Half-up at the centavo. */
export function toCentavos(pesos) {
  if (!Number.isFinite(pesos)) throw new TypeError('toCentavos: not a finite number');
  // The +Number.EPSILON nudge avoids 1.005 -> 100 instead of 101.
  return Math.round((pesos + Number.EPSILON) * 100);
}

/** Centavos (integer) -> pesos (float, 2dp). */
export function toPesos(centavos) {
  return Math.round(centavos) / 100;
}

/** Apply a rate to a centavo amount, rounding half-up to the centavo. */
function applyRate(centavos, rate) {
  return Math.round(centavos * rate);
}

/** Clamp helper. */
function clamp(n, lo, hi) {
  if (lo != null && n < lo) return lo;
  if (hi != null && n > hi) return hi;
  return n;
}

/* ------------------------------------------------------------------ */
/* Statutory contributions                                             */
/* ------------------------------------------------------------------ */

/**
 * SSS Monthly Salary Credit.
 *
 * The MSC is a STEPPED bracket, not a percentage of salary. A salary of
 * 25,300 does not produce an MSC of 25,300 — it is mapped to the nearest
 * step. Getting this wrong is the single most common error in Philippine
 * payroll calculators.
 *
 * @param {number} monthlySalaryC monthly salary in centavos
 * @returns {number} MSC in centavos
 */
export function sssMSC(monthlySalaryC, rates) {
  const { mscMin, mscMax, mscStep } = rates.sss;
  const stepC = toCentavos(mscStep);
  const minC = toCentavos(mscMin);
  const maxC = toCentavos(mscMax);

  if (monthlySalaryC <= minC) return minC;
  if (monthlySalaryC >= maxC) return maxC;

  // Round to the nearest step.
  const stepped = Math.round(monthlySalaryC / stepC) * stepC;
  return clamp(stepped, minC, maxC);
}

/**
 * SSS employee share.
 * Always computed on the MSC, never on raw salary.
 */
export function sssEmployee(monthlySalaryC, rates) {
  const msc = sssMSC(monthlySalaryC, rates);
  return applyRate(msc, rates.sss.employeeRate);
}

/**
 * PhilHealth employee share.
 * Continuous (not stepped), computed on salary clamped to floor/ceiling.
 */
export function philhealthEmployee(monthlySalaryC, rates) {
  const base = clamp(
    monthlySalaryC,
    toCentavos(rates.philhealth.floor),
    toCentavos(rates.philhealth.ceiling)
  );
  return applyRate(base, rates.philhealth.employeeRate);
}

/**
 * Pag-IBIG employee share.
 * 1% at or below the low-rate ceiling, 2% above.
 * Compensation is capped, so the employee share tops out at 200.
 */
export function pagibigEmployee(monthlySalaryC, rates) {
  const { lowRate, lowRateCeiling, standardRate, salaryCap } = rates.pagibig;
  const capped = clamp(monthlySalaryC, null, toCentavos(salaryCap));
  const rate = monthlySalaryC <= toCentavos(lowRateCeiling) ? lowRate : standardRate;
  return applyRate(capped, rate);
}

/* ------------------------------------------------------------------ */
/* Withholding tax                                                     */
/* ------------------------------------------------------------------ */

/**
 * Withholding tax for one pay period.
 *
 * Uses the BIR's PUBLISHED period table, not annual brackets divided by the
 * period count. The BIR rounds its boundaries and base amounts, and payroll
 * systems use the published figures — so annual/12 produces centavo-level
 * differences from a real payslip. Users will hold our output next to theirs.
 *
 * @param {number} taxableC taxable compensation for the period, in centavos
 * @param {'monthly'|'semiMonthly'|'annual'} period
 */
export function withholdingTax(taxableC, period, rates) {
  const table = rates.withholding[period];
  if (!table) throw new RangeError(`withholdingTax: no table for period "${period}"`);

  for (const bracket of table) {
    const overC = toCentavos(bracket.over);
    const upToC = bracket.upTo == null ? Infinity : toCentavos(bracket.upTo);

    // Brackets are "over X, up to and including Y".
    if (taxableC > overC && taxableC <= upToC) {
      return toCentavos(bracket.base) + applyRate(taxableC - overC, bracket.rate);
    }
  }

  // Below the first bracket's floor, or exactly zero.
  return 0;
}

/* ------------------------------------------------------------------ */
/* The main computation                                                */
/* ------------------------------------------------------------------ */

/**
 * Compute a full payslip breakdown.
 *
 * @param {object} input
 * @param {number} input.gross            gross pay for the period, in pesos
 * @param {'monthly'|'semiMonthly'} [input.period='monthly']
 * @param {number} [input.nonTaxableAllowances=0]
 *        Allowances within de minimis ceilings. Added to take-home, excluded
 *        from both the contribution base and taxable income. v1 simplification:
 *        contributions are computed on basic salary only.
 * @param {boolean} [input.isMinimumWageEarner=false]
 *        Statutory minimum wage earners are exempt from income tax on basic pay.
 * @param {object} rates a versioned rate table
 * @returns {object} breakdown with every line in pesos
 */
export function computePayroll(input, rates) {
  const {
    // `basic` is the preferred name. `gross` is kept as an alias so every
    // existing caller — and every existing test — keeps working unchanged.
    basic,
    gross,
    period = 'monthly',
    taxableAllowance = 0,
    // `nonTaxableAllowances` (plural) is the original name; both accepted.
    nonTaxableAllowance,
    nonTaxableAllowances = 0,
    isMinimumWageEarner = false,
    // Which pay the statutory contributions are assessed on.
    //   'basic'    — basic pay only. PhilHealth is explicit about this, and it
    //                is what most Philippine payroll systems do.
    //   'withTaxableAllowance' — basic plus the taxable allowance. Some
    //                employers treat a fixed, unliquidated allowance as part of
    //                compensation for SSS purposes.
    // Employers genuinely differ. The default is the common case; the switch
    // exists so a payslip that disagrees can be reproduced instead of argued
    // with.
    contributionBase = 'basic',
  } = input;

  const basicPay = basic != null ? basic : gross;
  const nonTaxPay = nonTaxableAllowance != null ? nonTaxableAllowance : nonTaxableAllowances;

  if (!Number.isFinite(basicPay) || basicPay < 0) {
    throw new RangeError('computePayroll: basic must be a non-negative number');
  }
  if (!Number.isFinite(taxableAllowance) || taxableAllowance < 0) {
    throw new RangeError('computePayroll: taxableAllowance must be a non-negative number');
  }
  if (!Number.isFinite(nonTaxPay) || nonTaxPay < 0) {
    throw new RangeError('computePayroll: nonTaxableAllowance must be a non-negative number');
  }
  if (period !== 'monthly' && period !== 'semiMonthly') {
    throw new RangeError(`computePayroll: unsupported period "${period}"`);
  }
  if (contributionBase !== 'basic' && contributionBase !== 'withTaxableAllowance') {
    throw new RangeError(`computePayroll: unsupported contributionBase "${contributionBase}"`);
  }

  const basicC = toCentavos(basicPay);
  const taxAllowC = toCentavos(taxableAllowance);
  const allowancesC = toCentavos(nonTaxPay);

  // The number the money actually adds up to before anything is taken.
  const grossC = basicC + taxAllowC + allowancesC;
  // The base the contributions are assessed on.
  const contribBaseC = contributionBase === 'withTaxableAllowance'
    ? basicC + taxAllowC
    : basicC;
  const warnings = [];

  // No pay, no employment, no contributions. Without this the statutory
  // FLOORS (SSS MSC 5,000 and PhilHealth 10,000) would be applied to a salary
  // of zero and produce a negative net — found by the test suite, not by luck.
  if (contribBaseC === 0) {
    return emptyResult(period, taxAllowC, allowancesC, rates);
  }

  // Contributions are always assessed on a MONTHLY basis. For a semi-monthly
  // payslip the monthly contribution is split across the two periods.
  const monthlyEquivalentC = period === 'semiMonthly' ? contribBaseC * 2 : contribBaseC;

  // Surface the floors rather than letting them silently distort a small
  // salary. A part-timer or daily-rate earner who lands here has almost
  // certainly entered something v1 does not model.
  if (monthlyEquivalentC < toCentavos(rates.philhealth.floor)) {
    warnings.push({
      code: 'philhealth_floor',
      message: `PhilHealth uses the ₱${rates.philhealth.floor.toLocaleString()} minimum here, not your real pay.`,
    });
  }
  if (monthlyEquivalentC < toCentavos(rates.sss.mscMin)) {
    warnings.push({
      code: 'sss_floor',
      message: `SSS uses the ₱${rates.sss.mscMin.toLocaleString()} minimum salary credit here, not your real pay.`,
    });
  }

  const sssMonthlyC = sssEmployee(monthlyEquivalentC, rates);
  const phMonthlyC = philhealthEmployee(monthlyEquivalentC, rates);
  const piMonthlyC = pagibigEmployee(monthlyEquivalentC, rates);

  const divisor = period === 'semiMonthly' ? 2 : 1;
  const sssC = Math.round(sssMonthlyC / divisor);
  const phC = Math.round(phMonthlyC / divisor);
  const piC = Math.round(piMonthlyC / divisor);

  const contributionsC = sssC + phC + piC;

  // Taxable compensation. The non-taxable allowance never enters this line —
  // that is the whole point of it. The taxable allowance always does.
  const taxableC = Math.max(0, basicC + taxAllowC - contributionsC);

  const taxC = isMinimumWageEarner ? 0 : withholdingTax(taxableC, period, rates);

  const netC = grossC - contributionsC - taxC;
  const deductionsC = contributionsC + taxC;

  if (allowancesC > 0) {
    warnings.push({
      code: 'allowance_assumptions',
      message: 'We assume your tax-free allowance is within the legal limit. Anything above the limit is taxed, and counts against the ₱90,000 a year for 13th month pay and other benefits.',
    });
  }
  if (taxAllowC > 0 && contributionBase === 'basic') {
    warnings.push({
      code: 'contribution_base',
      message: 'SSS, PhilHealth and Pag-IBIG here are based on basic pay only. Some employers count allowances too, which makes SSS a little higher.',
    });
  }

  if (deductionsC > grossC) {
    warnings.push({
      code: 'deductions_exceed_gross',
      message: 'The deductions come to more than the pay. Check the amount, or this may be a pay type we do not handle yet.',
    });
  }

  return {
    period,
    warnings,
    gross: toPesos(grossC),
    basic: toPesos(basicC),
    taxableAllowance: toPesos(taxAllowC),
    nonTaxableAllowance: toPesos(allowancesC),
    nonTaxableAllowances: toPesos(allowancesC),   // legacy name, same value
    contributions: {
      sss: toPesos(sssC),
      philhealth: toPesos(phC),
      pagibig: toPesos(piC),
      total: toPesos(contributionsC),
    },
    taxableIncome: toPesos(taxableC),
    withholdingTax: toPesos(taxC),
    totalDeductions: toPesos(deductionsC),
    net: toPesos(netC),
    // The emotional payload: what vanished between the number they were
    // promised and the number that lands.
    whereItWent: toPesos(deductionsC),
    deductionRate: grossC === 0 ? 0 : Math.round((deductionsC / grossC) * 10000) / 100,
    meta: {
      ratesEffective: rates.effective,
      isMinimumWageEarner,
      contributionBase,
      contributionBaseAmount: toPesos(contribBaseC),
      sssMSC: toPesos(sssMSC(monthlyEquivalentC, rates)),
      method: 'BIR published period withholding table',
    },
  };
}

/** A zero payslip. Used when gross is zero, so the statutory floors cannot bite. */
function emptyResult(period, taxAllowC, allowancesC, rates) {
  const cashC = taxAllowC + allowancesC;
  return {
    period,
    warnings: [],
    gross: toPesos(cashC),
    basic: 0,
    taxableAllowance: toPesos(taxAllowC),
    nonTaxableAllowance: toPesos(allowancesC),
    nonTaxableAllowances: toPesos(allowancesC),
    contributions: { sss: 0, philhealth: 0, pagibig: 0, total: 0 },
    taxableIncome: 0,
    withholdingTax: 0,
    totalDeductions: 0,
    net: toPesos(cashC),
    whereItWent: 0,
    deductionRate: 0,
    meta: {
      ratesEffective: rates.effective,
      isMinimumWageEarner: false,
      contributionBase: 'basic',
      contributionBaseAmount: 0,
      sssMSC: 0,
      method: 'BIR published period withholding table',
    },
  };
}

/**
 * Reverse: what gross do I need to take home a target net?
 *
 * "I want ₱25,000 to actually land — what do I ask for?" This is the salary
 * negotiation question and it cannot be solved algebraically, because the
 * contribution steps and tax brackets make the function piecewise. Binary
 * search is exact to the centavo and fast enough at this scale.
 *
 * @param {number} targetNet in pesos
 * @returns {object} the full breakdown for the gross that produces targetNet
 */
export function grossFromNet(targetNet, options, rates) {
  const { period = 'monthly', ...rest } = options || {};
  const targetC = toCentavos(targetNet);

  let lo = 0;
  let hi = toCentavos(Math.max(targetNet * 3, 10000));

  // Guard: make sure the upper bound actually overshoots.
  let guard = 0;
  while (toCentavos(computePayroll({ ...rest, basic: toPesos(hi), period }, rates).net) < targetC) {
    hi *= 2;
    if (++guard > 40) throw new RangeError('grossFromNet: no solution found');
  }

  // Binary search on centavos.
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const net = toCentavos(computePayroll({ ...rest, basic: toPesos(mid), period }, rates).net);
    if (net < targetC) lo = mid + 1;
    else hi = mid;
  }

  return computePayroll({ ...rest, basic: toPesos(lo), period }, rates);
}

/**
 * Compare two salaries. The seed of the offer-comparison feature.
 */
export function compare(a, b, rates) {
  const left = computePayroll(a, rates);
  const right = computePayroll(b, rates);
  return {
    left,
    right,
    netDifference: Math.round((right.net - left.net) * 100) / 100,
    grossDifference: Math.round((right.gross - left.gross) * 100) / 100,
  };
}
