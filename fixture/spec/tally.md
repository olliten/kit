# Tally

A counter that adds amounts up to a limit.

### core/primitives/limits

The largest amount one step may add.

### core/primitives/tally

The amounts added so far.

### core/readings/total — the sum of the amounts

Sums the amounts.

### core/readings/average

The mean of the amounts.

### core/compositions/add

Adds one amount, capped at the limit.

### shell/readings/screen

The text the screen shows.

### substrate/compositions/save

Writes the tally out.

- The total equals the sum of the supplied amounts. {#total-holds}
