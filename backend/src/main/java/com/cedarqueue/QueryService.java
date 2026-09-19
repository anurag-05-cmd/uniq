package com.cedarqueue;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static com.cedarqueue.Dtos.map;

@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
class QueryService {
    final Store db;final QueueService queue;
    QueryService(Store db,QueueService queue) {this.db=db;this.queue=queue;}
    Object restaurant() {
        var r=db.venue();var s=db.session(r);var now=db.now();
        return map("id",r.id,"name",r.name,"location",r.location,"timezone",r.timezone,"description",r.description,"open",s!=null&&s.status==SessionStatus.OPEN&&!r.recoveryRequired&&!now.isBefore(s.opensAt)&&now.isBefore(s.closesAt),"demoMode",queue.isDemo(),"serverTime",now,"sessionId",s==null?null:s.id,"sessionStatus",s==null?"CLOSED":s.status,"recoveryRequired",r.recoveryRequired,"policy",queue.policy(r,s),"areas",db.all(DiningArea.class).stream().map(a->map("id",a.id,"name",a.name)).toList(),"tables",db.all(RestaurantTable.class).stream().sorted(Comparator.comparing(t->t.number)).map(t->Dtos.table(t,db)).toList(),"waitingCount",db.entries(s).stream().filter(e->e.status.pending()).count());
    }
    Object entries(Account actor) {
        var r=db.venue();
        return db.entityManager().createQuery("from WaitlistEntry where customerId=:owner order by joinedAt desc",WaitlistEntry.class).setParameter("owner",actor.id).setMaxResults(100).getResultList()
            .stream().map(e->Dtos.entry(e,queue.policy(r,db.get(OperatingSession.class,e.sessionId)),db,false)).toList();
    }
    Object entry(Account actor,UUID id) {var e=db.get(WaitlistEntry.class,id);IdentityService.readable(actor,e);return Dtos.entry(e,queue.policy(db.venue(),db.get(OperatingSession.class,e.sessionId)),db,IdentityService.staff(actor));}
    Object notifications(Account actor) {return db.entityManager().createQuery("from Notification where recipientId=:owner order by createdAt desc",Notification.class).setParameter("owner",actor.id).setMaxResults(100).getResultList().stream().map(Dtos::notification).toList();}
    Object board() {
        var r=db.venue();var session=db.session(r);var policy=queue.policy(r,session);var entries=db.entries(session);var now=db.now();
        var parties=new ArrayList<>(entries.stream().filter(e->e.status==EntryStatus.CHECKED_IN).map(queue::party).toList());
        var tables=new ArrayList<>(db.all(RestaurantTable.class).stream().filter(t->t.enabled&&t.status==TableStatus.AVAILABLE).map(queue::table).toList());
        var suggestions=new ArrayList<Object>();int burst=session==null?0:session.priorityBurst;
        while(!parties.isEmpty()&&!tables.isEmpty()) {
            var choice=queue.allocation().select(parties,tables,burst,policy,now);if(choice.isEmpty()) break;
            var c=choice.get();suggestions.add(map("entryId",c.party().id(),"tableId",c.table().id(),"score",c.score(),"reason",c.reason()));parties.remove(c.party());tables.remove(c.table());burst=c.party().priority()?Math.min(policy.priorityBurstLimit(),burst+1):0;
        }
        return map("entries",entries.stream().filter(e->!e.status.terminal()).map(e->Dtos.entry(e,policy,db,true)).toList(),"tables",db.all(RestaurantTable.class).stream().sorted(Comparator.comparing(t->t.number)).map(t->Dtos.table(t,db)).toList(),"visits",db.query(DiningVisit.class,"where completedAt is null").stream().map(v->Dtos.visit(v,db)).toList(),"revision",session==null?0:session.revision,"serverTime",now,"suggestions",suggestions);
    }
    Object audit() {return db.entityManager().createQuery("from AuditEvent order by occurredAt desc",AuditEvent.class).setMaxResults(200).getResultList().stream().map(a->map("id",a.id,"action",a.action,"actor",a.actor,"reason",a.reason,"occurredAt",a.occurredAt,"entryId",a.entryId,"details",a.details)).toList();}
    Object staff() {return db.query(Account.class,"where role<>?1 order by displayName",Role.CUSTOMER).stream().map(Dtos::user).toList();}
    Object analytics() {
        Instant now=db.now(),from=now.minusSeconds(86400);
        var operatingWindows=OperatingWindows.between(db.all(OperatingSession.class).stream().map(s->new OperatingWindows.Session(s.opensAt,s.closedAt)).toList(),from,now);
        var visits=db.query(DiningVisit.class,"where startedAt>=?1 or completedAt>=?1 or completedAt is null",from);
        var completed=visits.stream().filter(v->v.completedAt!=null&&!v.completedAt.isBefore(from)).toList();
        var entries=db.query(WaitlistEntry.class,"where joinedAt>=?1",from);
        double averageWait=completed.stream().mapToDouble(v->Duration.between(db.get(WaitlistEntry.class,v.entryId).joinedAt,v.startedAt).toSeconds()/60.0).average().orElse(0);
        double averageDining=completed.stream().mapToLong(v->v.durationSeconds).average().orElse(0)/60.0;
        var tableStats=new ArrayList<Object>();double totalAvailable=0,totalBusy=0;
        for(var table:db.all(RestaurantTable.class)) {
            var history=db.query(TableHistory.class,"where tableId=?1 order by occurredAt",table.id);
            Instant start=table.createdAt.isAfter(from)?table.createdAt:from;boolean enabled=true;String state="AVAILABLE";
            for(var h:history) if(!h.occurredAt.isAfter(start)) {enabled=h.enabled;state=h.newStatus;}
            double available=0,busy=0;
            var changes=history.stream().filter(h->h.occurredAt.isAfter(start)&&h.occurredAt.isBefore(now)).toList();
            Instant cursor=start;
            for(int i=0;i<=changes.size();i++) {
                Instant end=i==changes.size()?now:changes.get(i).occurredAt;
                if(enabled&&!state.equals("UNAVAILABLE")&&end.isAfter(cursor)) {
                    for(var window:OperatingWindows.intersect(cursor,end,operatingWindows)) {
                        available+=window.seconds();
                        for(var v:visits) if(v.tableId.equals(table.id)) {Instant vs=OperatingWindows.later(v.startedAt,window.start());Instant ve=v.completedAt==null?window.end():OperatingWindows.earlier(v.completedAt,window.end());if(ve.isAfter(vs)) busy+=Duration.between(vs,ve).toMillis()/1000.0;}
                    }
                }
                if(i<changes.size()) {cursor=end;enabled=changes.get(i).enabled;state=changes.get(i).newStatus;}
            }
            totalAvailable+=available;totalBusy+=busy;tableStats.add(map("tableNumber",table.number,"utilizationPercent",available==0?null:Math.min(100,busy/available*100)));
        }
        var trends=new ArrayList<Object>();
        for(int i=7;i>=0;i--) {Instant hour=now.truncatedTo(ChronoUnit.HOURS).minusSeconds(i*3600L),end=hour.plusSeconds(3600);trends.add(map("hour",hour,"joined",entries.stream().filter(e->!e.joinedAt.isBefore(hour)&&e.joinedAt.isBefore(end)).count(),"completed",completed.stream().filter(v->!v.completedAt.isBefore(hour)&&v.completedAt.isBefore(end)).count()));}
        double hours=operatingWindows.stream().mapToDouble(OperatingWindows.Window::seconds).sum()/3600.0;
        return map("averageWaitMinutes",averageWait,"averageDiningMinutes",averageDining,"completedParties",completed.size(),"cancellations",entries.stream().filter(e->e.status==EntryStatus.CANCELLED).count(),"noShows",entries.stream().filter(e->e.status==EntryStatus.NO_SHOW||e.status==EntryStatus.EXPIRED).count(),"utilizationPercent",totalAvailable==0?null:Math.min(100,totalBusy/totalAvailable*100),"throughputPerHour",hours==0?null:completed.size()/hours,"queueTrends",trends,"tableUtilization",tableStats,"sampleCount",completed.stream().filter(v->v.sampleValid).count(),"asOf",now,"periodFrom",from,"availableTableSeconds",Math.round(totalAvailable),"serviceOpenSeconds",Math.round(hours*3600));
    }
}
