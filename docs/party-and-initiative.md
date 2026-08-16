# Party and non-combat initiative

These Discord-only tools use explicit party enrollment so characters never leak across servers.

## Party workflow

- A player selects a character and runs `/party join` in each server where that character belongs.
- Running `/party join` again replaces that user's enrolled character for the server.
- `/party leave` removes the caller's enrollment from that server.
- `/party view` requires **Manage Server** and is ephemeral unless `visible:true` is supplied. It summarizes LeP, wounds, initiative, supernatural resources, and Fate Points for every enrolled character.

## Initiative workflow

`/initiative` requires **Manage Server**. Trackers are stored per server channel and survive bot restarts.

- `/initiative start` creates the tracker and rolls `1W6 + INI` for every enrolled party character.
- `/initiative add` adds a manual participant at a supplied final initiative value.
- `/initiative remove` uses autocomplete and a stable entry ID, so duplicate names are safe.
- `/initiative next` advances the active marker and increments the round after wraparound.
- `/initiative show` redraws the current state; `/initiative end` deletes it.

Migration `drizzle/0011_overjoyed_miracleman.sql` must be applied before registering and using these commands. Command deployment and database migration are intentionally separate operational steps.
