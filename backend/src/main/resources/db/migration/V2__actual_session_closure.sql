ALTER TABLE operating_session ADD COLUMN closed_at timestamptz;

-- Recover pre-migration closure evidence where available. Existing demo sessions
-- without closure evidence use a bounded cutover time; new sessions always record it.
UPDATE operating_session s
SET closed_at = COALESCE(
    (SELECT GREATEST(MIN(a.occurred_at), COALESCE(
        (SELECT MAX(v.completed_at) FROM dining_visit v
         JOIN waitlist_entry e ON e.id=v.entry_id WHERE e.session_id=s.id),
        MIN(a.occurred_at)))
     FROM audit_event a
     WHERE a.action='SESSION_CLOSED' AND a.occurred_at>=s.opens_at
       AND a.occurred_at<=LEAST(CURRENT_TIMESTAMP, COALESCE(
           (SELECT MIN(n.opens_at) FROM operating_session n
            WHERE n.restaurant_id=s.restaurant_id AND n.opens_at>s.opens_at),
           CURRENT_TIMESTAMP))),
    LEAST(s.closes_at,CURRENT_TIMESTAMP))
WHERE s.status='CLOSED';

ALTER TABLE operating_session ADD CONSTRAINT ck_actual_session_closure
CHECK ((status='CLOSED' AND closed_at IS NOT NULL) OR
       (status IN ('OPEN','CLOSING') AND closed_at IS NULL));
