# Tally

A counter that adds amounts up to a limit.

### core/data/limits

The largest amount one step may add.

### core/state/tally

The amounts added so far.

### core/reading/total — the sum of the amounts

Sums the amounts.

### core/reading/average

The mean of the amounts.

### core/change/add

Adds one amount, capped at the limit.

### shell/reading/screen

The text the screen shows.

### substrate/effect/save

Writes the tally out.
