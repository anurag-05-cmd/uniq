package com.cedarqueue;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import tools.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import java.security.*;
import java.nio.charset.StandardCharsets;
import java.util.function.Function;
import static com.cedarqueue.Dtos.map;

@Service
class QueueService {
    final Store db; final ObjectMapper json; final EventStreams events;
    final AllocationEngine allocator=new AllocationEngine();final EtaEngine eta=new EtaEngine();
    @Value("${app.demo:false}") boolean demo;
    private volatile String displaySecret;private volatile Instant displayIssued=Instant.EPOCH;
    QueueService(Store db,ObjectMapper json,EventStreams events) {this.db=db;this.json=json;this.events=events;}
    ObjectMapper json() {return json;} Store store() {return db;} boolean isDemo() {return demo;} AllocationEngine allocation() {return allocator;}
    void invalidateDisplay() {displaySecret=null;displayIssued=Instant.EPOCH;}
    record Context(Restaurant venue,OperatingSession session,Policy policy,Instant now,Account actor) {}
    Policy policy(Restaurant v,OperatingSession s) { return json.readValue(s==null?v.policyJson:s.policyJson,Policy.class); }
    Context context(Account actor) {var v=db.lock();var s=db.session(v);return new Context(v,s,policy(v,s),db.now(),actor);}
    static String hash(String input) {
        try {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)));}
        catch(NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
    }
    /** Every domain command, including administration and jobs, serializes on the venue row. */
    @Transactional Object command(Account actor,String route,String key,Object request,Function<Context,Object> work) {
        if(key==null || key.isBlank() || key.length()>80) throw new Problem(400,"IDEMPOTENCY_KEY_REQUIRED","Send an Idempotency-Key of 1–80 characters.");
        var c=context(actor);String digest=hash(json.writeValueAsString(request));
        var replay=db.query(IdempotencyRecord.class,"where actorId=?1 and route=?2 and requestKey=?3",actor.id,route,key);
        if(!replay.isEmpty()) {
            if(!replay.getFirst().requestHash.equals(digest)) throw Problem.conflict("IDEMPOTENCY_MISMATCH","This request key was already used with different input.");
            if(org.springframework.web.context.request.RequestContextHolder.getRequestAttributes() instanceof org.springframework.web.context.request.ServletRequestAttributes attrs && attrs.getResponse()!=null) attrs.getResponse().setHeader("Idempotent-Replay","true");
            return json.readValue(replay.getFirst().responseJson,Object.class);
        }
        if(c.session()!=null && !c.venue().recoveryRequired) due(c);
        Object raw=work.apply(c);
        var current=db.session(c.venue());
        if(current!=null) project(new Context(c.venue(),current,policy(c.venue(),current),c.now(),actor));
        db.flush();
        Object result=raw instanceof WaitlistEntry e?Dtos.entry(e,policy(c.venue(),db.get(OperatingSession.class,e.sessionId)),db,IdentityService.staff(actor)):
            raw instanceof RestaurantTable t?Dtos.table(t,db):raw;
        var saved=new IdempotencyRecord();saved.actorId=actor.id;saved.route=route;saved.requestKey=key;saved.requestHash=digest;saved.responseJson=json.writeValueAsString(result);saved.createdAt=c.now();db.persist(saved);
        return result;
    }
    void version(Versioned row,Long expected) {
        if(expected==null) throw new Problem(400,"VERSION_REQUIRED","Refresh the record and supply its expectedVersion.");
        if(row.version!=expected) throw Problem.conflict("VERSION_CONFLICT","The record changed. Refresh and try again.");
    }
    static String reason(String value) {if(value==null || value.isBlank()) throw new Problem(400,"REASON_REQUIRED","A reason is required for this operation.");return value.trim();}
    void open(Context c) {
        if(c.venue().recoveryRequired) throw Problem.conflict("RECOVERY_REQUIRED","The manager must reconcile service after an interruption.");
        if(c.session()==null || c.session().status!=SessionStatus.OPEN || c.now().isBefore(c.session().opensAt) || !c.now().isBefore(c.session().closesAt)) throw Problem.conflict("SESSION_CLOSED","The restaurant waitlist is closed.");
    }
    WaitlistEntry join(Context c,Requests.Join body) {return joinFor(c,c.actor(),body);}
    WaitlistEntry joinFor(Context c,Account customer,Requests.Join body) {
        open(c);
        var entries=db.entries(c.session());
        if(entries.stream().anyMatch(e->e.customerId.equals(customer.id)&&!e.status.terminal())) throw Problem.conflict("ACTIVE_ENTRY_EXISTS","You already have an active reservation.");
        if(entries.stream().filter(e->!e.status.terminal()).count()>=c.policy().maxActiveParties()) throw Problem.conflict("QUEUE_FULL","The waitlist is at capacity.");
        var p=new AllocationEngine.Party(UUID.randomUUID(),body.partySize(),body.accessible(),body.preference(),false,c.now(),0);
        if(db.all(RestaurantTable.class).stream().noneMatch(t->t.enabled&&t.status!=TableStatus.UNAVAILABLE&&AllocationEngine.compatible(p,table(t)))) throw Problem.conflict("NO_COMPATIBLE_TABLE","There is currently no enabled compatible table for this party.");
        if(body.preference()!=null && !body.preference().isBlank() && !body.preference().equalsIgnoreCase("ANY") && db.all(DiningArea.class).stream().noneMatch(a->a.name.equalsIgnoreCase(body.preference()))) throw new Problem(400,"INVALID_PREFERENCE","Select an available dining area or any seating.");
        var e=new WaitlistEntry();e.sessionId=c.session().id;e.customerId=customer.id;e.sequence=c.session().nextSequence++;e.token="C-"+String.format("%04d",e.sequence);e.partySize=body.partySize();e.preference=body.preference();e.accessible=body.accessible();e.joinedAt=c.now();e.fairnessSince=c.now();
        db.persist(e);record(c,e,null,"JOINED","Remote reservation created");return e;
    }
    WaitlistEntry owned(Context c,UUID id) {var e=db.get(WaitlistEntry.class,id);IdentityService.owner(c.actor(),e);return e;}
    void current(Context c,WaitlistEntry e) {if(c.session()==null || !e.sessionId.equals(c.session().id)) throw Problem.conflict("SESSION_CLOSED","This reservation belongs to a previous session.");}
    WaitlistEntry customerAction(Context c,UUID id,String action,Requests.Change body) {
        var e=owned(c,id);current(c,e);
        if(action.equals("check-in") && e.checkedInAt!=null) return e;
        version(e,body.expectedVersion());
        switch(action) {
            case "check-in" -> checkIn(c,e,body.challenge(),false,null);
            case "cancel" -> {if(!e.status.pending()&&e.status!=EntryStatus.CALLED) throw Problem.conflict("STATE_CONFLICT","Only reservations before seating can be cancelled.");terminate(c,e,EntryStatus.CANCELLED,body.reason()==null?"CUSTOMER_CANCELLED":body.reason());}
            case "snooze" -> snooze(c,e);
            default -> throw Problem.missing();
        }
        return e;
    }
    void checkIn(Context c,WaitlistEntry e,String challenge,boolean assisted,String why) {
        if(c.venue().recoveryRequired) throw Problem.conflict("RECOVERY_REQUIRED","Check-in is paused during recovery.");
        if(e.checkedInAt!=null) return;
        if(e.status!=EntryStatus.ARRIVAL_WINDOW) throw Problem.conflict("WINDOW_NOT_OPEN","Check-in becomes available when your arrival window opens.");
        if(!c.now().isBefore(e.arrivalDeadline)) throw new Problem(410,"ARRIVAL_EXPIRED","The arrival deadline has passed.");
        var arrival=new Arrival();arrival.entryId=e.id;arrival.verifiedAt=c.now();
        if(assisted) {arrival.method="ASSISTED";arrival.verifiedBy=c.actor().id;arrival.reason=reason(why);}
        else {
            if(challenge==null || challenge.length()>128) throw new Problem(422,"QR_INVALID","Scan the current restaurant QR code.");
            var valid=db.query(QrChallenge.class,"where digest=?1 and restaurantId=?2",hash(challenge),c.venue().id);
            if(valid.isEmpty() || !c.now().isBefore(valid.getFirst().expiresAt)) throw new Problem(422,"QR_INVALID","This QR has expired or is not from this restaurant. Scan the current display.");
            arrival.method="QR";arrival.challengeId=valid.getFirst().id;
        }
        db.persist(arrival);e.checkedInAt=c.now();change(c,e,EntryStatus.CHECKED_IN,"CHECKED_IN",assisted?why:"Venue QR verified");
    }
    void snooze(Context c,WaitlistEntry e) {
        if(!Set.of(EntryStatus.WAITING,EntryStatus.ARRIVAL_WINDOW,EntryStatus.CHECKED_IN).contains(e.status)) throw Problem.conflict("STATE_CONFLICT","This reservation cannot be snoozed.");
        if(e.snoozeCount>=c.policy().maxSnoozes()) throw Problem.conflict("SNOOZE_LIMIT","No snoozes remain for this reservation.");
        var order=db.entries(c.session()).stream().filter(x->x.status.pending()&&x.status!=EntryStatus.SNOOZED)
            .sorted(Comparator.comparingInt((WaitlistEntry x)->x.position==null?Integer.MAX_VALUE:x.position).thenComparingLong(x->x.sequence)).toList();
        int index=order.indexOf(e);var followers=order.subList(index+1,Math.min(order.size(),index+1+c.policy().snoozeSpots()));
        if(followers.isEmpty()) throw Problem.conflict("NOTHING_TO_SNOOZE","There are no current parties behind you to move behind.");
        e.snoozeCount++;e.snoozeReleaseAt=c.now().plusSeconds(c.policy().snoozeMinutes()*60L);
        for(var f:followers) {var b=new SnoozeBarrier();b.entryId=e.id;b.predecessorId=f.id;b.snoozeNumber=e.snoozeCount;db.persist(b);}
        change(c,e,EntryStatus.SNOOZED,"SNOOZED","Behind up to "+followers.size()+" existing reservations; original join age retained");
    }
    WaitlistEntry callNext(Context c,Requests.Change body) {
        open(c);var tables=db.all(RestaurantTable.class).stream().filter(t->t.enabled&&t.status==TableStatus.AVAILABLE).toList();
        if(body.tableId()!=null) {
            var chosen=db.get(RestaurantTable.class,body.tableId());
            if(body.expectedVersion()!=null) version(chosen,body.expectedVersion());
            if(!chosen.enabled||chosen.status!=TableStatus.AVAILABLE) throw Problem.conflict("TABLE_BUSY","That table is not available.");
            tables=List.of(chosen);
        }
        var candidates=db.entries(c.session()).stream().filter(e->e.status==EntryStatus.CHECKED_IN).map(this::party).toList();
        var choice=allocator.select(candidates,tables.stream().map(this::table).toList(),c.session().priorityBurst,c.policy(),c.now());
        if(choice.isEmpty()) return null;
        var e=db.get(WaitlistEntry.class,choice.get().party().id());assign(c,e,db.get(RestaurantTable.class,choice.get().table().id()),choice.get().reason());return e;
    }
    void assign(Context c,WaitlistEntry e,RestaurantTable t,String why) {
        if(!Set.of(EntryStatus.CHECKED_IN,EntryStatus.CALLED).contains(e.status)) throw Problem.conflict("STATE_CONFLICT","Only checked-in or called parties may be assigned.");
        if(e.status==EntryStatus.CALLED && t.id.equals(e.tableId)) {record(c,e,e.status,"ASSIGNMENT_CONFIRMED",why);return;}
        if(!t.enabled || t.status!=TableStatus.AVAILABLE) throw Problem.conflict("TABLE_BUSY","This table is not available.");
        if(!AllocationEngine.compatible(party(e),table(t))) throw Problem.conflict("CAPACITY_MISMATCH","This table cannot accommodate the party or required accessibility.");
        boolean called=e.status==EntryStatus.CALLED;
        if(called) releaseTable(c,e);
        e.tableId=t.id;tableState(c,t,TableStatus.ASSIGNED,t.enabled);
        if(!called) {
            e.calledAt=c.now();e.callDeadline=c.now().plusSeconds(c.policy().callGraceMinutes()*60L);
            c.session().priorityBurst=e.priority?Math.min(c.policy().priorityBurstLimit(),c.session().priorityBurst+1):0;
            change(c,e,EntryStatus.CALLED,"CALLED",why);
        } else record(c,e,e.status,"TABLE_CHANGED",why);
    }
    WaitlistEntry hostAction(Context c,UUID id,String action,Requests.Change body) {
        var e=db.get(WaitlistEntry.class,id);current(c,e);
        if(action.equals("no-show") && e.status==EntryStatus.NO_SHOW) {audit(c,e.id,"NO_SHOW_CONFIRMED",reason(body.reason()),"Confirmed persisted overdue call");return e;}
        version(e,body.expectedVersion());
        switch(action) {
            case "assist" -> checkIn(c,e,null,true,body.reason());
            case "priority" -> {
                if(!e.status.pending()) throw Problem.conflict("STATE_CONFLICT","Priority may be approved only before a party is called.");
                e.priority=Boolean.TRUE.equals(body.priority());e.priorityVerifiedBy=c.actor().id;e.priorityReason=reason(body.reason());record(c,e,e.status,"PRIORITY_CHANGED",e.priorityReason);
            }
            case "assign" -> {open(c);if(body.tableId()==null) throw new Problem(400,"TABLE_REQUIRED","Select a table.");assign(c,e,db.get(RestaurantTable.class,body.tableId()),reason(body.reason()));}
            case "seat" -> {
                if(e.status!=EntryStatus.CALLED) throw Problem.conflict("STATE_CONFLICT","Only a called party may be seated.");
                if(!c.now().isBefore(e.callDeadline)) throw new Problem(410,"CALL_EXPIRED","The call response deadline has passed.");
                var visit=new DiningVisit();visit.entryId=e.id;visit.tableId=e.tableId;visit.partySize=e.partySize;visit.startedAt=c.now();db.persist(visit);
                tableState(c,db.get(RestaurantTable.class,e.tableId),TableStatus.OCCUPIED,true);change(c,e,EntryStatus.SEATED,"SEATED","Party seated by host");
            }
            case "dining" -> change(c,e,EntryStatus.DINING,"DINING","Dining started");
            case "complete" -> complete(c,e);
            case "no-show" -> {
                if(e.status!=EntryStatus.CALLED || c.now().isBefore(e.callDeadline)) throw Problem.conflict("NO_SHOW_NOT_DUE","No-show is permitted only after the call response deadline.");
                terminate(c,e,EntryStatus.NO_SHOW,reason(body.reason()));
            }
            default -> throw Problem.missing();
        }
        return e;
    }
    void complete(Context c,WaitlistEntry e) {
        if(!e.status.dining()) throw Problem.conflict("STATE_CONFLICT","Only a seated or dining party can be completed.");
        var visits=db.query(DiningVisit.class,"where entryId=?1 and completedAt is null",e.id);
        if(visits.size()!=1) throw Problem.conflict("VISIT_CONFLICT","No unique active dining visit exists.");
        var v=visits.getFirst();v.completedAt=c.now();v.durationSeconds=Math.max(0,Duration.between(v.startedAt,c.now()).toSeconds());v.sampleValid=v.durationSeconds>=5 && v.durationSeconds<=4*3600;
        terminate(c,e,EntryStatus.COMPLETED,"Dining completed");
        finishClosing(c);
    }
    RestaurantTable availability(Context c,UUID id,Requests.Availability body) {
        var t=db.get(RestaurantTable.class,id);version(t,body.expectedVersion());
        if(t.status==TableStatus.ASSIGNED || t.status==TableStatus.OCCUPIED) throw Problem.conflict("TABLE_BUSY","Finish or resolve the assigned party before changing table availability.");
        if(body.status()!=TableStatus.AVAILABLE && body.status()!=TableStatus.UNAVAILABLE) throw new Problem(400,"INVALID_STATUS","Availability commands accept AVAILABLE or UNAVAILABLE.");
        tableState(c,t,body.status(),body.enabled());audit(c,null,"TABLE_AVAILABILITY",reason(body.reason()),"Table "+t.number);return t;
    }
    void releaseTable(Context c,WaitlistEntry e) { if(e.tableId!=null) {var t=db.get(RestaurantTable.class,e.tableId);tableState(c,t,t.enabled?TableStatus.AVAILABLE:TableStatus.UNAVAILABLE,t.enabled);} }
    void tableState(Context c,RestaurantTable t,TableStatus status,boolean enabled) {
        var h=new TableHistory();h.tableId=t.id;h.oldStatus=t.status.name();h.newStatus=status.name();h.enabled=enabled;h.occurredAt=c.now();db.persist(h);t.status=status;t.enabled=enabled;
        if(c.session()!=null) c.session().revision++;
    }
    void terminate(Context c,WaitlistEntry e,EntryStatus status,String reason) {e.terminalAt=c.now();e.terminalReason=reason;releaseTable(c,e);change(c,e,status,status.name(),reason);}
    void change(Context c,WaitlistEntry e,EntryStatus to,String action,String why) {var from=e.status;Lifecycle.require(from,to);e.status=to;record(c,e,from,action,why);}
    void record(Context c,WaitlistEntry e,EntryStatus from,String action,String why) {
        c.session().revision++;
        var h=new QueueHistory();h.entryId=e.id;h.tableId=e.tableId;h.fromStatus=from==null?null:from.name();h.toStatus=e.status.name();h.action=action;h.actor=c.actor()==null?"SYSTEM":c.actor().id.toString();h.reason=why;h.occurredAt=c.now();h.revision=c.session().revision;db.persist(h);
        audit(c,e.id,action,why,"Token "+e.token+"; "+h.toStatus);
        var out=new OutboxEvent();out.entryId=e.id;out.recipientId=e.customerId;out.kind=action;out.title=switch(action) {case "CALLED"->"Your table is ready";case "ARRIVAL_WINDOW"->"It is time to arrive";case "CHECKED_IN"->"You are checked in";default->action.replace('_',' ').toLowerCase(Locale.ROOT);};out.body=e.token+": "+why;out.createdAt=c.now();db.persist(out);
    }
    void audit(Context c,UUID entryId,String action,String reason,String details) {var a=new AuditEvent();a.entryId=entryId;a.action=action;a.actor=c.actor()==null?"SYSTEM":c.actor().id.toString();a.reason=reason;a.details=details;a.occurredAt=c.now();db.persist(a);}
    boolean due(Context c) {
        boolean changed=false;var entries=db.entries(c.session());
        if(c.session().status==SessionStatus.OPEN && !c.now().isBefore(c.session().closesAt)) {close(c,"Published session closing time");changed=true;}
        for(var e:entries) {
            if(e.status==EntryStatus.ARRIVAL_WINDOW && !c.now().isBefore(e.arrivalDeadline)) {terminate(c,e,EntryStatus.EXPIRED,"ARRIVAL_NO_SHOW");changed=true;}
            if(e.status==EntryStatus.CALLED && !c.now().isBefore(e.callDeadline)) {terminate(c,e,EntryStatus.NO_SHOW,"CALL_NO_SHOW");changed=true;}
            if(e.status==EntryStatus.SNOOZED) {
                var barriers=db.query(SnoozeBarrier.class,"where entryId=?1 and snoozeNumber=?2 and releasedAt is null",e.id,e.snoozeCount);
                for(var b:barriers) {var predecessor=db.get(WaitlistEntry.class,b.predecessorId);if(predecessor.status==EntryStatus.SNOOZED || !predecessor.status.pending()) {b.releasedAt=c.now();b.releaseReason=predecessor.status.name();}}
                if(!c.now().isBefore(e.snoozeReleaseAt) || barriers.stream().allMatch(b->b.releasedAt!=null)) {
                    barriers.forEach(b->{if(b.releasedAt==null){b.releasedAt=c.now();b.releaseReason="MAXIMUM_HOLD";}});
                    e.fairnessSince=c.now();e.snoozeReleaseAt=null;
                    if(e.checkedInAt==null) {e.arrivalWindowOpenedAt=null;e.arrivalDeadline=null;}
                    change(c,e,e.checkedInAt==null?EntryStatus.WAITING:EntryStatus.CHECKED_IN,"SNOOZE_RELEASED","Snooze finished; original join time preserved");changed=true;
                }
            }
        }
        changed|=finishClosing(c);
        return changed;
    }
    void close(Context c,String why) {
        if(c.session().status==SessionStatus.CLOSED) return;
        c.session().status=SessionStatus.CLOSING;
        for(var e:db.entries(c.session())) if(!e.status.terminal()&&!e.status.dining()) terminate(c,e,EntryStatus.CANCELLED,"SESSION_CLOSED: "+why);
        finishClosing(c);
        audit(c,null,"SESSION_CLOSED",why,"Active dining visits may finish");
    }
    boolean finishClosing(Context c) {
        if(c.session().status!=SessionStatus.CLOSING || db.entries(c.session()).stream().anyMatch(e->e.status.dining())) return false;
        c.session().status=SessionStatus.CLOSED;c.session().closedAt=c.now();c.session().revision++;return true;
    }
    AllocationEngine.Party party(WaitlistEntry e) {return new AllocationEngine.Party(e.id,e.partySize,e.accessible,e.preference,e.priority,e.fairnessSince,e.sequence);}
    AllocationEngine.Table table(RestaurantTable t) {return new AllocationEngine.Table(t.id,t.capacity,t.accessible,db.get(DiningArea.class,t.areaId).name);}
    void project(Context c) {
        var entries=db.entries(c.session());
        var samples=db.query(DiningVisit.class,"where sampleValid=true and completedAt>=?1 order by completedAt desc",c.now().minusSeconds(c.policy().sampleHorizonMinutes()*60L)).stream().map(v->new EtaEngine.Sample(v.partySize,v.durationSeconds,v.completedAt)).toList();
        var slots=new ArrayList<EtaEngine.Slot>();boolean overrun=false;
        for(var t:db.all(RestaurantTable.class)) if(t.enabled&&t.status!=TableStatus.UNAVAILABLE) {
            long busy=0;var occupant=entries.stream().filter(e->t.id.equals(e.tableId)&&(e.status==EntryStatus.CALLED||e.status.dining())).findFirst();
            if(occupant.isPresent()) {
                var e=occupant.get();var mean=eta.duration(samples,e.partySize,c.policy(),c.now());
                if(e.status==EntryStatus.CALLED) busy=Math.max(0,Duration.between(c.now(),e.callDeadline).toSeconds())+Math.round(mean.meanSeconds());
                else {var v=db.query(DiningVisit.class,"where entryId=?1 and completedAt is null",e.id).getFirst();long elapsed=Duration.between(v.startedAt,c.now()).toSeconds();busy=eta.residual(mean,elapsed);overrun|=elapsed>mean.meanSeconds();}
            }
            slots.add(new EtaEngine.Slot(table(t),busy));
        }
        var pending=entries.stream().filter(e->e.status.pending()).map(e->{
            var barriers=new HashSet<UUID>();if(e.status==EntryStatus.SNOOZED) for(var b:db.query(SnoozeBarrier.class,"where entryId=?1 and snoozeNumber=?2 and releasedAt is null",e.id,e.snoozeCount)) {var predecessor=db.get(WaitlistEntry.class,b.predecessorId);if(predecessor.status.pending()&&predecessor.status!=EntryStatus.SNOOZED)barriers.add(b.predecessorId);}
            return new EtaEngine.Pending(party(e),e.checkedInAt==null,e.status==EntryStatus.SNOOZED?e.snoozeReleaseAt:null,barriers);
        }).toList();
        var forecast=eta.forecast(pending,slots,samples,c.session().priorityBurst,c.policy(),c.now());
        for(var e:entries) if(!e.status.terminal()) {
            var f=forecast.get(e.id);e.computedAt=c.now();e.position=f==null?null:f.position();e.etaSeconds=f==null?(e.status==EntryStatus.CALLED?0L:null):f.seconds();e.estimatedStartAt=f==null?(e.status==EntryStatus.CALLED?c.now():null):f.start();
            if(f!=null) {e.estimateSource=f.source();e.sampleCount=f.samples();e.confidence=overrun?"LOW":f.confidence();e.assumesArrival=f.assumesArrival();}
            if(e.status==EntryStatus.WAITING && f!=null && !c.venue().recoveryRequired && c.session().status==SessionStatus.OPEN && (f.seconds()<=c.policy().arrivalLeadMinutes()*60L || f.position()<=3)) {
                e.arrivalWindowOpenedAt=c.now();e.arrivalDeadline=c.now().plusSeconds(c.policy().arrivalGraceMinutes()*60L);change(c,e,EntryStatus.ARRIVAL_WINDOW,"ARRIVAL_WINDOW","Arrive and scan the venue QR before "+e.arrivalDeadline);
            }
        }
    }
    @Transactional Map<String,Object> display() {
        var c=context(null);
        if(displaySecret==null || !c.now().isBefore(displayIssued.plusSeconds(30)) || db.query(QrChallenge.class,"where digest=?1 and restaurantId=?2 and expiresAt>?3",hash(displaySecret),c.venue().id,c.now()).isEmpty()) {
            byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);displaySecret=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);displayIssued=c.now();
            var q=new QrChallenge();q.restaurantId=c.venue().id;q.digest=hash(displaySecret);q.issuedAt=c.now();q.expiresAt=c.now().plusSeconds(45);db.persist(q);
        }
        var calls=db.entries(c.session()).stream().filter(e->e.status==EntryStatus.CALLED).map(e->{var t=db.get(RestaurantTable.class,e.tableId);return map("token",e.token,"tableNumber",t.number,"areaName",db.get(DiningArea.class,t.areaId).name);}).toList();
        return map("restaurantName",c.venue().name,"called",calls,"challenge",displaySecret,"expiresAt",displayIssued.plusSeconds(45),"serverTime",c.now());
    }
}
