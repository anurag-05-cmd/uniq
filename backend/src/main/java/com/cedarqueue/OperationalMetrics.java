package com.cedarqueue;

import io.micrometer.core.instrument.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.*;

/** Bounded-cardinality, aggregate-only diagnostics. Scrapes never execute database queries. */
@Component
class OperationalMetrics {
    private record Snapshot(double active,double deadlineLag,double projectionAge,double pending,double outboxAge) {}
    private final AtomicReference<Snapshot> snapshot=new AtomicReference<>(new Snapshot(0,0,0,0,0));
    private final AtomicLong lastWorkerSuccess=new AtomicLong();
    private final Timer lockSuccess,lockFailure,workerSuccess,workerFailure;
    private final Counter workerFailures,refreshFailures;
    private final JdbcTemplate jdbc;
    @Value("${app.jobs-enabled:true}") boolean enabled;

    OperationalMetrics(MeterRegistry registry,JdbcTemplate jdbc) {
        this.jdbc=jdbc;
        Gauge.builder("cedar.queue.active",snapshot,s->s.get().active()).description("Active waitlist parties").register(registry);
        Gauge.builder("cedar.queue.deadline.lag",snapshot,s->s.get().deadlineLag()).baseUnit("seconds").description("Maximum overdue persisted arrival, call or snooze deadline; includes suspended recovery").register(registry);
        Gauge.builder("cedar.queue.projection.age",snapshot,s->s.get().projectionAge()).baseUnit("seconds").description("Age of the oldest active ETA projection").register(registry);
        Gauge.builder("cedar.outbox.pending",snapshot,s->s.get().pending()).description("Durable events awaiting notification processing").register(registry);
        Gauge.builder("cedar.outbox.oldest.age",snapshot,s->s.get().outboxAge()).baseUnit("seconds").description("Age of oldest unprocessed durable event").register(registry);
        Gauge.builder("cedar.worker.last.success.age",lastWorkerSuccess,s->s.get()==0?Double.NaN:Math.max(0,(System.currentTimeMillis()-s.get())/1000.0)).baseUnit("seconds").register(registry);
        lockSuccess=timer(registry,"cedar.venue.lock.wait","success");lockFailure=timer(registry,"cedar.venue.lock.wait","failure");
        workerSuccess=timer(registry,"cedar.worker.duration","success");workerFailure=timer(registry,"cedar.worker.duration","failure");
        workerFailures=Counter.builder("cedar.worker.failures").register(registry);
        refreshFailures=Counter.builder("cedar.metrics.refresh.failures").register(registry);
    }
    private static Timer timer(MeterRegistry registry,String name,String outcome) {return Timer.builder(name).tag("outcome",outcome).register(registry);}
    void lockWait(long nanos,boolean success) {(success?lockSuccess:lockFailure).record(nanos,TimeUnit.NANOSECONDS);}
    void workerRun(long nanos,boolean success) {
        (success?workerSuccess:workerFailure).record(nanos,TimeUnit.NANOSECONDS);
        if(success) lastWorkerSuccess.set(System.currentTimeMillis());else workerFailures.increment();
    }
    @Scheduled(fixedDelay=10000,initialDelay=10000) void poll() {
        if(!enabled)return;
        try {refresh();} catch(Exception ignored) {refreshFailures.increment();}
    }
    void refresh() {
        // One aggregate statement supplies a consistent snapshot without exposing record identifiers.
        Snapshot latest=jdbc.queryForObject("""
            select count(*) as active,
                   coalesce(greatest(0,extract(epoch from clock_timestamp()-min(
                       case status when 'ARRIVAL_WINDOW' then arrival_deadline
                                   when 'CALLED' then call_deadline
                                   when 'SNOOZED' then snooze_release_at end))),0) as deadline_lag,
                   coalesce(greatest(0,extract(epoch from clock_timestamp()-min(coalesce(computed_at,joined_at)))),0) as projection_age,
                   (select count(*) from outbox_event where processed_at is null) as pending,
                   (select coalesce(greatest(0,extract(epoch from clock_timestamp()-min(created_at))),0)
                    from outbox_event where processed_at is null) as outbox_age
            from waitlist_entry where status not in ('COMPLETED','CANCELLED','EXPIRED','NO_SHOW')
            """,(rs,n)->new Snapshot(rs.getDouble("active"),rs.getDouble("deadline_lag"),rs.getDouble("projection_age"),rs.getDouble("pending"),rs.getDouble("outbox_age")));
        snapshot.set(latest);
    }
}
