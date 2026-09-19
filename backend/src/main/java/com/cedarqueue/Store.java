package com.cedarqueue;

import jakarta.persistence.*;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.time.*;
import java.util.*;

interface AccountRepository extends JpaRepository<Account,UUID> {
    Optional<Account> findByEmailIgnoreCase(String email);
}
@Repository
class Store {
    private final OperationalMetrics metrics;
    Store(OperationalMetrics metrics) {this.metrics=metrics;}
    @PersistenceContext EntityManager em;
    EntityManager entityManager() {return em;}
    <T> T persist(T t) { em.persist(t);return t; }
    <T> T get(Class<T> type,UUID id) { var row=em.find(type,id);if(row==null) throw Problem.missing();return row; }
    <T> List<T> all(Class<T> type) { return em.createQuery("from "+type.getSimpleName(),type).getResultList(); }
    <T> List<T> query(Class<T> type,String where,Object... params) {
        var q=em.createQuery("from "+type.getSimpleName()+" "+where,type);
        for(int i=0;i<params.length;i++) q.setParameter(i+1,params[i]);
        return q.getResultList();
    }
    Restaurant venue() { return em.createQuery("from Restaurant",Restaurant.class).setMaxResults(1).getSingleResult(); }
    Restaurant lock() {
        long started=System.nanoTime();boolean success=false;
        try {var r=em.createQuery("from Restaurant",Restaurant.class).setLockMode(LockModeType.PESSIMISTIC_WRITE).setMaxResults(1).getSingleResult();em.refresh(r);success=true;return r;}
        finally {metrics.lockWait(System.nanoTime()-started,success);}
    }
    OperatingSession session(Restaurant r) { return r.currentSessionId==null?null:get(OperatingSession.class,r.currentSessionId); }
    Instant now() { return ((java.time.OffsetDateTime)em.createNativeQuery("select clock_timestamp()",java.time.OffsetDateTime.class).getSingleResult()).toInstant(); }
    List<WaitlistEntry> entries(OperatingSession session) { return session==null?List.of():query(WaitlistEntry.class,"where sessionId=?1 order by sequence",session.id); }
    void flush() { em.flush(); }
}
