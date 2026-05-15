-- WhisperX diarization labels (SPEAKER_00, SPEAKER_01, …) are stable
-- per-transcript but anonymous. speakerMap lets a PM pin
-- "SPEAKER_00 = Иван" so the UI shows real names instead of the
-- previous broken join-order heuristic.
ALTER TABLE "MeetingTranscript" ADD COLUMN "speakerMap" JSONB;
