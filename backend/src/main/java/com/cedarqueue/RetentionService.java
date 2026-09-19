package com.cedarqueue;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

/** Removes customer links/free text from old operational records while preserving aggregate history and accounts. */
@Service
class RetentionService {
    private final Store db;
    private final PasswordEncoder passwords;
    @Value("${app.jobs-enabled:true}") boolean enabled;
    @Value("${app.retention-days:90}") int days;
    RetentionService(Store db,PasswordEncoder passwords) {this.db=db;this.passwords=passwords;}

    @Scheduled(cron="${app.retention-cron:0 17 3 * * *}",zone="UTC")
    @Transactional
    public void anonymize() {
        if(!enabled || days<30 || db.all(Restaurant.class).isEmpty()) return;
        db.lock();
        Instant now=db.now(),cutoff=now.minus(Duration.ofDays(days));
        var rows=db.entityManager().createQuery("from WaitlistEntry where terminalAt<:cutoff and customerId not in (select a.id from Account a where a.enabled=false and a.email like 'retained-%@history.invalid') order by terminalAt",WaitlistEntry.class)
            .setParameter("cutoff",cutoff).setMaxResults(200).getResultList();
        if(rows.isEmpty()) return;
        var anonymous=new Account();
        anonymous.email="retained-"+anonymous.id+"@history.invalid";
        anonymous.displayName="Former guest";
        anonymous.passwordHash=passwords.encode(UUID.randomUUID().toString());
        anonymous.role=Role.CUSTOMER;anonymous.enabled=false;anonymous.createdAt=now;
        db.persist(anonymous);
        for(var entry:rows) {
            UUID formerOwner=entry.customerId;
            entry.customerId=anonymous.id;
            if(entry.terminalReason!=null && !Set.of("ARRIVAL_NO_SHOW","CALL_NO_SHOW","SESSION_CLOSED","CUSTOMER_CANCELLED","USER_CANCELLED").contains(entry.terminalReason))
                entry.terminalReason="HISTORICAL_TERMINAL_EVENT";
            entry.priorityReason=entry.priorityReason==null?null:"Personal detail removed by retention policy";
            for(var feedback:db.query(Feedback.class,"where entryId=?1",entry.id)) {feedback.customerId=anonymous.id;feedback.comment=null;}
            for(var history:db.query(QueueHistory.class,"where entryId=?1",entry.id)) {
                if(formerOwner.toString().equals(history.actor)) history.actor="ANONYMIZED_CUSTOMER";
                history.reason="Historical event retained; personal detail removed";
            }
            for(var event:db.query(AuditEvent.class,"where entryId=?1",entry.id)) {
                if(formerOwner.toString().equals(event.actor)) event.actor="ANONYMIZED_CUSTOMER";
                event.reason="Historical event retained; personal detail removed";
                event.details=null;
            }
            for(var arrival:db.query(Arrival.class,"where entryId=?1",entry.id))
                if(arrival.reason!=null) arrival.reason="Arrival evidence retained; personal detail removed";
            for(var event:db.query(OutboxEvent.class,"where entryId=?1",entry.id)) {
                event.recipientId=anonymous.id;event.body="Historical service event";
                if(event.processedAt==null) event.processedAt=now;
            }
        }
        db.entityManager().createQuery("delete from Notification where createdAt<:cutoff").setParameter("cutoff",cutoff).executeUpdate();
        var audit=new AuditEvent();audit.action="RETENTION_ANONYMIZED";audit.actor="SYSTEM";audit.reason="Removed customer links and free text from "+rows.size()+" terminal reservations older than "+days+" days";audit.occurredAt=now;
        db.persist(audit);
    }
}
