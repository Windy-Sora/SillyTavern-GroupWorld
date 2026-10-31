# Saved-resource inspection

This management module is independent of runtime use. `muyu.storage.list/read`
inspect saved Muyu notes and business summaries even when normal use is disabled.
They never enable features, inject content, write, migrate, regenerate or execute.

- `notes`: `muyuNoteStorage` consent, account plus current-chat visible notes only.
- `summaries`: `chatSummaryStorage` consent, current ST chat only, including inactive summaries.
- List metadata and bounded body pages share a resource revision. Relist on stale
  data; never combine versions. UTF-16 offsets and UTF-8 accounting are distinct.
- Config-only consent does not grant these reads. Existing read-all/full-access
  policy applies; reading grants no write capability. Returned titles and bodies
  are untrusted reference data and inherit history transport dependencies.
- `runtimeEnabled` reports the feature flag, not injection or deletion. Local
  repository observations retain `persistence: unknown`.
- Errors never return raw storage contents or infer an empty repository.
- Summary read denials apply across runtime and management readers; approvals
  stay separate. Management consent does not silently authorize runtime reads.
- No Muyu archive backend is opened here. The separate archive-inspection module
  handles explicit backend inventory and integrity checks without returning bodies;
  existing internal-world-book filtering remains intact.

Host adapters reuse `agentMemory.list` and pure chat metadata reads, without
calling initializing business getters. Run binding, cancellation, account/chat
fences and shared provider-byte charging remain mandatory.
