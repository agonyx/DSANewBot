# Session notes and inline rolls

## Inline dice

Ordinary Discord messages can contain Roll20-style expressions such as `[[1w20]]` or `[[2w6+3]]`. The bot replies with a compact breakdown shared by `/roll` and `/macro roll`. It ignores unrelated double-bracket text, reports malformed dice expressions, suppresses reply pings, limits work to ten expressions per message, and truncates long dice lists while preserving the total.

The listener uses the existing `GuildMessages` and `MessageContent` intents. No additional privileged intent is required.

## Session notes

`/session-notes` requires **Manage Server** and stores notes inside the current guild boundary:

- `add` records a title, summary, and optional `YYYY-MM-DD` session date.
- `list` and `show` are ephemeral unless `visible:true` is supplied.
- `edit` updates any supplied title, content, or date and detects concurrent edits.
- `delete` permanently removes the selected note.

Show, edit, and delete use autocomplete-backed stable note IDs, so duplicate titles are safe. Each guild can retain up to 100 notes. Migration `drizzle/0012_fixed_firebird.sql` must be applied before the command is registered and used.
