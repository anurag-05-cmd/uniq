package com.cedarqueue;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.*;
import java.util.*;
import static com.cedarqueue.Dtos.map;

@Service
class DemoService {
    final Store db;final QueueService q;final IdentityService identity;final PasswordEncoder passwords;
    @Value("${app.bootstrap-email:}") String bootstrapEmail;
    @Value("${app.bootstrap-password:}") String bootstrapPassword;
    private String demoHash;
    DemoService(Store db,QueueService q,IdentityService identity,PasswordEncoder passwords) {this.db=db;this.q=q;this.identity=identity;this.passwords=passwords;}
    @Transactional void initialize() {
        if(db.all(Restaurant.class).isEmpty()) {
            var r=new Restaurant();r.policyJson=q.json().writeValueAsString(Policy.defaults());db.persist(r);
            for(String name:List.of("Dining Room","Garden","Terrace")) {var a=new DiningArea();a.restaurantId=r.id;a.name=name;db.persist(a);}
            var areas=db.all(DiningArea.class);int index=0;
            for(int capacity:List.of(2,2,4,4,6,6,8,8)) {var t=new RestaurantTable();t.restaurantId=r.id;t.areaId=areas.get(index%areas.size()).id;t.number="T"+(++index);t.capacity=capacity;t.accessible=index%2==1;t.createdAt=Instant.now().minusSeconds(6*3600);db.persist(t);}
            if(q.isDemo()) {
                for(var pair:Map.of("customer",Role.CUSTOMER,"host",Role.HOST,"manager",Role.MANAGER,"display",Role.DISPLAY).entrySet()) identity.create(pair.getKey()+"@cedar.local","CedarDemo!2026",Character.toUpperCase(pair.getKey().charAt(0))+pair.getKey().substring(1),pair.getValue());
                seed(r,db.now());
            }
        }
    }
    @Transactional void bootstrapManager() {
        if(!q.isDemo() && db.query(Account.class,"where role=?1",Role.MANAGER).isEmpty() && !bootstrapEmail.isBlank() && !bootstrapPassword.isBlank()) identity.create(bootstrapEmail,bootstrapPassword,"Restaurant manager",Role.MANAGER);
    }
    private void seed(Restaurant r,Instant now) {
        r.recoveryRequired=false;r.policyJson=q.json().writeValueAsString(Policy.defaults());
        var session=new OperatingSession();session.restaurantId=r.id;session.opensAt=now.minusSeconds(4*3600);session.closesAt=now.plusSeconds(12*3600);session.policyJson=r.policyJson;db.persist(session);r.currentSessionId=session.id;
        var historical=identity.accounts().findByEmailIgnoreCase("history@cedar.local").orElseGet(()->randomAccount("history@cedar.local","Dining history"));
        int tableIndex=0;
        for(var table:db.all(RestaurantTable.class)) {
            table.enabled=true;table.status=TableStatus.AVAILABLE;table.createdAt=now.minusSeconds(6*3600);
            var history=new TableHistory();history.tableId=table.id;history.newStatus="AVAILABLE";history.enabled=true;history.occurredAt=table.createdAt;db.persist(history);
            for(int j=0;j<3;j++) {
                Instant finish=now.minusSeconds((5+j*40L+tableIndex)*60);
                long duration=(27+table.capacity+j)*60L;
                var e=new WaitlistEntry();e.sessionId=session.id;e.customerId=historical.id;e.sequence=session.nextSequence++;e.token="C-"+String.format("%04d",e.sequence);e.partySize=table.capacity;e.preference="ANY";e.status=EntryStatus.COMPLETED;e.tableId=table.id;e.joinedAt=finish.minusSeconds(duration+600+j*180);e.fairnessSince=e.joinedAt;e.checkedInAt=e.joinedAt.plusSeconds(120);e.terminalAt=finish;e.terminalReason="Seeded historical dining";db.persist(e);
                var v=new DiningVisit();v.entryId=e.id;v.tableId=table.id;v.partySize=e.partySize;v.startedAt=finish.minusSeconds(duration);v.completedAt=finish;v.durationSeconds=duration;v.sampleValid=true;db.persist(v);
            }
            tableIndex++;
        }
    }
    private Account randomAccount(String email,String name) {
        if(demoHash==null) demoHash=passwords.encode("CedarDemo!2026");
        var a=new Account();a.email=email;a.displayName=name;a.passwordHash=demoHash;db.persist(a);return a;
    }
    Object run(QueueService.Context c,String action,Requests.Simulation body) {
        if(!q.isDemo()) throw Problem.missing();
        int count=body.count()==null?1:body.count();
        switch(action) {
            case "reset" -> reset(c);
            case "add" -> add(c,count,false);
            case "rush" -> add(c,body.count()==null?18:count,true);
            case "occupy" -> {
                var tables=db.all(RestaurantTable.class).stream().filter(t->t.enabled&&t.status==TableStatus.AVAILABLE&&(body.tableId()==null||t.id.equals(body.tableId()))).toList();
                if(tables.isEmpty()) throw Problem.conflict("NO_AVAILABLE_TABLE","No available table can be occupied.");
                for(var t:tables) occupy(c,t);
            }
            case "free" -> {
                for(var e:db.entries(c.session())) if(e.tableId!=null && (body.tableId()==null||e.tableId.equals(body.tableId()))) {
                    if(e.status.dining()) q.complete(c,e);else if(e.status==EntryStatus.CALLED) q.terminate(c,e,EntryStatus.CANCELLED,"DEMO table released");
                }
                for(var t:db.all(RestaurantTable.class)) if(t.status==TableStatus.UNAVAILABLE&&(body.tableId()==null||t.id.equals(body.tableId())))q.tableState(c,t,TableStatus.AVAILABLE,true);
            }
            case "complete" -> {
                var e=db.entries(c.session()).stream().filter(x->x.status.dining()&&(body.tableId()==null||body.tableId().equals(x.tableId))).findFirst().orElseThrow(()->Problem.conflict("NO_ACTIVE_VISIT","Occupy a table first to create an active dining visit."));q.complete(c,e);
            }
            case "no-show" -> {
                var e=add(c,1,false).getFirst();q.project(c);
                if(e.status==EntryStatus.WAITING) {e.arrivalWindowOpenedAt=c.now().minusSeconds(301);e.arrivalDeadline=c.now().minusSeconds(1);q.change(c,e,EntryStatus.ARRIVAL_WINDOW,"ARRIVAL_WINDOW","DEMO accelerated arrival window");}
                else {e.arrivalWindowOpenedAt=c.now().minusSeconds(301);e.arrivalDeadline=c.now().minusSeconds(1);}
                q.due(c);
            }
            case "activity" -> {
                var active=db.entries(c.session()).stream().filter(e->e.status.dining()).findFirst();if(active.isPresent())q.complete(c,active.get());
                add(c,body.count()==null?4:count,true);q.callNext(c,new Requests.Change(null,null,null,null,null));
            }
            default -> throw Problem.missing();
        }
        q.audit(c,null,"DEMO_"+action.toUpperCase(Locale.ROOT),"Development simulation","No external notifications sent");return map("message","Demo "+action+" completed");
    }
    private List<WaitlistEntry> add(QueueService.Context c,int count,boolean arriveSome) {
        var names=List.of("Avery","Riley","Jordan","Morgan","Sam","Casey","Taylor","Alex","Jamie","Robin");
        var result=new ArrayList<WaitlistEntry>();var random=new Random();
        var capacities=db.all(RestaurantTable.class).stream().filter(t->t.enabled&&t.status!=TableStatus.UNAVAILABLE).map(t->t.capacity).toList();
        if(capacities.isEmpty()) throw Problem.conflict("NO_AVAILABLE_CAPACITY","Enable a table before adding demo parties.");
        for(int i=0;i<count;i++) {
            var a=randomAccount("guest-"+UUID.randomUUID()+"@cedar.local",names.get(random.nextInt(names.size())));
            var e=q.joinFor(c,a,new Requests.Join(capacities.get(random.nextInt(capacities.size())),"ANY",false));result.add(e);
        }
        q.project(c);
        if(arriveSome) for(int i=0;i<result.size();i++) {var e=result.get(i);if(i%3!=0 && e.status==EntryStatus.ARRIVAL_WINDOW)q.checkIn(c,e,null,true,"DEMO simulated physical arrival");}
        return result;
    }
    private void occupy(QueueService.Context c,RestaurantTable t) {
        var a=randomAccount("dining-"+UUID.randomUUID()+"@cedar.local","Dining party");
        var e=q.joinFor(c,a,new Requests.Join(t.capacity,"ANY",false));q.project(c);
        if(e.status==EntryStatus.WAITING) {e.arrivalWindowOpenedAt=c.now();e.arrivalDeadline=c.now().plusSeconds(300);q.change(c,e,EntryStatus.ARRIVAL_WINDOW,"ARRIVAL_WINDOW","DEMO immediate physical arrival");}
        q.checkIn(c,e,null,true,"DEMO host arrival");q.assign(c,e,t,"DEMO table occupied");
        var v=new DiningVisit();v.entryId=e.id;v.tableId=t.id;v.partySize=e.partySize;v.startedAt=c.now();db.persist(v);q.tableState(c,t,TableStatus.OCCUPIED,true);q.change(c,e,EntryStatus.SEATED,"SEATED","DEMO seated");q.change(c,e,EntryStatus.DINING,"DINING","DEMO dining");
    }
    private void reset(QueueService.Context c) {
        q.invalidateDisplay();
        // Scoped to demo operational records. Demo accounts and configured dining areas/tables remain valid.
        c.venue().currentSessionId=null;db.flush();
        for(String table:List.of("notification","outbox_event","feedback","arrival","snooze_barrier","queue_history","dining_visit","waitlist_entry","table_history","idempotency_record","qr_challenge","operating_session")) db.entityManager().createNativeQuery("delete from "+table).executeUpdate();
        db.entityManager().clear();var r=db.get(Restaurant.class,c.venue().id);seed(r,c.now());
        // Keep the original locked venue instance coherent for the enclosing command's final projection.
        c.venue().currentSessionId=r.currentSessionId;c.venue().policyJson=r.policyJson;c.venue().recoveryRequired=false;
    }
}
