# Muyu archive inspection

The optional archive-inspection tool group provides only saved-record inventory
and structural integrity checks, even with automatic saving disabled.

- First use self storage settings to identify the requested backend. Each call
  explicitly selects browser, account-settings, world-book or server. There is no
  automatic selection, fallback, cross-source merge or mutation of routing state.
- Each backend has a distinct read grant. Self-config and ordinary world-book
  grants do not authorize archive inspection. Read-all/full-access policy still
  applies; explicit denial is respected.
- List returns at most eight titles/timestamps/counts and opaque local IDs.
  Inspect takes a listed ID and inventory revision, validates a fresh record and
  matches its metadata. Re-list when stale; unavailable is not an empty archive.
- Message bodies, summaries, raw scopes/identities, required grants and receipts
  are never returned to the model. No session, task, authorization or operation is
  restored. Historical status is not evidence of current execution or saving.
- Host readers share the original account namespace, codecs and service protocol.
  Browser opening aborts a missing database creation transaction, never upgrades a
  schema and uses only readonly transactions. World-book decoding supports both
  legacy and combined volumes without editing, activation or automatic migration.
- A missing optional service is unavailable for server inspection only. Native
  storage and normal chatting remain independent. No server changes are needed.
- Every inspection checks account/settings identity and cancellation, closes its
  temporary store, has a bounded deadline and charges the whole UTF-8 output to
  the shared task read budget. Inspection does not update the active GUI reader.

An absent browser database describes this browser only, not other devices or
copies. Record validation is structural, not a proof that past operations ran or
that current in-memory conversation changes were saved. Body retrieval from an
archived conversation is outside these tools.
