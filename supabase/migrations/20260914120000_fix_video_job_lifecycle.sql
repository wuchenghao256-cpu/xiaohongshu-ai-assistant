-- Video job lifecycle fixes found during the pre-Seedance/Wan audit.
--
-- Adds a terminal state for "the submission never reached the provider": the job row
-- exists, but no upstream task id was ever persisted (client aborted, function killed
-- mid-flight, or the create response was lost). This is distinct from `failed`, which
-- means the provider answered and rejected the request.
--
-- Why a separate state instead of reusing `failed`: for a lost create response we cannot
-- tell whether the provider accepted and billed the task. Marking it failed automatically
-- would hide a live paid task from the user's list and make them pay again. Only the user,
-- after checking the provider console, may move a row out of `queued` into this state.
--
-- Safe on existing data: no current row uses the new label.
-- NOTE: `alter type ... add value` cannot be used in the same transaction that writes the
-- new value, so the application only writes 'never_accepted' after this migration commits.
-- No other DDL is combined here on purpose.

alter type public.media_job_status add value if not exists 'never_accepted';
