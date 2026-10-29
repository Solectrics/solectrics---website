# HEC financial scenario review — 29 October 2026

**Status:** Illustrative engineering checks only. NOT a customer quote, EECA-certified forecast, or release approval. Live HEC dollar estimates remain disabled.

## Fictional electricity-bill baseline
- Fictional summer: 430 kWh/31 days, electricity $197.86 incl GST, broadband $90 excluded.
- Fictional winter: 1,040 kWh/30 days, electricity $413.89 incl GST, broadband $90 excluded.
- Seasonally interpolated pre-solar electricity-only cost using actual bill amounts is approximately $3,516/year.
- The **separate hypothetical tariff simulation** uses 35c/kWh import, $1.50/day fixed, 8c/kWh export, each treated as a GST-inclusive or final credit amount. This gives a baseline approximately $3,488/year. These are not extracted/verified bill tariffs. The $28 difference matters and must be reconciled before customer use.

## Assumptions in `tests/hec-system-scenarios.test.mjs`
- 5 kW / 6.5 kW / 9 kW representative PV arrays; medium/large may add a single 9 kWh **nominal** battery.
- 1,250 kWh/kWp/year annual solar yield distributed using the current HEC monthly shape. Illustrative, not site validated.
- 38% of monthly generation notionally available for direct self-consumption, further limited to 50% of monthly household demand. **Monthly average heuristic, not half-hourly profiles.**
- Illustrative battery usable energy: 8 kWh **not a manufacturer rating**, 90% roundtrip efficiency, at most 55% of a usable full cycle/day and at most 30% of solar surplus into the battery.
- Household baseline demand derived from fictional summer/winter kWh and seasonal interpolation, adjusted by calendar days.
- No finance, installed prices, degradation, time-of-use pricing, export limits, battery replacement, solar curtailment, inverter efficiency, or backup reserve.

## Approximate annual outputs (NZD, hypothetical tariff)
| Option | Net annual bill | Annual bill reduction |
|---|---:|---:|
| No PV | $3,488 | — |
| 5 kW PV | $2,390 | $1,098 |
| 6.5 kW PV | $2,139 | $1,349 |
| 6.5 kW PV + illustrative 8 kWh usable from a nominal 9 kWh battery | $1,824 | $1,664 |
| 9 kW PV | $1,769 | $1,719 |
| 9 kW PV + illustrative 8 kWh usable from a nominal 9 kWh battery | $1,418 | $2,070 |

The scenario's 5 kW saving is not a replication of EECA's calculations. EECA published an Auckland typical figure of $1,246/year calculated in December 2025 for a 5 kW system with typical household consumption and electric heating/hot water: https://www.eeca.govt.nz/for-homes/solar-for-homes/solar-costs-and-savings/

## Next gates
1. Confirm GST treatment for imported energy, daily fixed charges and export credits as actually billed. Review all time-of-use tariffs and controlled rates.
2. Reconcile a complete 12-month electricity-only baseline against bills and/or interval meter data. Two bills only suggest seasonal consumption.
3. Obtain manufacturer usable battery capacity, reserve and dispatch constraints for a real 9 kWh product.
4. Validate PV yield using roof pitch/orientation/shading and location-specific production data. Test half-hourly self-consumption/EV/hot-water and battery dispatch.
5. Compare installation costs, annual savings and payback with an appropriate EECA methodology. Do not claim equivalence merely because a single dollar saving is close.
6. Validate actual PDF extraction in an isolated nonproduction environment, and rate-limit/abuse-protect public email endpoint before release.
