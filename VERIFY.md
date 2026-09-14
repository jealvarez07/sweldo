# Verification checklist — do this before shipping

The engine is correct with respect to the rate table. **The rate table has not been
checked against a primary source.** Every group below is flagged `"verify": false`
in `rates/2026.json`. Flip each to `true` only after you have the official document
open in front of you.

This is the part only you can do. It is also the moat.

---

## 1. Withholding tax table — HIGHEST RISK

**Source:** BIR Revised Withholding Tax Table (TRAIN, effective 2023 onward)

The engine uses the **published period brackets**, not annual brackets divided by 12.
That decision matters: it is what payroll systems do, so it is what will match a real
payslip. But it means the exact published boundaries and base amounts must be right.

Check every value in `withholding.monthly` and `withholding.semiMonthly`:

| Needs checking | Value in the table |
|---|---|
| Monthly bracket boundaries | 20,833 / 33,333 / 66,667 / 166,667 / 666,667 |
| Monthly base amounts | 0 / 0 / 1,875.00 / 8,541.80 / 33,541.80 / 183,541.80 |
| Semi-monthly boundaries | 10,417 / 16,667 / 33,333 / 83,333 / 333,333 |
| Semi-monthly base amounts | 0 / 0 / 937.50 / 4,270.70 / 16,770.70 / 91,770.70 |

The odd `.80` and `.70` endings are how the BIR rounds. If the official table says
something different, **the table is right and this file is wrong.**

Also confirm the bracket convention: the engine treats each as *"over X, up to and
including Y"*. If the BIR intends *"X and over"*, every boundary case shifts by one
centavo.

## 2. SSS

**Source:** current SSS contribution schedule

- [ ] Employee share is 5% of MSC (15% total, 10% employer)
- [ ] MSC floor — the table says **5,000**. Some 2026 summaries say 4,000. Resolve this.
- [ ] MSC ceiling is 35,000
- [ ] MSC steps in 500 increments
- [ ] **Confirm the stepping rule.** The engine rounds to the nearest 500. The real
      schedule is a range table (e.g. "24,750–25,249.99 → MSC 25,000"). If the ranges
      are not centred on the step, replace `sssMSC()` with a lookup table.
- [ ] MPF: above MSC 20,000 the excess routes to the provident fund. The employee's
      total 5% is unchanged, so the decoder is unaffected — but confirm that.

## 3. PhilHealth

**Source:** UHC Act premium schedule for 2026

- [ ] Premium rate is 5%, split equally, so 2.5% employee
- [ ] Income floor 10,000, ceiling 100,000
- [ ] Confirm the rate was not suspended or deferred for 2026 — this has happened before

## 4. Pag-IBIG

**Source:** HDMF contribution schedule

- [ ] 1% for monthly compensation of 1,500 and below
- [ ] 2% above that
- [ ] Compensation capped at 10,000, so the employee share maxes at 200
- [ ] Confirm whether the fund salary cap has moved — a rise to 5,000 max contribution
      has been discussed

## 5. Minimum wage exemption

- [ ] Statutory minimum wage earners are exempt from income tax on basic pay, holiday
      pay, overtime, night differential and hazard pay
- [ ] Decide whether v1 asks the user, or infers from regional wage orders (17 of them,
      and the NCR rate is currently under injunction — asking is safer)

## 6. The eight pending expected values

Run `npm test`. Eight assertions are marked `[PENDING-VERIFY]`. Each is a net or tax
figure the code produced and I reasoned through — **none has been checked against a
real payslip.**

Get three actual payslips at different salary levels. Enter the gross. If the net does
not match to the centavo, find out why before writing any interface.

---

## What the suite already proves

111 assertions pass, covering every boundary: contribution floors and ceilings, the SSS
stepping behaviour, all six tax brackets and their exact edges, the minimum wage
exemption, semi-monthly splitting, reverse computation, and the guards.

It also caught one real bug during the build: at zero gross the statutory floors were
being applied, producing a **negative net of −₱500**. That is now fixed and tested,
and the floors surface as warnings instead of silently distorting small salaries.

## Known simplifications in v1

- Contributions are computed on basic salary only. Allowances are added to take-home
  but excluded from the contribution base. Real practice varies by employer.
- Government employees (GSIS) are not modelled at all.
- Contractual and talent-fee workers (expanded withholding, no contributions) are not
  modelled.
- Daily and weekly pay frequencies are not modelled.

Each of these must produce an honest *"we don't handle this yet"* in the interface.
**A correct refusal beats a wrong number.**
