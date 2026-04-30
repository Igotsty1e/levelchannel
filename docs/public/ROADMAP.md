# LevelChannel Roadmap

## Current phase

MVP hardening around checkout, payment operations, and the first account-layer surfaces.

## Near-term work

- keep the payment and webhook flow robust under real operational load
- expand the cabinet and account lifecycle carefully on top of the shipped auth foundation
- continue Postgres-first migration while preserving file-mode fallback where useful
- reduce internal-only repository surface before any public release

## Medium-term work

- improve operator visibility and monitoring
- deepen compliance and retention automation
- turn the minimal cabinet into a fuller learner-facing product surface

## Constraints

- do not weaken payment safety for speed
- keep operational and legal responsibilities explicit
- avoid overstating current product scope beyond the shipped checkout and account foundation
