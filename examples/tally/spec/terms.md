# Terms

The tally's language. Sections only group the lines.

## Counting

- **add** — put one amount on the tally.
  - Role: composition
  - Zone: core
  - Of: {{limits}}, {{tally}}
- **amount** — one number added to the tally.
- **average** — the total over the count of amounts.
  - Role: derived
  - Zone: core
  - From: {{tally}}, {{total}}
- **empty** — holding no amounts.
- **limits** — the bounds one step must keep.
  - Role: fact
  - Zone: core
  - Of: []
- **max** — the largest value allowed.
- **step** — one add.
- **tally** — the amounts added so far.
  - Role: fact
  - Zone: core
  - Of: []
- **total** — the sum of the amounts. Retired: sums.
  - Role: derived
  - Zone: core
  - From: {{tally}}

## Showing

- **label** — the text for one number.
  - Role: derived
  - Zone: core
  - From: []
- **screen** — what the user sees.
  - Role: derived
  - Zone: shell
  - From: {{label}}, {{tally}}, {{total}}
