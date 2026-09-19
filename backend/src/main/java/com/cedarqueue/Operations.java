package com.cedarqueue;

import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.slf4j.LoggerFactory;
import java.time.*;
import java.util.*;

@Service
class Operations {
    final Store db;final QueueService q;final EventStreams events;
    Operations(Store db,QueueService q,EventStreams events) {this.db=db;this.q=q;this.events=events;}
    @Transactional long tick() {
        if(db.all(Restaurant.class).isEmpty()) return 0;
        var c=q.context(null);c.venue().heartbeatAt=c.now();
        if(c.session()!=null&&!c.venue().recoveryRequired) {
            boolean changed=q.due(c);
            var first=db.entries(c.session()).stream().filter(e->!e.status.terminal()).findFirst();
            if(changed || first.isPresent() && (first.get().computedAt==null || first.get().computedAt.isBefore(c.now().minusSeconds(15)))) q.project(c);
        }
        // Claims and durable in-app writes share one transaction: crash rolls back both, so leases are unnecessary.
        var pending=db.entityManager().createNativeQuery("select * from outbox_event where processed_at is null order by created_at limit 50 for update skip locked",OutboxEvent.class).getResultList();
        for(Object item:pending) {
            var out=(OutboxEvent)item;var entry=out.entryId==null?null:db.get(WaitlistEntry.class,out.entryId);
            boolean stale=entry!=null && ((out.kind.equals("ARRIVAL_WINDOW") && entry.status!=EntryStatus.ARRIVAL_WINDOW) || (out.kind.equals("CALLED") && entry.status!=EntryStatus.CALLED) || (out.kind.equals("SNOOZE_RELEASED") && !entry.status.pending()));
            if(!stale) {var n=new Notification();n.eventId=out.id;n.recipientId=out.recipientId;n.kind=out.kind;n.title=out.title;n.body=out.body;n.createdAt=c.now();db.persist(n);}
            out.processedAt=c.now();
        }
        return c.session()==null?0:c.session().revision;
    }
    @Transactional void detectRestart() {
        var c=q.context(null);
        if(c.venue().heartbeatAt!=null && c.venue().heartbeatAt.isBefore(c.now().minusSeconds(60)) && c.session()!=null && c.session().status!=SessionStatus.CLOSED && db.entries(c.session()).stream().anyMatch(e->!e.status.terminal())) {
            c.venue().recoveryRequired=true;q.audit(c,null,"RECOVERY_REQUIRED","Heartbeat interruption exceeded 60 seconds","Joins and deadline expiry suspended until manager acknowledgement");
        }
        c.venue().heartbeatAt=c.now();
    }
    @Transactional void cleanup() {
        if(db.all(Restaurant.class).isEmpty()) return;
        db.lock();Instant now=db.now();
        db.entityManager().createQuery("delete from IdempotencyRecord where createdAt<?1").setParameter(1,now.minusSeconds(86400)).executeUpdate();
        // Arrival evidence retains referenced challenge hashes; only unused expired challenges are removed.
        db.entityManager().createQuery("delete from QrChallenge q where q.expiresAt<?1 and q.id not in (select a.challengeId from Arrival a where a.challengeId is not null)").setParameter(1,now.minusSeconds(86400)).executeUpdate();
    }
}
@Service
class ScheduledOperations {
    final Operations ops;final EventStreams events;final OperationalMetrics metrics;
    @Value("${app.jobs-enabled:true}") boolean enabled;
    ScheduledOperations(Operations ops,EventStreams events,OperationalMetrics metrics) {this.ops=ops;this.events=events;this.metrics=metrics;}
    @Scheduled(fixedDelay=2000,initialDelay=5000) void run() {
        if(!enabled)return;
        long started=System.nanoTime();boolean success=false;
        try {long revision=ops.tick();events.publish(revision);success=true;} catch(Exception e) {LoggerFactory.getLogger(getClass()).warn("Queue worker will retry after {}",e.getClass().getSimpleName());}
        finally {metrics.workerRun(System.nanoTime()-started,success);}
    }
    @Scheduled(fixedDelay=3600000,initialDelay=60000) void cleanup() {if(enabled) try {ops.cleanup();} catch(Exception e) {LoggerFactory.getLogger(getClass()).warn("Cleanup will retry after {}",e.getClass().getSimpleName());}}
}
@Configuration
class Startup {
    @Bean ApplicationRunner initialize(DemoService demo,Operations operations) {return args->{demo.initialize();demo.bootstrapManager();operations.detectRestart();};}
}
