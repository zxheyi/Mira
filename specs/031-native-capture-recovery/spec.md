# Native capture and local follow-up recovery

Date: 2026-09-17

## Observed failures

The Mira project had twelve unconsumed Outbox messages, no distillation jobs, and a stale Briefing. Native follow-up was incorrectly enabled only when model-provider configuration existed. A Claude session failed capture at 50,000 normalized characters although the domain already supported a 5,000,000-character transcript. A Stop/SessionEnd replay also failed when its normalized content was unchanged but the underlying file's size or modification time changed.

## Behavior partitions

| Input or state | Required result |
| --- | --- |
| Transcript over 50,000 and at most 5,000,000 characters | Capture the complete normalized transcript through native/CLI capture adapters. MCP continues to persist complete sessions assembled from individually bounded messages. |
| Single query/response over 50,000; transcript over 5,000,000 | Reject without capture/turn/checkpoint/event writes. Existing saved data survives. |
| Same completed input with changed file observations | Return an idempotent duplicate; update a matching, non-stale checkpoint without new capture or Outbox events. |
| Different content, identity, title, format, transport, or outcome under an existing Turn ID | Preserve conflict rejection. |
| Replay after a later snapshot | Preserve the later Thread and checkpoint. |
| Legacy completed input hash | Prove the full original input using its exact hash or original persisted cursor metadata; otherwise reject rather than infer identity from body alone. |
| Deleted Thread on a proven replay | Preserve the existing repair behavior and enqueue follow-up once. |
| Native capture, unchanged replay, or successful SessionStart without a Provider | Consume due local Outbox work and refresh the Briefing. Persist deduplicated model jobs as pending, without launching a model worker. |
| Provider configured | Complete local work, then launch the existing detached worker; launch does not imply job completion or Memory acceptance. |
| Follow-up failure | Keep successful capture/context; expose durable job state or a bounded diagnostic and allow a later valid hook to retry. |
| Foreign root, forbidden transcript path, or invalid input | Keep existing scope/path rejection; never run capture follow-up for rejected input. |

The existing `onThreadCaptured` callback still runs only for changed captures. The new `onCaptureSettled` callback resumes durable work after successful capture or unchanged replay. SessionStart follow-up remains after valid context preparation, preserving project-binding checks.

## Verification and recovery

Regression tests first reproduce each failure. Source-level tests cover limits, immutable replay identity, old-hash compatibility, later snapshots, repair, worker failures, project scope, and no-provider recovery. Fresh compiled CLI and stdio MCP tests exercise long captures and local queue recovery together.

Before recovering real local data, take a consistent SQLite backup and rehearse against a copy. Replay only the affected project sessions through the normal capture path, then drain local work. Do not configure a model, send transcripts externally, label synthetic results as user feedback, or promote queued jobs to completed Memories. Record the actual recovered counts and any remaining model-configuration dependency.
