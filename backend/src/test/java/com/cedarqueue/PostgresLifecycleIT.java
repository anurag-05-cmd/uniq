package com.cedarqueue;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real independent PostgreSQL transactions. Explicit -Pintegration; never substitutes another database. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"app.jobs-enabled=false","server.servlet.session.cookie.secure=false"})
@ActiveProfiles("demo")
@Timeout(90)
class PostgresLifecycleIT {
    @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
        String url=System.getenv("TEST_DATABASE_URL");
        if(url==null || !url.matches("jdbc:postgresql://[^/]+/cedar_test(\\?.*)?")) throw new IllegalStateException("Set TEST_DATABASE_URL to a native PostgreSQL cedar_test database before -Pintegration verify.");
        r.add("spring.datasource.url",()->url);
        r.add("spring.datasource.username",()->System.getenv("TEST_DATABASE_USERNAME"));
        r.add("spring.datasource.password",()->System.getenv("TEST_DATABASE_PASSWORD"));
    }
    @Autowired QueueService q;
    @Autowired DemoService demo;
    @Autowired AdminService admin;
    @Autowired Operations ops;
    @Autowired AccountRepository accounts;
    @Autowired JdbcTemplate jdbc;
    @Autowired RetentionService retention;
    @Autowired QueryService queries;
    @Autowired OperationalMetrics metrics;
    @Autowired io.micrometer.core.instrument.MeterRegistry registry;
    @Autowired org.springframework.web.context.WebApplicationContext webContext;
    Account manager;
    @BeforeEach void reset() {
        manager=accounts.findByEmailIgnoreCase("manager@cedar.local").orElseThrow();
        q.command(manager,"/demo/reset",key(),new Requests.Simulation(null,null),c->demo.run(c,"reset",new Requests.Simulation(null,null)));
    }
    String key() {return UUID.randomUUID().toString();}
    Account customer() {
        var a=new Account();a.email="it-"+key()+"@cedar.local";a.displayName="Integration guest";a.passwordHash=manager.passwordHash;return accounts.save(a);
    }
    @SuppressWarnings("unchecked") Map<String,Object> join(Account a) {var b=new Requests.Join(2,"ANY",false);return (Map<String,Object>)q.command(a,"/entries",key(),b,c->q.join(c,b));}
    UUID id(Map<String,Object> m) {return UUID.fromString(m.get("id").toString());}
    long version(UUID id) {return jdbc.queryForObject("select version from waitlist_entry where id=?",Long.class,id);}
    String status(UUID id) {return jdbc.queryForObject("select status from waitlist_entry where id=?",String.class,id);}
    Requests.Change change(UUID id) {return new Requests.Change(version(id),"Integration attested arrival",null,null,null);}
    Object host(UUID id,String action,String key,Requests.Change b) {return q.command(manager,"/host/entries/"+id+"/"+action,key,b,c->q.hostAction(c,id,action,b));}
    void assist(UUID id) {host(id,"assist",key(),change(id));}
    void cancel(Account a,UUID id) {var b=change(id);q.command(a,"/entries/"+id+"/cancel",key(),b,c->q.customerAction(c,id,"cancel",b));}

    @Test void qrExpiryAndGhostDeadlineAreEnforcedFromPostgresTime() {
        var a=customer();var e=join(a);UUID id=id(e);
        var display=q.display();String challenge=(String)display.get("challenge");
        jdbc.update("update qr_challenge set issued_at=clock_timestamp()-interval '60 seconds', expires_at=clock_timestamp()-interval '1 second'");
        var body=new Requests.Change(version(id),null,null,null,challenge);
        var error=assertThrows(Problem.class,()->q.command(a,"/entries/"+id+"/check-in",key(),body,c->q.customerAction(c,id,"check-in",body)));
        assertEquals("QR_INVALID",error.code);
        jdbc.update("update waitlist_entry set arrival_window_opened_at=clock_timestamp()-interval '10 minutes', arrival_deadline=clock_timestamp()-interval '1 second' where id=?",id);
        ops.tick();assertEquals("EXPIRED",status(id));
        ops.tick();assertEquals(1,jdbc.queryForObject("select count(*) from queue_history where entry_id=? and action='EXPIRED'",Integer.class,id));
    }

    @Test void snoozeBarrierReleaseKeepsJoinAgeAndEnforcesQuota() {
        var a=customer();UUID first=id(join(a));Instant original=jdbc.queryForObject("select joined_at from waitlist_entry where id=?",(rs,n)->rs.getTimestamp(1).toInstant(),first);
        for(int iteration=0;iteration<2;iteration++) {
            var b=customer();var d=customer();UUID second=id(join(b)),third=id(join(d));
            var body=change(first);q.command(a,"/entries/"+first+"/snooze",key(),body,c->q.customerAction(c,first,"snooze",body));
            assertEquals("SNOOZED",status(first));cancel(b,second);cancel(d,third);ops.tick();
            assertEquals("ARRIVAL_WINDOW",status(first));
            assertEquals(original,jdbc.queryForObject("select joined_at from waitlist_entry where id=?",(rs,n)->rs.getTimestamp(1).toInstant(),first));
        }
        var body=change(first);var ex=assertThrows(Problem.class,()->q.command(a,"/entries/"+first+"/snooze",key(),body,c->q.customerAction(c,first,"snooze",body)));
        assertEquals("SNOOZE_LIMIT",ex.code);
    }

    @Test void simultaneousCallAndSeatingHaveOneWinnerAndCompletionReplays() throws Exception {
        UUID id=id(join(customer()));assist(id);
        var b=new Requests.Change(null,null,null,null,null);
        List<Object> calls=race(8,()->q.command(manager,"/host/call-next",key(),b,c->q.callNext(c,b)));
        assertEquals(1,calls.stream().filter(Objects::nonNull).count());
        assertEquals(1,jdbc.queryForObject("select count(*) from waitlist_entry where status='CALLED'",Integer.class));
        var seat=change(id);var seating=race(8,()->{try{return host(id,"seat",key(),seat);}catch(Problem conflict){assertEquals(409,conflict.status);return null;}});
        assertEquals(1,seating.stream().filter(Objects::nonNull).count());
        assertEquals(1,jdbc.queryForObject("select count(*) from dining_visit where entry_id=?",Integer.class,id));
        var complete=change(id);String retry=key();Object first=host(id,"complete",retry,complete),second=host(id,"complete",retry,complete);
        assertEquals(q.json().writeValueAsString(first),q.json().writeValueAsString(second));assertEquals("COMPLETED",status(id));
        assertEquals(1,jdbc.queryForObject("select count(*) from queue_history where entry_id=? and action='COMPLETED'",Integer.class,id));
    }

    @Test void sameIdempotencyKeyJoinIsReplayedAcrossConcurrentTransactions() throws Exception {
        var account=customer();var body=new Requests.Join(4,"ANY",false);String key=key();
        var results=race(8,()->q.command(account,"/entries",key,body,c->q.join(c,body)));
        var ids=results.stream().map(o->((Map<?,?>)o).get("id").toString()).distinct().toList();assertEquals(1,ids.size());
        assertEquals(1,jdbc.queryForObject("select count(*) from waitlist_entry where customer_id=?",Integer.class,account.id));
        var other=new Requests.Join(6,"ANY",false);
        assertEquals("IDEMPOTENCY_MISMATCH",assertThrows(Problem.class,()->q.command(account,"/entries",key,other,c->q.join(c,other))).code);
    }

    @Test void restartRecoverySuspendsExpiryUntilAuditedManagerGrace() {
        UUID id=id(join(customer()));
        jdbc.update("update restaurant set heartbeat_at=clock_timestamp()-interval '2 minutes'");
        jdbc.update("update waitlist_entry set arrival_window_opened_at=clock_timestamp()-interval '10 minutes',arrival_deadline=clock_timestamp()-interval '1 second' where id=?",id);
        ops.detectRestart();ops.tick();assertEquals("ARRIVAL_WINDOW",status(id));
        assertTrue(jdbc.queryForObject("select recovery_required from restaurant",Boolean.class));
        var body=new Requests.SessionInput("Operator verified all surviving parties",300,null,null);
        q.command(manager,"/admin/session/recover",key(),body,c->admin.session(c,"recover",body));ops.tick();
        assertFalse(jdbc.queryForObject("select recovery_required from restaurant",Boolean.class));assertEquals("ARRIVAL_WINDOW",status(id));
        assertTrue(jdbc.queryForObject("select arrival_deadline>clock_timestamp() from waitlist_entry where id=?",Boolean.class,id));
    }

    @Test void actuatorMetricsRequireManagerAndObserveRealPersistedQueueLag() throws Exception {
        var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(webContext)
            .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity()).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/metrics"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        for(String role:List.of("CUSTOMER","HOST","DISPLAY")) {
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/metrics")
                .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("metrics-check").roles(role)))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isForbidden());
        }
        UUID entry=id(join(customer()));
        jdbc.update("update waitlist_entry set arrival_window_opened_at=clock_timestamp()-interval '10 minutes',arrival_deadline=clock_timestamp()-interval '30 seconds',computed_at=clock_timestamp()-interval '60 seconds' where id=?",entry);
        metrics.refresh();
        assertEquals(1,registry.get("cedar.queue.active").gauge().value());
        assertTrue(registry.get("cedar.queue.deadline.lag").gauge().value()>=29);
        assertTrue(registry.get("cedar.queue.projection.age").gauge().value()>=59);
        assertTrue(registry.get("cedar.outbox.pending").gauge().value()>=2);
        assertTrue(registry.get("cedar.venue.lock.wait").tag("outcome","success").timer().count()>0);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/metrics/cedar.queue.deadline.lag")
            .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("metrics-manager").roles("MANAGER")))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/health"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    }
    @Test void managerCreatesFullyInitializedTableAndAvailabilityHistory() {
        UUID area=jdbc.queryForObject("select id from dining_area limit 1",UUID.class);
        String number="IT-"+key().substring(0,8);
        var body=new Requests.TableInput(number,area,6,true,true,null,null);
        @SuppressWarnings("unchecked") var result=(Map<String,Object>)q.command(manager,"/admin/tables",key(),body,c->admin.table(c,null,body));
        UUID table=id(result);
        assertEquals(6,jdbc.queryForObject("select capacity from restaurant_table where id=?",Integer.class,table));
        assertEquals(area,jdbc.queryForObject("select area_id from restaurant_table where id=?",UUID.class,table));
        assertEquals(number,jdbc.queryForObject("select number from restaurant_table where id=?",String.class,table));
        assertEquals(1,jdbc.queryForObject("select count(*) from table_history where table_id=?",Integer.class,table));
    }

    @Test void actualClosureStopsAccountingAfterDiningAndFutureSessionCancellation() {
        UUID entry=id(join(customer()));assist(entry);
        var call=new Requests.Change(null,null,null,null,null);
        q.command(manager,"/host/call-next",key(),call,c->q.callNext(c,call));host(entry,"seat",key(),change(entry));
        UUID oldSession=jdbc.queryForObject("select current_session_id from restaurant",UUID.class);
        var close=new Requests.SessionInput("Early restaurant closure",null,null,null);
        q.command(manager,"/admin/session/close",key(),close,c->admin.session(c,"close",close));
        assertEquals("CLOSING",jdbc.queryForObject("select status from operating_session where id=?",String.class,oldSession));
        assertNull(jdbc.queryForObject("select closed_at from operating_session where id=?",(rs,n)->rs.getTimestamp(1),oldSession));
        host(entry,"complete",key(),change(entry));
        Instant closed=jdbc.queryForObject("select closed_at from operating_session where id=?",(rs,n)->rs.getTimestamp(1).toInstant(),oldSession);
        assertEquals("CLOSED",jdbc.queryForObject("select status from operating_session where id=?",String.class,oldSession));
        q.command(manager,"/admin/session/close",key(),close,c->admin.session(c,"close",close));
        assertEquals(closed,jdbc.queryForObject("select closed_at from operating_session where id=?",(rs,n)->rs.getTimestamp(1).toInstant(),oldSession));
        Instant opening=Instant.now().plusSeconds(3600);var open=new Requests.SessionInput("Future dinner service",null,opening,opening.plusSeconds(3600));
        q.command(manager,"/admin/session/open",key(),open,c->admin.session(c,"open",open));
        q.command(manager,"/admin/session/close",key(),close,c->admin.session(c,"close",close));
        @SuppressWarnings("unchecked") var report=(Map<String,Object>)queries.analytics();
        long seconds=((Number)report.get("serviceOpenSeconds")).longValue();
        assertTrue(seconds>=14400 && seconds<14410,"Only the actual four-hour session contributes, not scheduled future hours.");
        int tables=jdbc.queryForObject("select count(*) from restaurant_table",Integer.class);
        assertEquals(seconds*tables,((Number)report.get("availableTableSeconds")).longValue(),tables+2);
        assertTrue(jdbc.queryForObject("select closed_at<opens_at from operating_session where id=(select current_session_id from restaurant)",Boolean.class));
    }
    @Test void concurrentQrArrivalAndExpiryProduceOneLegalOutcome() throws Exception {
        var account=customer();UUID entry=id(join(account));String secret=(String)q.display().get("challenge");
        var body=new Requests.Change(version(entry),null,null,null,secret);
        jdbc.update("update waitlist_entry set arrival_deadline=clock_timestamp()+interval '40 milliseconds' where id=?",entry);
        var barrier=new CyclicBarrier(2);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var check=pool.submit(()->{barrier.await();try{return q.command(account,"/entries/"+entry+"/check-in",key(),body,c->q.customerAction(c,entry,"check-in",body));}catch(Problem conflict){assertTrue(conflict.status==409||conflict.status==410);return null;}});
            var expiry=pool.submit(()->{barrier.await();return ops.tick();});
            check.get(10,TimeUnit.SECONDS);expiry.get(10,TimeUnit.SECONDS);
        }
        Thread.sleep(60);ops.tick();
        String outcome=status(entry);assertTrue(outcome.equals("CHECKED_IN")||outcome.equals("EXPIRED"));
        int arrivals=jdbc.queryForObject("select count(*) from arrival where entry_id=?",Integer.class,entry);
        assertEquals(outcome.equals("CHECKED_IN")?1:0,arrivals);
    }

    @Test void durableNotificationWorkerIsIdempotentAcrossRepeatedPolls() {
        UUID entry=id(join(customer()));ops.tick();ops.tick();
        int events=jdbc.queryForObject("select count(*) from outbox_event where entry_id=?",Integer.class,entry);
        int notifications=jdbc.queryForObject("select count(*) from notification n join outbox_event o on o.id=n.event_id where o.entry_id=?",Integer.class,entry);
        assertEquals(events,notifications);
        assertEquals(0,jdbc.queryForObject("select count(*) from outbox_event where entry_id=? and processed_at is null",Integer.class,entry));
    }
    @Test void retentionAnonymizesOldOperationsWhilePreservingCustomerAccountAndDuration() throws Exception {
        UUID entry=jdbc.queryForObject("select id from waitlist_entry where status='COMPLETED' limit 1",UUID.class);
        UUID owner=jdbc.queryForObject("select customer_id from waitlist_entry where id=?",UUID.class,entry);
        Long duration=jdbc.queryForObject("select duration_seconds from dining_visit where entry_id=?",Long.class,entry);
        jdbc.update("update waitlist_entry set terminal_at=terminal_at-interval '100 days', joined_at=joined_at-interval '100 days', fairness_since=fairness_since-interval '100 days', checked_in_at=checked_in_at-interval '100 days',terminal_reason='Personal cancellation note' where id=?",entry);
        jdbc.update("update dining_visit set started_at=started_at-interval '100 days',completed_at=completed_at-interval '100 days' where entry_id=?",entry);
        jdbc.update("insert into feedback(id,version,entry_id,customer_id,rating,comment,created_at) values(?,0,?,?,4,'Personal feedback text',clock_timestamp()-interval '100 days')",UUID.randomUUID(),entry,owner);
        RetentionService target=org.springframework.test.util.AopTestUtils.getTargetObject(retention);
        target.enabled=true;
        try {retention.anonymize();} finally {target.enabled=false;}
        UUID anonymous=jdbc.queryForObject("select customer_id from waitlist_entry where id=?",UUID.class,entry);
        assertNotEquals(owner,anonymous);
        assertTrue(accounts.findById(owner).orElseThrow().enabled);
        assertFalse(accounts.findById(anonymous).orElseThrow().enabled);
        assertNull(jdbc.queryForObject("select comment from feedback where entry_id=?",String.class,entry));
        assertEquals(duration,jdbc.queryForObject("select duration_seconds from dining_visit where entry_id=?",Long.class,entry));
        assertNotEquals("Personal cancellation note",jdbc.queryForObject("select terminal_reason from waitlist_entry where id=?",String.class,entry));
    }
    private List<Object> race(int count,Callable<Object> operation) throws Exception {
        var start=new CyclicBarrier(count);var results=new ArrayList<Future<Object>>();
        try(var pool=Executors.newFixedThreadPool(count)) {
            for(int i=0;i<count;i++)results.add(pool.submit(()->{start.await(10,TimeUnit.SECONDS);return operation.call();}));
            var values=new ArrayList<Object>();for(var f:results)values.add(f.get(40,TimeUnit.SECONDS));return values;
        }
    }
}
