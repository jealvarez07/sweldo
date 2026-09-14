# Sweldo Check — payslip decoder

Static page + one pure function + one insert-only table.
No accounts. No personal data. Nothing that can be traced to a person.

## Run

    npm test          # 111 assertions
    npx serve .       # the page uses ES modules, so file:// will not work

## Files

    index.html                 the page
    lib/payroll.js             the engine — pure, zero dependencies. THE ASSET.
    lib/payroll.test.js        regression suite
    lib/events.js              anonymous event recording + the rotated question
    rates/2026.json            versioned by effective date
    sql/001_decoder_events.sql the table. Run once in the Supabase SQL editor.
    VERIFY.md                  what you must check before shipping

## Wiring up events (5 minutes)

1. Run `sql/001_decoder_events.sql` in the Supabase SQL editor.
2. Put your project URL and anon key in `CONFIG` at the top of `lib/events.js`.

Until you do, every call is a no-op that logs the row it *would* have sent to
the console. The page works identically unconfigured.

The anon key is meant to be public — RLS is what protects the table. There is
no SELECT policy, so that key cannot read a single row.

## What leaves the device

Salary rounded to the nearest 100, the pay period, the mode, the rate-table
version, the referring host, one optional survey answer, and two derived
booleans about return visits.

## What never leaves the device

Any identifier. No user id, no session token, no fingerprint, no user agent,
no full URL. The first-visit date lives in localStorage and stays there —
only `is_return` and `days_since_first` travel, so two rows can never be
linked to each other.

Caveat worth knowing: this table holds no IP, but Supabase's own edge logs do,
for their retention window. The page says "we don't store it", which is true
of your database. Do not claim more than that.

## The one metric

    select
      date_trunc('week', created_at) as week,
      count(*)                          as events,
      count(*) filter (where is_return) as returns,
      round(100.0 * count(*) filter (where is_return) / nullif(count(*),0), 1) as pct
    from public.decoder_events
    group by 1 order by 1 desc;

Above 15% return within 30 days and the app has a foundation.
Under 5% and you have built a very good article — which is still worth having.

## Before you ship

Read VERIFY.md. Every rate group is flagged `"verify": false` and eight test
assertions are marked PENDING-VERIFY. The engine is correct with respect to
the rate table; the rate table has not been checked against a primary source.

Cross-check on 13 Sep 2026 against five public PH calculators: two agree with
this engine exactly, two are wrong (one halves Pag-IBIG, one taxes ₱25,000 at
zero), one was unreadable.

## Not covered in v1

Government employees (GSIS), contractual/talent-fee workers, daily and weekly
pay, allowances split from basic. Each produces an honest "we don't handle
this yet" rather than a wrong number.

## Next

1. Verify the rates. Three real payslips.
2. Share-as-image.
3. Wire the `?income=` param on IponPal's side, then the 3-hour strip.
